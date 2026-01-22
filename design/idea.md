# bund: Code as Context

## The Problem with Traditional Agents

Traditional agentic loops accumulate context inefficiently:

```
[Read foo.ts] → 500 lines
[Read foo.ts] → 500 lines  (duplicate!)
[Read foo.ts] → 500 lines  (duplicate!)
```

Each API round trip contains:
- System prompt
- Full conversation history
- All tool results (even redundant ones)

The harness manages context, not the agent. The agent has no control over what it remembers.

## The Core Idea

Treat the agentic loop like a notebook. The conversation itself is represented as code. The agent manages its own context.

**Traditional Agent:**
```
Context = system prompt + message history + tool results (managed by harness)
Agent sees: conversation
Agent outputs: text + tool calls
```

**Code-as-Context:**
```
Context = the TypeScript file itself (managed by agent)
Agent sees: executable notebook
Agent outputs: more code to append/modify
```

## How It Works

User sends:
> Hey!

Context sent to LLM:
```typescript
const conversation = [];
conversation[0] = "Hey!";
```

LLM responds with:
```typescript
console.log("Hello there!");
```

Next context (materialized view):
```typescript
const conversation = [];
conversation[0] = "Hey!";

let reply1 = () => console.log("Hello there!");
```

The LLM can manage its own context:
```typescript
delete conversation[0];
delete reply1;
```

The TypeScript file sent as context is a **materialized view of runtime state** - not a log of what happened.

## The Agent Controls Its Own Heap

- **Variables = memory slots**
- **Functions = reusable tools it builds for itself**
- **delete = garbage collection it controls**
- **The file = serialized heap snapshot**

```typescript
// Round 1: Agent writes
const config = await Bun.file("config.json").json();
const users = await db.query("SELECT * FROM users");

// Round 2: Agent doesn't re-read, just uses variables
const activeUsers = users.filter(u => u.active);

// Round 3: Agent decides to compress its own context
const summary = {
  configVersion: config.version,
  userCount: users.length,
  activeCount: activeUsers.length
};
// Agent can delete old variables
delete users;
delete config;
```

## The Agentic Loop

The agent keeps executing until it explicitly yields control back to the user:

```
User input
    ↓
┌─────────────────────────────────┐
│  Send context (materialized TS) │
│            ↓                    │
│  LLM generates code             │
│            ↓                    │
│  Type-check → Execute           │
│            ↓                    │
│  Did it call yieldControl()?    │
│       │              │          │
│      No             Yes         │
│       │              │          │
│       ↓              ↓          │
│  Loop again    Return to user   │
└─────────────────────────────────┘
```

```typescript
// Agent keeps working...
const files = await glob("src/**/*.ts");
const contents = await Promise.all(files.map(f => readFile(f)));
const analysis = analyzeCodebase(contents);

// Agent decides it's done
console.log("Found 3 issues in your codebase:");
console.log(analysis.summary);
yieldControl();
```

Without `yieldControl()`, the loop continues - the agent sees the result of its code and can keep working. This enables multi-step tasks without user intervention:

```typescript
// Step 1: Agent explores
const pkg = await Bun.file("package.json").json();
const deps = Object.keys(pkg.dependencies);
// Loop continues...

// Step 2: Agent investigates (same "turn")
const outdated = await checkOutdated(deps);
// Loop continues...

// Step 3: Agent reports and yields
console.log(`Found ${outdated.length} outdated packages`);
yieldControl();
```

## Agent Instructions

### Use Dynamic Imports

Always use `await import()` for loading modules, never top-level ES imports or `require()`:

```typescript
// Good - dynamic import
const { readdir } = await import("node:fs/promises");
const lodash = await import("lodash");

// Bad - top-level import (won't work in REPL context)
import { readdir } from "node:fs/promises";
import lodash from "lodash";

// Bad - require
const lodash = require("lodash");
```

This is necessary because:
1. Code executes incrementally in a REPL context
2. Top-level imports must be at file start, but agent appends code
3. Dynamic imports work anywhere and are naturally async

## TypeScript as Guardrails

Use TypeScript (Go rewrite for speed) to validate LLM output before execution:

```
LLM writes code
      ↓
   tsc (Go) - fast!
      ↓
  ┌───┴───┐
  │       │
Error   OK → Execute → Materialize → Next round
  │
  ↓
Send error back to LLM
      ↓
LLM fixes → tsc again
```

Typed APIs constrain what the LLM can do:

```typescript
declare function readFile(path: string): Promise<string>;
declare function ask(question: string): Promise<string>;
declare function yieldControl(): never;  // Return control to user
declare const conversation: Message[];

interface Message {
  role: "user" | "assistant";
  content: string;
}
```

Type errors are caught before execution:
```typescript
readFile(123);
// Error: Argument of type 'number' is not assignable to parameter of type 'string'
```

The LLM self-corrects without ever executing bad code.

## Memory Patterns

### Working Memory (Variables)
```typescript
const users = await fetchUsers();
const config = await loadConfig();
```
Lives until deleted or session ends.

### Long-term Memory (Filesystem)
```typescript
// Save
await Bun.write("memory/users.json", JSON.stringify(users));

// Load (next session)
const users = await Bun.file("memory/users.json").json();
```
Persists across sessions.

### Ephemeral Work (IIFE)
```typescript
const answer = await (async () => {
  const hugeLog = await readFile("10mb.log"); // not kept
  const parsed = parseLog(hugeLog);           // not kept
  return parsed.errorCount;                   // only this escapes
})();
// answer exists, hugeLog and parsed are gone
```
Runs but doesn't pollute context. Perfect for processing large intermediate data.

### Reusable Capabilities (Functions)
```typescript
function summarize(text: string): string {
  // ...
}

// Available for all future rounds until deleted
```

### Sub-agents (Async Functions)
```typescript
async function researcher(topic: string): Promise<Summary> {
  // could be another LLM call internally
}

async function coder(spec: string): Promise<Code> {
  // ...
}

// Compose them
const research = await researcher("auth patterns");
const impl = await coder(research.recommendation);
```

## Summary

| Pattern | Mechanism | Lifetime |
|---------|-----------|----------|
| Working memory | Variables | Until deleted or session ends |
| Long-term memory | Filesystem | Persists across sessions |
| Scratch work | IIFE | Single execution, auto-cleaned |
| Reusable capabilities | Functions | Until deleted |
| Sub-agents | Async functions | Composable, callable |
| Control flow | `yieldControl()` | Ends agent turn, returns to user |

## Why This Works

1. **No redundant reads** - data lives in variables, reused naturally
2. **Explicit context management** - agent writes `summary = ...` when it wants to compress
3. **Inspectable state** - you can read the context file to see what it "knows"
4. **Self-optimizing** - it can refactor its own context
5. **Types as permissions** - the type system constrains capabilities
6. **LLMs already know this** - trained on tons of TypeScript
7. **Errors are actionable** - TypeScript errors are specific and fixable
8. **Fast feedback** - Go-based tsc means millisecond validation

A cognitive architecture expressed entirely through language semantics the LLM already understands.
