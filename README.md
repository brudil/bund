# bund

An agent harness with no tools and no message history. The model writes TypeScript, bund runs it, and the agent's memory is whatever is left on the heap.

> [!WARNING]
> ### This is a fun experiment, not a good idea.
>
> bund exists to poke at one question: what happens if an agent's context is a *snapshot of its runtime state* instead of a log of everything that happened? It is not a serious agent, it is not meant to be used for real work, and I don't think it's how agents should be built.
>
> It also runs model-written code directly in a Bun process with your user's permissions. There is no sandbox. Don't point it at anything you care about.

## The idea

A normal agent loop is append-only. The harness owns the context: system prompt, then every message, tool call and tool result, in order. Read a file three times and it's in there three times. The model can't forget anything; it can only wait for the harness to compact.

bund flips that around:

- **No tools.** Every response is executed as TypeScript. The model "calls a tool" by writing `await Bun.file("package.json").json()`.
- **No message history.** Each API call has one user message. Everything else goes into the system prompt as a TypeScript file, rebuilt on every turn from the live runtime.
- **The context is the heap.** Variables the model declares survive between turns, and the next turn shows them as literal values. Reading a file again is pointless when `pkg` is already sitting in your context.
- **The agent garbage-collects itself.** `Harness.gc("registry")` deletes a variable, and it's gone from the next prompt. Context management becomes something the model does in code.

The context is a **materialized view** of state, not a transcript.

## What the model sees

Say you ask *"which of my deps are out of date?"*. After two steps, the context sent on the third call looks roughly like this:

```ts
// === Conversation ===
const conversation: { role: string, content: string }[] = [];
conversation[0] = { role: "user", content: "which of my deps are out of date?" };
conversation[1] = { role: "assistant", content: "// read the manifest\nconst pkg = await Bun.file(\"package.json\").json();\nControl.yieldExecution();" };
conversation[2] = { role: "assistant", content: "// pull registry metadata for each dep\nconst registry = await Promise.all(Object.keys(pkg.dependencies).map(n => fetch(`https://registry.npmjs.org/${n}`).then(r => r.json())));\nControl.yieldExecution();" };

// === Environment ===
const BUND_HOME = "/Users/you/.bund"; // Your persistent storage directory. Use freely for notes, data, preferences, etc.
const db: Database; // SQLite database (bun:sqlite). Use db.run(), db.query(), db.prepare().

// === Type Declarations ===
interface RegistryItem {
  _id: string;
  name: string;
  "dist-tags": InferredType;
  versions: InferredType;
  time: InferredType;
}

// === Agent State ===
const pkg = {"name":"bund","dependencies":{"@anthropic-ai/sdk":"^0.71.2","ink":"^6.6.0","react":"^19.2.3"}};
declare const registry: RegistryItem[]; // [3.1MB] usable in code; Harness.reveal('registry') to inspect
```

`pkg` is small, so it's inlined as a literal. `registry` is 3MB, so the model gets its *type* instead: a handle it can still use in code, for the price of an interface. The model answers with more code:

```ts
// compare declared ranges against latest, then drop the big blob
const latest = Object.fromEntries(registry.map(r => [r.name, r["dist-tags"].latest]));
Harness.gc("registry");
Output.markdown(Object.entries(pkg.dependencies)
  .map(([name, range]) => `- **${name}** ${range} → ${latest[name]}`)
  .join("\n"));
Control.yieldUser();
```

## The loop

```
you ──► materialize heap into TS ──► Claude (prefilled with "//") ──► execute
                ▲                                                       │
                │                               threw? ──► retry with the error
                │                                          as comments (3× per error)
                │                                                       │
                └──────── Control.yieldExecution() ◄────────────────────┤
                                                                        │
          you ◄── hide every variable ◄── Control.yieldUser() ◄─────────┘
```

The model is told to end each response with one of two calls (if it calls neither, bund just keeps looping): `Control.yieldExecution()` to see the result and keep going, or `Control.yieldUser()` to hand back. The assistant turn is prefilled with `//`, so the reply starts inside a comment and the model is pushed toward writing code rather than prose.

## The ideas that fell out of it

**Values become types.** Anything over 50KB, circular, or not serializable (a `Response`, a `Database`) is materialized as `declare const x: SomeInferredInterface`. The model knows the shape and can keep using it, but doesn't pay tokens for the contents.

