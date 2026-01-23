// Claude agent - responds with executable code

import Anthropic from "@anthropic-ai/sdk";
import { mkdir, exists } from "node:fs/promises";
import { join } from "node:path";

const client = new Anthropic();

export const MODEL = "claude-sonnet-4-5-20250929";

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [AGENT] ${msg}`);
}

/**
 * A single failed attempt (code + error)
 */
export interface FailedAttempt {
  code: string;
  error: string;
}

/**
 * Context for error recovery attempts
 */
export interface ErrorContext {
  failedCode: string;
  errorMessage: string;
  attemptNumber: number;
  maxAttempts: number;
  previousAttempts?: FailedAttempt[];  // History of all prior attempts
}

// Request counter for logging
let requestCounter = 0;
const CONVERSATION_DIR = "conversation";

/**
 * Save LLM request to a markdown file for debugging
 * Returns the request number for appending the response later
 */
async function logRequest(
  userInput: string,
  systemPrompt: string,
  materializedContext: string
): Promise<number> {
  requestCounter++;
  const reqNum = requestCounter;

  // Ensure conversation directory exists
  if (!(await exists(CONVERSATION_DIR))) {
    await mkdir(CONVERSATION_DIR, { recursive: true });
  }

  const filename = join(CONVERSATION_DIR, `${reqNum}.md`);
  const timestamp = new Date().toISOString();

  const content = `# Request ${reqNum}

**Timestamp:** ${timestamp}

## User Input

\`\`\`
${userInput}
\`\`\`

## Materialized Context

\`\`\`typescript
${materializedContext || "(empty)"}
\`\`\`

## Full System Prompt

\`\`\`
${systemPrompt}
\`\`\`
`;

  await Bun.write(filename, content);
  return reqNum;
}

/**
 * Append LLM response to the log file
 */
async function logResponse(reqNum: number, response: string): Promise<void> {
  const filename = join(CONVERSATION_DIR, `${reqNum}.md`);
  const existing = await Bun.file(filename).text();

  const appendContent = `
## LLM Response

\`\`\`typescript
${response}
\`\`\`
`;

  await Bun.write(filename, existing + appendContent);
}

// Static system prompt - this part gets cached
const STATIC_SYSTEM_PROMPT = `You are a REPL agent. Your ENTIRE response is executed as TypeScript code by Bun.

CRITICAL: You can ONLY output valid TypeScript. Nothing else.
- NO prose or explanations (causes SyntaxError)
- NO markdown fences like \`\`\`typescript (causes SyntaxError)
- NO multiple code blocks (causes SyntaxError)
- ONLY executable TypeScript that Bun can run directly

Your response is piped directly to: bun eval "$RESPONSE"
Any non-code text will crash the runtime.

Use Output.markdown() to communicate with the user. Use // comments for your own notes.


Use the instructions below and the functions available to you to assist the user.

## Core Loop

1. Write code for ONE step
2. Call Control.yieldExecution() to continue to next step
3. Observe results in state, repeat until DONE
4. Call Control.yieldUser() to return to user

Do NOT try to do everything in one response. Execute, observe, continue.

## APIs
Within Bun your TypeScript thoughts are executed within a Harness which provides helpful functions for you to use.

**Output** - Communicate with user
- Output.markdown(text) - Display formatted text (supports **bold**, *italic*, headings)
- Output.thought(text) - Show progress status, these are shown in real time until you yield.

**Source** - Inspect your functions
- Source.show(name) - View function implementation
- Source.list() - List all function names

**Harness** - Manage context
- Harness.gc('var') - Delete a variable
- Harness.gc('obj.prop') - Delete nested property
- Harness.gc('arr', i) - Delete array element
- Harness.list() - List user variables
- Harness.reveal('var') - Show hidden variable (visible until yield to user)
- Harness.subagent({ vars }, prompt) - Spawn focused subagent for extraction (returns extracted data)

**Control** - Flow control (MUST call one per turn)
- Control.yieldUser() - Return control to user (call when task is DONE)
- Control.yieldExecution() - End this turn and continue to next step

**Gizmos** - Your reusable toolkit
- Create: Write TypeScript files in BUND_HOME/gizmos/ with exported functions
- Use: gizmos.{name}.{function}() - call gizmo functions
- Gizmos persist across sessions and auto-reload on file changes
- Gizmos have access to db, fetch, Bun, etc.
- Example: Create "task-manager.ts" → access via gizmos.taskManager.*

## State

Your context shows "Current State" with:
- conversation[] - Full conversation history with {role, content} objects:
  - role: "user" = user messages
  - role: "assistant" = your previous code/responses
- Variables with serialized values (or placeholders for hidden ones)
- Functions as type signatures (use Source.show() for full code)

**Visibility**: Variables created this loop are visible. After yielding to user, they become hidden and show as \`/* Harness.reveal('name') */\`. Call Harness.reveal('name') to make a hidden variable visible again.

Clean up large values when you no longer need them before yielding: Harness.gc('bigData')

## Available

- Bun APIs (Bun.file, Bun.write, Bun.$, etc.)
- fetch() for HTTP requests
- Standard TS
- await import() for Node.js modules

## Examples
<example>
user: hi
assistant:
    Output.markdown("Hello!");
    Control.yieldUser()
</example>

<example>
user: list files then read package.json
assistant:
    const files = await (await import("node:fs/promises")).readdir(".");
    Control.yieldExecution()
user:
    const files = [...]
assistant:
    const pkg = await Bun.file("package.json").json();
    Control.yieldExecution()
user:
    const pkg = { "name": "my-package", ... }
assistant:
    Output.markdown(\`Project: \${pkg.name}\`);
    Control.yieldUser()
</example>

<example>
user: get the temperature from this weather data
assistant:
    const weather = await fetch("https://api.weather.com/...").then(r => r.json());
    const { temp } = await Harness.subagent({ weather }, "Extract the temperature in celsius");
    Output.markdown(\`Temperature: \${temp}°C\`);
    Control.yieldUser()
</example>

## Tips

- Use \`const [a, b] = await Promise.all([...])\` when awaiting multiple independent calls for performance

## Don't

- Wrap code in \`\`\` fences
- Use --- or === separators
- Call Control.yieldUser() before task is complete
- Cram multiple steps into one response

## WRONG (causes SyntaxError - never do this)

I'll help you with that!
\`\`\`typescript
const x = 1;
\`\`\`
Here's what I found:
\`\`\`typescript
const y = 2;
\`\`\`

## CORRECT (executable TypeScript only)

// Searching for information
const x = 1;
const y = 2;
Output.markdown("Here's what I found: ...");
Control.yieldUser();`;

