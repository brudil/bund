// REPL executor - runs code and captures output

export interface ExecutionResult {
  output: string[];
  returnValue: unknown;
  error?: Error;
}

// Shared context that persists across executions
const context: Record<string, unknown> = {
  // Pre-populate with useful globals
  fetch,
  setTimeout,
  setInterval,
  clearTimeout,
  clearInterval,
  URL,
  URLSearchParams,
  Headers,
  Request,
  Response,
  Buffer,
  Bun,
};

export async function execute(code: string): Promise<ExecutionResult> {
  const output: string[] = [];

  // Capture console methods
  const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
  };

  const capture =
    (level: string) =>
    (...args: unknown[]) => {
      const formatted = args
        .map((arg) =>
          typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)
        )
        .join(" ");
      output.push(level === "log" ? formatted : `[${level}] ${formatted}`);
    };

  console.log = capture("log");
  console.error = capture("error");
  console.warn = capture("warn");
  console.info = capture("info");

  let returnValue: unknown;
  let error: Error | undefined;

  try {
    // Create an async function to allow top-level await
    const asyncFn = new Function(
      ...Object.keys(context),
      `return (async () => { ${code} })();`
    );

    returnValue = await asyncFn(...Object.values(context));

    // If the code defines variables, try to capture them
    // This is a simple heuristic - look for const/let/var declarations
    const varMatch = code.match(/(?:const|let|var)\s+(\w+)\s*=/g);
    if (varMatch) {
      for (const match of varMatch) {
        const name = match.replace(/(?:const|let|var)\s+/, "").replace(/\s*=/, "");
        // Try to extract the value by re-evaluating just the variable
        try {
          const extractFn = new Function(
            ...Object.keys(context),
            `return (async () => { ${code}; return ${name}; })();`
          );
          context[name] = await extractFn(...Object.values(context));
        } catch {
          // Variable might not be extractable, that's ok
        }
      }
    }
  } catch (e) {
    error = e instanceof Error ? e : new Error(String(e));
  } finally {
    // Restore console
    Object.assign(console, originalConsole);
  }

  return { output, returnValue, error };
}

// Helper to format execution result for display
export function formatResult(result: ExecutionResult): string {
  const parts: string[] = [];

  if (result.output.length > 0) {
    parts.push(result.output.join("\n"));
  }

  if (result.error) {
    parts.push(`Error: ${result.error.message}`);
  } else if (result.returnValue !== undefined) {
    const formatted =
      typeof result.returnValue === "object"
        ? JSON.stringify(result.returnValue, null, 2)
        : String(result.returnValue);
    if (formatted !== "undefined") {
      parts.push(`→ ${formatted}`);
    }
  }

  return parts.join("\n");
}
