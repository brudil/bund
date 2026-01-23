#!/usr/bin/env bun

// bund server - handles agent and code execution

import { unlinkSync, existsSync } from "fs";
import {
  SOCKET_PATH,
  encode,
  decode,
  type ClientMessage,
  type ServerMessage,
} from "../shared/protocol";
import Anthropic from "@anthropic-ai/sdk";
import { chat, buildSystemPromptBlocks, MODEL, type ErrorContext } from "./agent";
import { execute, formatResult, getContext, configureSource, setMaterializer, setGizmos } from "./repl";
import { Materializer } from "./materializer";
import { GizmoManager } from "./gizmos";
import type { Socket } from "bun";

// Use Materializer instead of message history
const materializer = new Materializer();

// Anthropic client for token counting
const anthropic = new Anthropic();

// Wire up Source API to materializer
configureSource({
  getFunctionSource: (name) => materializer.getFunctionSource(name),
  listFunctions: () => materializer.listFunctions(),
});

// Wire up Harness.reveal() to materializer
setMaterializer(materializer);

// Initialize GizmoManager
const gizmoManager = new GizmoManager();

// Wire up gizmos to materializer and repl context
materializer.setGizmoManager(gizmoManager);

// Async initialization (gizmo loading and watching)
(async () => {
  await gizmoManager.initialize();
  setGizmos(gizmoManager.getGizmosProxy());
  gizmoManager.startWatching();
})();

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function send(socket: Socket<unknown>, msg: ServerMessage) {
  log(`SEND: ${msg.type}${msg.type === "context_tokens" ? ` (${msg.count})` : ""}`);
  socket.write(encode(msg));
}

const MAX_RETRIES = 3;

/**
 * Strip markdown code fences from LLM response if present.
 * Handles ```typescript, ```javascript, ```ts, ```js, or just ```
 */
function stripCodeFences(code: string): string {
  const trimmed = code.trim();

  // Check if it starts with a code fence
  const fenceStart = /^```(?:typescript|javascript|ts|js)?\s*\n?/;
  const fenceEnd = /\n?```\s*$/;

  if (fenceStart.test(trimmed) && fenceEnd.test(trimmed)) {
    const stripped = trimmed
      .replace(fenceStart, "")
      .replace(fenceEnd, "");
    log(`Stripped code fences (${code.length} -> ${stripped.length} chars)`);
    return stripped;
  }

  return code;
}

