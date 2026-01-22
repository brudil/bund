// Materializer - converts runtime state to TypeScript context

import { homedir } from "node:os";
import { join } from "node:path";
import type { GizmoManager } from "./gizmos";
import { inferType, type TypeInfo } from "./type-inference";
import { serializeValue, formatByteSize, type SerializeResult } from "./serialize";
import { parseDeclarations, parseDeletions, type ParsedDeclaration } from "./code-parser";
import { VisibilityManager } from "./visibility";

// Bund home directory - agent's persistent storage space
const BUND_HOME = join(homedir(), ".bund");

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [MATERIALIZER] ${msg}`);
}

export interface TrackedValue {
  value: unknown;
  source: string; // Original code that defined it
  type: "variable" | "function" | "const" | "let";
  serializable: boolean;
  serializeResult?: SerializeResult; // Full serialization info including type
  output?: string; // Execution output (for display as comment)
  signature?: string; // For functions: just the declaration
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

interface MaterializationContext {
  state: Map<string, TrackedValue>;
  conversation: ConversationMessage[];
  builtins: Set<string>;
  environment: Map<string, { value: string; description: string }>; // Always-visible environment constants
}

// Builtins that shouldn't be materialized (from repl.ts context)
const BUILTINS = new Set([
  "fetch",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "URL",
  "URLSearchParams",
  "Headers",
  "Request",
  "Response",
  "Buffer",
  "Bun",
  "yieldControl",
  "console",
  "process",
  "global",
  "globalThis",
  "Output",
  "Source",
  "BUND_HOME", // Shown in Environment section
  "db", // Shown in Environment section
  "gizmos", // Shown in Gizmos section
]);

export class Materializer {
  private ctx: MaterializationContext;
  private visibility: VisibilityManager;
  private gizmoManager: GizmoManager | null = null;

  constructor() {
    this.ctx = {
      state: new Map(),
      conversation: [],
      builtins: BUILTINS,
      environment: new Map([
        [
          "BUND_HOME",
          {
            value: BUND_HOME,
            description: "Your persistent storage directory. Use freely for notes, data, preferences, etc.",
          },
        ],
        [
          "db",
          {
            value: "Database",
            description: "SQLite database (bun:sqlite). Use db.run(), db.query(), db.prepare().",
          },
        ],
      ]),
    };
    this.visibility = new VisibilityManager();
  }

  /**
   * Set the gizmo manager reference for type materialization
   */
  setGizmoManager(gm: GizmoManager): void {
    this.gizmoManager = gm;
  }

  /**
   * Add a user message to the conversation
   */
  addUserMessage(message: string): void {
    this.ctx.conversation.push({ role: "user", content: message });
  }

  /**
   * Add an assistant message to the conversation
   */
  addAssistantMessage(message: string): void {
    if (message.trim()) {  // Only add non-empty messages
      this.ctx.conversation.push({ role: "assistant", content: message });
    }
  }

  /**
   * Clear conversation history (agent can call this)
   */
  clearConversation(): void {
    this.ctx.conversation = [];
  }

  /**
   * Mark a variable as revealed for this loop
   */
  reveal(name: string): boolean {
    return this.visibility.reveal(name, (n) => this.ctx.state.has(n));
  }

  /**
   * Called when agent yields to user - hide everything
   */
  onYieldToUser(): void {
    this.visibility.onYieldToUser();
  }

  /**
   * Called after code execution to update tracked state
   */
  trackExecution(code: string, runtimeContext: Record<string, unknown>, output?: string): void {
    log(`trackExecution START (${code.length} chars)`);

    // Parse declarations from the executed code
    log("Parsing declarations...");
    const declarations = parseDeclarations(code, this.ctx.builtins);
    log(`Parsed ${declarations.length} declarations`);

    // Parse deletions
    log("Parsing deletions...");
    const deletions = parseDeletions(code);
    log(`Parsed ${deletions.length} deletions`);

    // Handle deletions
    for (const name of deletions) {
      this.ctx.state.delete(name);
    }

    // Track new/updated declarations
    for (const decl of declarations) {
      // Get the actual runtime value
      const runtimeValue = runtimeContext[decl.name];
      const serResult = serializeValue(runtimeValue, decl.name);

      // Track as created in current loop (makes it visible)
      this.visibility.markCreated(decl.name);

      this.ctx.state.set(decl.name, {
        value: runtimeValue,
        source: decl.source,
        type: decl.type,
        serializable: serResult.serializable,
        serializeResult: serResult,
        output: output,
        signature: decl.signature,
      });
    }

    // Also check for assignments to existing variables (e.g., x = newValue)
    const assignmentRegex = /^(\w+)\s*=\s*[^=]/gm;
    let assignMatch;
    while ((assignMatch = assignmentRegex.exec(code)) !== null) {
      const name = assignMatch[1];
      if (!name) continue;
      // Skip if it's a declaration (const x =, let x =) or builtin
      if (
        !this.ctx.builtins.has(name) &&
        !code.includes(`const ${name}`) &&
        !code.includes(`let ${name}`) &&
        !code.includes(`var ${name}`)
      ) {
        // Update existing tracked value if it exists
        const existing = this.ctx.state.get(name);
        if (existing) {
          const runtimeValue = runtimeContext[name];
          const serResult = serializeValue(runtimeValue, name);
          existing.value = runtimeValue;
          existing.serializable = serResult.serializable;
          existing.serializeResult = serResult;
        }
      }
    }
    log(`trackExecution END: state has ${this.ctx.state.size} entries`);
  }

  /**
   * Handle explicit deletion of a variable
   */
  handleDeletion(varName: string): void {
    this.ctx.state.delete(varName);
  }

  /**
   * Generate materialized TypeScript context
   */
  materialize(): string {
    log(`materialize START: ${this.ctx.state.size} state entries, ${this.ctx.conversation.length} messages`);
    const parts: string[] = [];

    // Add conversation history
    if (this.ctx.conversation.length > 0) {
      parts.push("// === Conversation ===");
      parts.push("const conversation: { role: string, content: string }[] = [];");
      this.ctx.conversation.forEach((msg, i) => {
        parts.push(`conversation[${i}] = { role: ${JSON.stringify(msg.role)}, content: ${JSON.stringify(msg.content)} };`);
      });
      parts.push("");
    }

    // Add environment constants (always visible)
    if (this.ctx.environment.size > 0) {
      parts.push("// === Environment ===");
      for (const [name, { value, description }] of this.ctx.environment) {
        // Check if value looks like a type name (starts with uppercase, no spaces)
        // If so, render as type declaration; otherwise render as value
        if (typeof value === "string" && /^[A-Z][a-zA-Z]*$/.test(value)) {
          parts.push(`const ${name}: ${value}; // ${description}`);
        } else {
          parts.push(`const ${name} = ${JSON.stringify(value)}; // ${description}`);
        }
      }
      parts.push("");
    }

    // Add gizmo types (if any gizmos are loaded)
    if (this.gizmoManager?.hasGizmos()) {
      const gizmoTypes = this.gizmoManager.materializeTypes();
      if (gizmoTypes) {
        parts.push("// === Gizmos ===");
        parts.push(gizmoTypes);
        parts.push("");
      }
    }

    // Add tracked state
    if (this.ctx.state.size > 0) {
      // Separate functions from variables for cleaner output
      const functions: [string, TrackedValue][] = [];
      const variables: [string, TrackedValue][] = [];

      for (const [name, tracked] of this.ctx.state) {
        if (tracked.type === "function") {
          functions.push([name, tracked]);
        } else {
          variables.push([name, tracked]);
        }
      }

      // Collect interface declarations for non-serializable values
      const interfaceDecls: string[] = [];
      const variableDecls: string[] = [];

      for (const [name, tracked] of variables) {
        const keyword = tracked.type === "const" ? "const" : "let";
        const isVisible = this.visibility.isVisible(name);
        const serResult = tracked.serializeResult || serializeValue(tracked.value, name);

        if (isVisible && serResult.serializable) {
          // Visible and serializable: output full value
          variableDecls.push(`${keyword} ${name} = ${serResult.code};`);

          // Add output as comment if present and not too long
          if (tracked.output) {
            const truncated =
              tracked.output.length > 200 ? tracked.output.slice(0, 200) + "..." : tracked.output;
            const outputLines = truncated.split("\n");
            if (outputLines.length === 1) {
              variableDecls.push(`// → ${outputLines[0]}`);
            } else {
              variableDecls.push(`// → ${outputLines[0]}`);
              for (let i = 1; i < Math.min(outputLines.length, 3); i++) {
                variableDecls.push(`//   ${outputLines[i]}`);
              }
              if (outputLines.length > 3) {
                variableDecls.push(`//   ...`);
              }
            }
          }
        } else {
          // Non-serializable or hidden: use declare with type info
          const typeInfo = serResult.typeInfo || inferType(tracked.value, name);

          // Add interface declaration if we have one
          if (typeInfo.interfaceDecl) {
            interfaceDecls.push(typeInfo.interfaceDecl);
          }

          // Build the comment explaining why it's a declaration
          // Emphasize that the variable is usable - reveal is only for inspection
          let reason: string;
          if (!isVisible) {
            reason = "value hidden";
          } else if (serResult.reason === "too-large") {
            const sizeStr = serResult.byteSize ? formatByteSize(serResult.byteSize) : "large";
            reason = sizeStr;
          } else if (serResult.reason === "circular") {
            reason = "circular refs";
          } else {
            reason = "non-serializable";
          }

          variableDecls.push(
            `declare ${keyword} ${name}: ${typeInfo.typeName}; // [${reason}] usable in code; Harness.reveal('${name}') to inspect`
          );
        }
      }

      // Output interface declarations first (if any)
      if (interfaceDecls.length > 0) {
        parts.push("// === Type Declarations ===");
        parts.push(interfaceDecls.join("\n\n"));
        parts.push("");
      }

      // Output variable declarations
      if (variableDecls.length > 0) {
        parts.push("// === Agent State ===");
        parts.push(variableDecls.join("\n"));
      }

      // Output functions as signatures only (full source available via Source.show())
      if (functions.length > 0) {
        parts.push("");
        parts.push("// Functions (use Source.show(\"name\") to view implementation)");
        for (const [name, tracked] of functions) {
          // Use the extracted signature, or fall back to a generic declaration
          parts.push(tracked.signature || `declare function ${name}(...args: unknown[]): unknown;`);
        }
      }
    }

    const result = parts.join("\n");
    log(`materialize END: ${result.length} chars output`);
    return result;
  }

  /**
   * Get current state map (for debugging)
   */
  getState(): Map<string, TrackedValue> {
    return this.ctx.state;
  }

  /**
   * Get conversation array
   */
  getConversation(): ConversationMessage[] {
    return this.ctx.conversation;
  }

  /**
   * Get the full source code for a function by name
   */
  getFunctionSource(name: string): string | undefined {
    const tracked = this.ctx.state.get(name);
    if (tracked?.type === "function") {
      return tracked.source;
    }
    return undefined;
  }

  /**
   * List all tracked function names
   */
  listFunctions(): string[] {
    const functions: string[] = [];
    for (const [name, tracked] of this.ctx.state) {
      if (tracked.type === "function") {
        functions.push(name);
      }
    }
    return functions;
  }
}
