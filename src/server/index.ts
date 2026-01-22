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
import { chat, type Message } from "./agent";
import { execute, formatResult } from "./repl";
import type { Socket } from "bun";

const history: Message[] = [];

function send(socket: Socket<unknown>, msg: ServerMessage) {
  socket.write(encode(msg));
}

async function handleChat(socket: Socket<unknown>, content: string) {
  history.push({ role: "user", content });

  // Stream code from agent
  send(socket, { type: "code_start" });

  let code = "";
  try {
    for await (const chunk of chat(history)) {
      code += chunk;
      send(socket, { type: "code_chunk", content: chunk });
    }
    send(socket, { type: "code_end", code });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send(socket, { type: "error", message: `Agent error: ${message}` });
    history.pop();
    return;
  }

  history.push({ role: "assistant", content: code });

  // Execute the code
  send(socket, { type: "exec_start" });

  const result = await execute(code);
  const output = formatResult(result);

  send(socket, {
    type: "exec_result",
    output,
    error: result.error?.message,
  });

  // Add execution result to context
  if (output) {
    history.push({
      role: "user",
      content: `[execution result]\n${output}`,
    });
    history.push({
      role: "assistant",
      content: "// noted",
    });
  }
}

async function handleMessage(socket: Socket<unknown>, msg: ClientMessage) {
  switch (msg.type) {
    case "chat":
      await handleChat(socket, msg.content);
      break;
    case "ping":
      send(socket, { type: "pong" });
      break;
  }
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
      console.log("Client connected");
    },
    data(socket, data) {
      socket.data.buffer += data.toString();

      // Process complete messages (newline-delimited)
      const messages = decode(socket.data.buffer);
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
      console.log("Client disconnected");
    },
    error(socket, error) {
      console.error("Socket error:", error);
    },
  },
});

console.log(`bund server listening on ${SOCKET_PATH}`);

// Handle shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  server.stop();
  if (existsSync(SOCKET_PATH)) {
    unlinkSync(SOCKET_PATH);
  }
  process.exit(0);
});