async function handleChat(socket: Socket<unknown>, content: string) {
  log(`handleChat START: "${content.slice(0, 50)}${content.length > 50 ? "..." : ""}"`);

  // Track user message in materializer
  log("Adding user message to materializer");
  materializer.addUserMessage(content);

  let loopIteration = 0;
  // Agentic loop - continues until yieldControl() is called
  while (true) {
    loopIteration++;
    log(`LOOP iteration ${loopIteration}`);

    // Build materialized context before calling agent
    log("Materializing context...");
    const materializedContext = materializer.materialize();
    log(`Context materialized (${materializedContext.length} chars)`);

    const systemBlocks = buildSystemPromptBlocks(materializedContext);
    log(`System prompt built (${systemBlocks.length} blocks)`);

    // Tell client we're thinking
    send(socket, { type: "thinking" });

    // Count tokens in parallel (non-blocking)
    log("Counting tokens (parallel)...");
    anthropic.messages.countTokens({
      model: MODEL,
      system: systemBlocks,
      messages: [{ role: "user", content }],
    }).then(tokenResponse => {
      log(`Token count: ${tokenResponse.input_tokens}`);
      send(socket, { type: "context_tokens", count: tokenResponse.input_tokens });
    }).catch(e => {
      // Token counting is non-critical, log and continue
      log(`Token counting failed: ${e}`);
    });

    let code = "";
    let errorContext: ErrorContext | undefined;
    const errorCounts = new Map<string, number>();
    const attemptHistory: Array<{ code: string; error: string }> = [];

    // Inner retry loop for error recovery
    while (true) {
      log(`RETRY loop iteration (${errorCounts.size} unique errors seen)`);
      code = "";

      log("Starting chat stream...");
      try {
        for await (const chunk of chat(content, materializedContext, errorContext)) {
          code += chunk;
          // Don't send chunks - client doesn't need them
        }
        log(`Chat stream complete (${code.length} chars)`);
      } catch (error) {
        // API errors - don't retry, exit immediately
        const message = error instanceof Error ? error.message : String(error);
        log(`Chat stream ERROR: ${message}`);
        send(socket, { type: "error", message: `Agent error: ${message}` });
        return;
      }

      // Strip markdown code fences if the LLM wrapped the response
      code = stripCodeFences(code);

      log("Executing code...");
      const result = await execute(code, {
        onThought: (text) => send(socket, { type: "thought", text }),
        onCall: (event) => {
          // Filter out internal commands
          if (event.name.startsWith("Output.") ||
              event.name.startsWith("Harness.") ||
              event.name.startsWith("Control.") ||
              event.name.startsWith("Source.")) {
            return;
          }

          // Stringify args safely (handle circular refs, functions, etc.)
          let argsStr: string;
          try {
            argsStr = JSON.stringify(event.args, (_, v) =>
              typeof v === "function" ? "[Function]" :
              v instanceof Response ? "[Response]" :
              v instanceof Request ? "[Request]" :
              v
            );
          } catch {
            argsStr = "[unserializable]";
          }
          send(socket, { type: "call", name: event.name, args: argsStr });
        }
      });
      log(`Execution complete: error=${!!result.error}, yieldType=${result.yieldType}`);

      if (result.error) {
        // Include stack trace if available for better debugging context
        const errorMessage = result.error.stack || result.error.message;
        log(`Execution error: ${result.error.message}`);

        // Add to history
        attemptHistory.push({ code, error: errorMessage });

        const errorCount = (errorCounts.get(errorMessage) ?? 0) + 1;
        errorCounts.set(errorMessage, errorCount);

        if (errorCount <= MAX_RETRIES) {
          // Retry - same error hasn't exceeded limit
          log(`Preparing retry for "${errorMessage.slice(0, 50)}${errorMessage.length > 50 ? "..." : ""}" (attempt ${attemptHistory.length}/${MAX_RETRIES})`);
          errorContext = {
            failedCode: code,
            errorMessage,
            attemptNumber: attemptHistory.length + 1,
            maxAttempts: MAX_RETRIES + 1,
            previousAttempts: attemptHistory.slice(0, -1),  // All except current
          };
          send(socket, { type: "thought", text: `Fixing error (attempt ${attemptHistory.length}/${MAX_RETRIES})...` });
          continue;
        } else {
          // Same error repeated too many times - stuck in a loop
          log(`Retries exhausted for error: ${errorMessage}`);
          const output = formatResult(result);
          try {
            materializer.trackExecution(code, getContext(), output);
          } catch (e) {
            log(`Failed to track execution: ${e}`);
          }
          send(socket, { type: "error", message: `Stuck on error after ${MAX_RETRIES} attempts: ${errorMessage}` });
          log("handleChat END (error - stuck in loop)");
          return;
        }
      }

      // Success - track and check if done
      log("Tracking successful execution...");
      const output = formatResult(result);
      try {
        materializer.trackExecution(code, getContext(), output);
        log("Execution tracked");
      } catch (e) {
        // Log but don't fail - state tracking is non-critical
        log(`Failed to track execution: ${e}`);
      }

      if (result.yieldType === 'user') {
        log("Agent yielded to user");
        // Hide all variables for next agentic loop
        materializer.onYieldToUser();
        // Track agent's markdown output in conversation
        if (result.output.length > 0) {
          const markdownOutput = result.output.join("\n");
          materializer.addAssistantMessage(markdownOutput);
        }
        // Only send result when yielding to user
        if (output) {
          send(socket, { type: "result", output });
        }
        log("handleChat END (yielded to user)");
        return;
      } else if (result.yieldType === 'execution') {
        log("Agent yielded execution, continuing agentic loop");
        // Track the executed code so agent sees what it did on next iteration
        materializer.addAssistantMessage(code);
        // Continue outer agentic loop (explicit)
        break;
      } else {
        // Neither called - auto-continue (could warn in future)
        log("Agent did not call Control method, auto-continuing");
        // Track the executed code so agent sees what it did
        materializer.addAssistantMessage(code);
        break;
      }
    }
  }
}

async function handleMessage(socket: Socket<unknown>, msg: ClientMessage) {
  log(`handleMessage: ${msg.type}`);
  switch (msg.type) {
    case "chat":
      await handleChat(socket, msg.content);
      break;
    case "ping":
      send(socket, { type: "pong" });
      break;
  }
  log(`handleMessage complete: ${msg.type}`);
}

// Clean up old socket
if (existsSync(SOCKET_PATH)) {
  unlinkSync(SOCKET_PATH);
}

const server = Bun.listen<{ buffer: string }>({
  unix: SOCKET_PATH,
  socket: {
    open(socket) {
      socket.data = { buffer: "" };
      log("Client connected");
    },
    data(socket, data) {
      log(`Socket data received (${data.toString().length} bytes)`);
      socket.data.buffer += data.toString();

      // Process complete messages (newline-delimited)
      const messages = decode(socket.data.buffer);
      log(`Decoded ${messages.length} messages`);
      if (messages.length > 0) {
        // Keep any incomplete message in buffer
        const lastNewline = socket.data.buffer.lastIndexOf("\n");
        socket.data.buffer =
          lastNewline >= 0 ? socket.data.buffer.slice(lastNewline + 1) : "";

        // Handle messages
        for (const msg of messages) {
          handleMessage(socket, msg as ClientMessage);
        }
      }
    },
    close() {
      log("Client disconnected");
    },
    error(socket, error) {
      log(`Socket error: ${error}`);
    },
  },
});

log(`bund server listening on ${SOCKET_PATH}`);

// Handle shutdown
process.on("SIGINT", () => {
  log("Shutting down...");
  gizmoManager.stopWatching();
  server.stop();
  if (existsSync(SOCKET_PATH)) {
    unlinkSync(SOCKET_PATH);
  }
  process.exit(0);
});