**Forgetting by default.** When the agent yields to you, every variable collapses to its type on the next turn. Values only come back in full if the agent asks with `Harness.reveal("name")`. Each task starts with a clean-looking context while the data is all still there.

**Functions are signatures.** Functions the agent defines show up as declarations only. `Source.show("name")` brings back the body when it needs it.

**Subagents are scoped by argument list.** `Harness.subagent({ weather }, "extract the temperature in celsius")` spins up Haiku with *only* `weather` in its context. It writes extraction code, bund runs it, and the result comes back as a plain value. The subagent's context is literally its parameters.

**The agent writes its own tools.** Any `.ts` file the agent drops in `~/.bund/gizmos/` is loaded, hot-reloaded on change, and exposed as `gizmos.fileName.fn()`. Its exported signatures are materialized into context as types. Ask it to build itself a grep and it'll have one next turn, and in every future session.

**Long-term memory is just disk.** `BUND_HOME` (`~/.bund`) and a SQLite `db` are always in scope, so it can keep notes the same way it does everything else: by writing code.

## The harness API

| | |
|---|---|
| `Output.markdown(text)` | Say something to the user |
| `Output.thought(text)` | Live status line while it works |
| `Control.yieldExecution()` | End this step, see the results, keep going |
| `Control.yieldUser()` | Done; hand control back |
| `Harness.gc(path, index?)` | Delete a variable, nested property, or array element |
| `Harness.reveal(name)` | Bring a hidden variable's value back into context |
| `Harness.list()` | List live variables |
| `Harness.subagent(vars, prompt)` | Isolated extraction subagent (Haiku) |
| `Source.show(name)` / `Source.list()` | Read the agent's own function bodies |
| `gizmos.*` | Agent-written modules from `~/.bund/gizmos/` |
| `db`, `BUND_HOME` | SQLite and a home directory for persistent memory |

Plus everything Bun gives you: `fetch`, `Bun.file`, `Bun.$`, and `await import()` for anything else.

## Why it's probably a bad idea

- **No sandbox.** Code runs through `new Function` in the server process. It can do anything you can.
- **It's not really a REPL.** Each response is wrapped in an async function, its top-level declarations are found with ts-morph and hoisted into a shared context object, and reassignments are spotted with a regex. Scoping and closures are approximate.
- **State isn't always smaller than a log.** Inlining everything up to 50KB as literals can cost more tokens than the tool results it replaces.
- **Models are trained for tool calls, not this.** It mostly works, but sometimes the reply drifts into prose and dies with a `SyntaxError`, and then the retry loop is doing the real work.
- **Caching gets worse.** Only the static half of the system prompt can be cached, because the rest is regenerated from the heap on every call.

Ideas from [`design/idea.md`](design/idea.md) that aren't built: type-checking responses before running them, and typed APIs as a permission system.

## Running it

Needs [Bun](https://bun.com) and an Anthropic API key.

```sh
bun install
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env
bun start
```

`bun start` runs the server and the Ink terminal client together. To see the server's logs, run them separately with `bun run server` and `bun run client`.

What it touches:

- `/tmp/bund.sock`: client ↔ server IPC
- `~/.bund/`: `bund.db` and `gizmos/`, the agent's persistent home
- `./conversation/N.md`: every request is dumped here (materialized context, system prompt, response). This is the best way to see what's actually going on. It's gitignored.

Models are pinned in code: Sonnet 4.5 for the main agent, Haiku 4.5 for subagents.

## Layout

```
src/
├── index.ts            launcher: starts the server, then the client
├── shared/protocol.ts  newline-delimited JSON over a unix socket
├── server/
│   ├── index.ts        the agentic loop and retry logic
│   ├── agent.ts        system prompt and the Claude call
│   ├── repl.ts         execution context, Output / Control / Harness / Source
│   ├── materializer.ts heap → TypeScript context
│   ├── serialize.ts    values → literals, or a reason they can't be
│   ├── type-inference.ts  values → interfaces
│   ├── visibility.ts   hide-on-yield and reveal
│   ├── code-parser.ts  ts-morph declaration and deletion parsing
│   ├── subagent.ts     Harness.subagent
│   └── gizmos.ts       load, watch, and type agent-written modules
└── client/             Ink UI
```

## Further reading

- [`design/idea.md`](design/idea.md): the original pitch, "code as context"
- [`design/claudes-dreams.md`](design/claudes-dreams.md): Claude's wishlist of features it would like in its own harness
