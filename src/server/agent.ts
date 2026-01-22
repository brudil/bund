// Claude agent - responds with executable code

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a REPL agent. You respond ONLY with executable JavaScript/TypeScript code.

Your code will be executed in a Bun runtime with top-level await support.
Use console.log() to output information to the user.
The last expression's value will be displayed as the return value.

RULES:
1. Output ONLY code. No markdown, no explanations, no backticks.
2. Use console.log() for any output you want the user to see.
3. You can use fetch(), Bun APIs, and standard JS/TS.
4. Variables you define persist across turns.
5. If you need to show your reasoning, use comments.
6. For errors or issues, console.error() with a helpful message.

EXAMPLES:

User: "hi"
console.log("Hello! I'm a REPL agent. Ask me anything and I'll respond with code.")

User: "how many rs in strawberry?"
console.log("strawberry".split("").filter(c => c === "r").length)

User: "what's the weather in tokyo?"
const res = await fetch("https://wttr.in/Tokyo?format=3");
console.log(await res.text())

User: "save my name as alice"
const userName = "alice";
console.log(\`Saved! I'll remember you as \${userName}\`)

User: "what's my name?"
console.log(userName ?? "I don't know your name yet")

Remember: ONLY output executable code. Nothing else.`;

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export async function* chat(
  messages: Message[]
): AsyncGenerator<string, void, unknown> {
  const stream = await client.messages.stream({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    }
  }
}

// Non-streaming version for simpler use
export async function complete(messages: Message[]): Promise<string> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  });

  const content = response.content[0];
  if (content && content.type === "text") {
    return content.text;
  }
  throw new Error("Unexpected response type");
}
