// REPL executor - runs code and captures output

import { homedir } from "node:os";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import type { Materializer } from "./materializer";
import { runSubagent } from "./subagent";
import { parseDeclarations } from "./code-parser";

// Bund home directory - agent's persistent storage space
const BUND_HOME = join(homedir(), ".bund");

// Ensure bund home exists
if (!existsSync(BUND_HOME)) {
  mkdirSync(BUND_HOME, { recursive: true });
}

// Create/open SQLite database in agent's home directory
const db = new Database(join(BUND_HOME, "bund.db"));
// Enable WAL mode for better concurrent access
db.run("PRAGMA journal_mode = WAL");

// Expose db on globalThis so gizmos can access it
(globalThis as Record<string, unknown>).db = db;

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [REPL] ${msg}`);
}

// Materializer reference - set via setMaterializer()
let materializerRef: Materializer | null = null;

/**
 * Set the materializer reference for Harness.reveal()
 */
export function setMaterializer(m: Materializer): void {
  materializerRef = m;
}

/**
 * Set the gizmos proxy in context
 */
export function setGizmos(gizmosProxy: Record<string, Record<string, Function>>): void {
  context.gizmos = gizmosProxy;
}

export type YieldType = 'user' | 'execution' | null;

export interface ExecutionResult {
  output: string[];
  returnValue: unknown;
  error?: Error;
  yieldType: YieldType;  // which Control method was called, or null if neither
}

export interface CallEvent {
  name: string;           // e.g., "fetch", "Bun.file", "Harness.gc"
  args: unknown[];        // Arguments passed
  timestamp: number;
}

export interface ExecuteOptions {
  onThought?: (text: string) => void;
  onCall?: (event: CallEvent) => void;  // Called when tracked functions are invoked
}

/**
 * Callbacks for Source API - allows access to function implementations
 */
export interface SourceCallbacks {
  getFunctionSource: (name: string) => string | undefined;
  listFunctions: () => string[];
}

// Source callbacks - set via configureSource()
let sourceCallbacks: SourceCallbacks | null = null;

/**
 * Configure the Source API with callbacks to the materializer
 */
export function configureSource(callbacks: SourceCallbacks): void {
  sourceCallbacks = callbacks;
}

// Track which yield method was called during execution
let yieldType: YieldType = null;

/**
 * Wrap a function to emit call events
 */
function wrapFunction<T extends (...args: unknown[]) => unknown>(
  fn: T,
  name: string,
  onCall?: (event: CallEvent) => void
): T {
  if (!onCall) return fn;

  return ((...args: unknown[]) => {
    onCall({ name, args, timestamp: Date.now() });
    return fn(...args);
  }) as T;
}

/**
 * Wrap an object's methods to emit call events
 */
function wrapObject<T extends Record<string, unknown>>(
  obj: T,
  prefix: string,
  onCall?: (event: CallEvent) => void
): T {
  if (!onCall) return obj;

  return new Proxy(obj, {
    get(target, prop) {
      const value = target[prop as keyof T];
      if (typeof value === "function") {
        return (...args: unknown[]) => {
          onCall({ name: `${prefix}.${String(prop)}`, args, timestamp: Date.now() });
          return (value as (...args: unknown[]) => unknown).apply(target, args);
        };
      }
      // Recursively wrap nested objects (e.g., Bun.file returns object with methods)
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return wrapObject(value as Record<string, unknown>, `${prefix}.${String(prop)}`, onCall);
      }
      return value;
    }
  });
}

// Control API - explicit flow control
const Control = {
  yieldUser: () => {
    yieldType = 'user';
  },
  yieldExecution: () => {
    yieldType = 'execution';
  },
};

// Shared context that persists across executions
// Exported so Materializer can access runtime values
export const context: Record<string, unknown> = {
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
  // Agent's home directory - persistent storage space
  // The agent can use this freely to store notes, data, preferences, etc.
  BUND_HOME,
  // SQLite database instance
  db,
  // Control API
  Control,
};

// Source API - allows agent to view function implementations
// This is added to context dynamically in execute() so it can access captured output
const Source = {
  show: (name: string) => {
    if (!sourceCallbacks) {
      return "Source API not configured.";
    }
    const source = sourceCallbacks.getFunctionSource(name);
    if (source) {
      return source;
    }
    return `No function named "${name}" found.`;
  },
  list: () => {
    if (!sourceCallbacks) {
      return [];
    }
    return sourceCallbacks.listFunctions();
  }
};

// Add Source to context
context.Source = Source;

// Harness API - allows agent to manage context
const Harness = {
  /**
   * Garbage collect a variable or nested property
   * Examples:
   *   Harness.gc('files')           - delete the files variable
   *   Harness.gc('data.items')      - delete data.items property
   *   Harness.gc('arr', 0)          - delete arr[0]
   */
  gc: (path: string, index?: number): boolean => {
    log(`Harness.gc called: path="${path}", index=${index}`);

    if (index !== undefined) {
      // Array index deletion: Harness.gc('arr', 0)
      const target = context[path];
      if (Array.isArray(target)) {
        target.splice(index, 1);
        log(`Deleted index ${index} from array ${path}`);
        return true;
      }
      return false;
    }

    // Check for dot notation: 'data.items'
    if (path.includes('.')) {
      const parts = path.split('.');
      const varName = parts[0]!;
      const propPath = parts.slice(1);

      let target = context[varName];
      if (target === undefined) return false;

      // Navigate to parent of final property
      for (let i = 0; i < propPath.length - 1; i++) {
        target = (target as Record<string, unknown>)[propPath[i]!];
        if (target === undefined) return false;
      }

      // Delete the final property
      const finalProp = propPath[propPath.length - 1]!;
      delete (target as Record<string, unknown>)[finalProp];
      log(`Deleted property ${path}`);
      return true;
    }

    // Simple variable deletion
    if (path in context) {
      delete context[path];
      log(`Deleted variable ${path}`);
      return true;
    }

    return false;
  },

  /**
   * List all user-defined variables in context
   */
  list: (): string[] => {
    const builtins = new Set([
      'fetch', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
      'URL', 'URLSearchParams', 'Headers', 'Request', 'Response', 'Buffer',
      'Bun', 'Control', 'Output', 'Source', 'Harness', 'BUND_HOME', 'db', 'gizmos'
    ]);
    return Object.keys(context).filter(k => !builtins.has(k));
  },

  /**
   * Reveal a hidden variable for the current agentic loop
   * Variables become hidden after yielding to user, call this to make them visible again
   */
  reveal: (name: string): boolean => {
    log(`Harness.reveal called: name="${name}"`);
    return materializerRef?.reveal(name) ?? false;
  },

  /**
   * Spawn a focused subagent with isolated context
   * The subagent only sees the passed variables and returns extracted data
   *
   * @param variables - Only these variables will be visible to the subagent
   * @param prompt - Task description for extraction/processing
   * @returns The extracted/processed result
   */
  subagent: Object.assign(
    async <T>(variables: Record<string, unknown>, prompt: string): Promise<T> => {
      log(`Harness.subagent called: "${prompt.slice(0, 50)}..."`);
      const result = await runSubagent<T>(variables, prompt);
      if (result.error) {
        throw new Error(result.error);
      }
      return result.value;
    },
    {
      // Response is only valid inside subagent execution context
      Response: <T>(_value: T): T => {
        throw new Error("Harness.subagent.Response() is only valid inside subagent execution");
      },
    }
  ),
};

context.Harness = Harness;

export async function execute(
  code: string,
  options: ExecuteOptions = {}
): Promise<ExecutionResult> {
  log(`execute START (${code.length} chars)`);
  const output: string[] = [];

  // Reset yield type at start of each execution
  yieldType = null;

  // Create Output API for this execution
  context.Output = {
    markdown: (content: string) => {
      log(`Output.markdown called (${content.length} chars)`);
      output.push(content);
    },
    thought: (text: string) => {
      log(`Output.thought: "${text}"`);
      options.onThought?.(text);
    }
  };

  let returnValue: unknown;
  let error: Error | undefined;

  try {
    // If the code defines variables, extract them all in a single execution
    // This avoids re-running the code multiple times (which would repeat side effects)
    // Use ts-morph-based parser to avoid matching variables inside string literals
    const builtins = new Set([
      'fetch', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
      'URL', 'URLSearchParams', 'Headers', 'Request', 'Response', 'Buffer',
      'Bun', 'Control', 'Output', 'Source', 'Harness', 'BUND_HOME', 'db', 'gizmos'
    ]);
    const declarations = parseDeclarations(code, builtins);
    const varNames = declarations
      .filter(d => d.type !== 'function')  // Only extract variables, not functions
      .map(d => d.name);
    if (varNames.length > 0) {
      log(`Found ${varNames.length} variable declarations to extract: ${varNames.join(", ")}`);
    }

    // Build a single function that runs the code once and returns all variables
    const returnExpr = varNames.length > 0
      ? `return { ${varNames.join(", ")} };`
      : "";
    const wrappedCode = `return (async () => { ${code}; ${returnExpr} })();`;

    log("Executing async function...");

    // Create observed context if onCall is provided
    const observedContext: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context)) {
      if (options.onCall) {
        if (typeof value === "function") {
          observedContext[key] = wrapFunction(value as (...args: unknown[]) => unknown, key, options.onCall);
        } else if (value && typeof value === "object" && !Array.isArray(value)) {
          observedContext[key] = wrapObject(value as Record<string, unknown>, key, options.onCall);
        } else {
          observedContext[key] = value;
        }
      } else {
        observedContext[key] = value;
      }
    }

    const asyncFnWithCapture = new Function(...Object.keys(observedContext), wrappedCode);
    const result = await asyncFnWithCapture(...Object.values(observedContext));
    log(`Async function complete, result type: ${typeof result}`);

    // If we captured variables, extract them from the result
    if (varNames.length > 0 && result && typeof result === "object") {
      for (const name of varNames) {
        if (name in result) {
          context[name] = result[name];
          log(`Extracted ${name}: ${typeof context[name]}`);
        }
      }
      // returnValue is undefined since we're extracting named variables
      returnValue = undefined;
    } else {
      returnValue = result;
    }
  } catch (e) {
    error = e instanceof Error ? e : new Error(String(e));
    log(`Execution error: ${error.message}`);
  }

  log(`execute END: error=${!!error}, yieldType=${yieldType}, outputs=${output.length}`);
  return { output, returnValue, error, yieldType };
}

/**
 * Get a snapshot of the current context (for Materializer)
 * Returns only user-defined variables, not builtins
 */
export function getContext(): Record<string, unknown> {
  return context;
}

/**
 * Delete a variable from the context
 */
export function deleteFromContext(name: string): boolean {
  if (name in context) {
    delete context[name];
    return true;
  }
  return false;
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