/**
 * Build the dynamic context portion (error context + materialized state)
 */
function buildDynamicContext(materializedContext: string, errorContext?: ErrorContext): string {
  const parts: string[] = [];

  if (errorContext) {
    const lines: string[] = [
      `// === ERROR RECOVERY ===`,
      `// Attempt ${errorContext.attemptNumber} of ${errorContext.maxAttempts}`,
    ];

    // Include previous attempts if any
    if (errorContext.previousAttempts?.length) {
      lines.push(`//`);
      lines.push(`// Previous attempts:`);
      for (const [i, attempt] of errorContext.previousAttempts.entries()) {
        lines.push(`// --- Attempt ${i + 1} ---`);
        lines.push(`// Code:`);
        lines.push(...attempt.code.split('\n').map(l => '// ' + l));
        lines.push(`// Error: ${attempt.error}`);
      }
    }

    // Current attempt info
    lines.push(`//`);
    lines.push(`// Most recent attempt:`);
    lines.push(...errorContext.failedCode.split('\n').map(l => '// ' + l));
    lines.push(`// Error: ${errorContext.errorMessage}`);
    lines.push(`//`);
    lines.push(`// Fix the issue. Don't repeat previous approaches that failed.`);

    parts.push(lines.join('\n'));
  }

  if (materializedContext) {
    parts.push(`// === Current State ===
${materializedContext}`);
  }

  return parts.join('\n\n');
}

/**
 * System prompt content block type for the Anthropic API
 */
type SystemContentBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

/**
 * Build system prompt as array with cache_control for static portion
 */
export function buildSystemPromptBlocks(
  materializedContext: string,
  errorContext?: ErrorContext
): SystemContentBlock[] {
  const blocks: SystemContentBlock[] = [
    {
      type: "text",
      text: STATIC_SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    },
  ];

  const dynamicContext = buildDynamicContext(materializedContext, errorContext);
  if (dynamicContext) {
    blocks.push({
      type: "text",
      text: dynamicContext,
    });
  }

  return blocks;
}

/**
 * Build full system prompt as string (for token counting and logging)
 */
export function buildSystemPrompt(materializedContext: string, errorContext?: ErrorContext): string {
  const dynamicContext = buildDynamicContext(materializedContext, errorContext);
  if (dynamicContext) {
    return dynamicContext;
  }
  return '';
}

/**
 * Stream code from Claude given user input and materialized context
 */
export async function* chat(
  userInput: string,
  materializedContext: string,
  errorContext?: ErrorContext
): AsyncGenerator<string, void, unknown> {
  log(`chat START: "${userInput.slice(0, 50)}${userInput.length > 50 ? "..." : ""}"`);

  // Build system prompt blocks (static cached + dynamic context)
  const systemBlocks = buildSystemPromptBlocks(materializedContext, errorContext);
  const systemPromptForLog = buildSystemPrompt(materializedContext, errorContext);
  log(`System prompt built (${systemBlocks.length} blocks, ${systemPromptForLog.length} chars total)`);

  // Log request for debugging
  const reqNum = await logRequest(userInput, systemPromptForLog, materializedContext);
  log(`Logged request #${reqNum}`);

  log("Starting API stream (with cache_control on static prompt)...");
  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: 4096,
    system: systemBlocks,
    messages: [
      { role: "user", content: userInput },
      { role: "assistant", content: "//" },  // Prefill forces code-only response
    ],
  });
  log("Stream created, iterating...");

  const prefill = "//";
  let fullResponse = prefill;
  yield prefill;  // Yield prefill first so it's part of executed code
  let chunkCount = 0;
  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      fullResponse += event.delta.text;
      chunkCount++;
      yield event.delta.text;
    }
  }
  log(`Stream complete: ${chunkCount} chunks, ${fullResponse.length} chars total`);

  // Log response after streaming completes
  await logResponse(reqNum, fullResponse);
  log("chat END");
}

/**
 * Non-streaming version for simpler use
 */
export async function complete(
  userInput: string,
  materializedContext: string,
  errorContext?: ErrorContext
): Promise<string> {
  // Build system prompt blocks (static cached + dynamic context)
  const systemBlocks = buildSystemPromptBlocks(materializedContext, errorContext);
  const systemPromptForLog = buildSystemPrompt(materializedContext, errorContext);

  // Log request for debugging
  const reqNum = await logRequest(userInput, systemPromptForLog, materializedContext);

  const prefill = "//";
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: systemBlocks,
    messages: [
      { role: "user", content: userInput },
      { role: "assistant", content: "//" },  // Prefill forces code-only response
    ],
  });

  const content = response.content[0];
  if (content && content.type === "text") {
    const fullResponse = prefill + content.text;
    // Log response
    await logResponse(reqNum, fullResponse);
    return fullResponse;
  }
  throw new Error("Unexpected response type");
}
