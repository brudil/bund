// Subagent - spawns focused extraction agents with isolated context

import Anthropic from "@anthropic-ai/sdk";
import { serializeForContext } from "./serialize";

const client = new Anthropic();
const SUBAGENT_MODEL = "claude-haiku-4-5-20251001"; // Faster/cheaper for extractions

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [SUBAGENT] ${msg}`);
}

const SUBAGENT_SYSTEM_PROMPT = `You are a focused extraction agent.
Given variables and a task, write TypeScript that extracts the requested data.
Return your result using: Harness.subagent.Response({ ... })
Raw TypeScript only. No markdown fences.`;

export interface SubagentResult<T = unknown> {
  value: T;
  error?: string;
}

/**
 * Execute subagent code with the given variables and capture the Response
 */
function executeSubagentCode<T>(code: string, variables: Record<string, unknown>): SubagentResult<T> {
  let result: T | undefined;
  let responseWasCalled = false;

  // Create Response capture function
  const Response = <R>(value: R): R => {
    result = value as unknown as T;
    responseWasCalled = true;
    return value;
  };

  // Build execution context with passed variables and Harness.subagent.Response
  const context: Record<string, unknown> = {
    ...variables,
    Harness: {
      subagent: { Response },
    },
  };

  try {
    // Build and execute the function
    const fn = new Function(...Object.keys(context), code);
    fn(...Object.values(context));

    if (!responseWasCalled) {
      return {
        value: undefined as T,
        error: "Subagent did not call Harness.subagent.Response()",
      };
    }

    return { value: result as T };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    log(`Execution error: ${errorMessage}`);
    return {
      value: undefined as T,
      error: `Execution error: ${errorMessage}`,
    };
  }
}

/**
 * Run a subagent with isolated context
 *
 * @param variables - Only these variables will be visible to the subagent
 * @param prompt - Task description for the subagent
 * @returns The extracted/processed result
 */
export async function runSubagent<T>(
  variables: Record<string, unknown>,
  prompt: string
): Promise<SubagentResult<T>> {
  log(`runSubagent START: "${prompt.slice(0, 50)}${prompt.length > 50 ? "..." : ""}"`);
  log(`Variables passed: ${Object.keys(variables).join(", ")}`);

  // 1. Serialize only the passed variables into context
  const contextLines: string[] = [];
  for (const [name, value] of Object.entries(variables)) {
    const serialized = serializeForContext(value);
    contextLines.push(`const ${name} = ${serialized};`);
  }
  const variableContext = contextLines.join("\n");

  log(`Serialized context: ${variableContext.length} chars`);

  // 2. Make LLM call
  const systemPrompt = `${SUBAGENT_SYSTEM_PROMPT}

// Variables available to you:
${variableContext}`;

  log("Making API call to subagent model...");
  const response = await client.messages.create({
    model: SUBAGENT_MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: "user", content: prompt }],
  });

  const code = response.content[0]?.type === "text" ? response.content[0].text : "";

  log(`Subagent response: ${code.length} chars`);
  log(`Code:\n${code}`);

  // 3. Execute and capture result
  const result = executeSubagentCode<T>(code, variables);

  if (result.error) {
    log(`Subagent error: ${result.error}`);
  } else {
    log(`Subagent success: ${JSON.stringify(result.value)}`);
  }

  log("runSubagent END");
  return result;
}
