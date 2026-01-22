#!/usr/bin/env bun

// bund client - terminal UI that connects to server

import {
  SOCKET_PATH,
  encode,
  decode,
  type ClientMessage,
  type ServerMessage,
} from "../shared/protocol";
import {
  colors,
  print,
  println,
  printResult,
  createPrompt,
  askQuestion,
} from "./ui";

let socket: ReturnType<typeof Bun.connect> extends Promise<infer T> ? T : never;
let messageBuffer = "";
let currentResolve: ((value: void) => void) | null = null;

async function connect(): Promise<typeof socket> {
  return new Promise((resolve, reject) => {
    Bun.connect({
      unix: SOCKET_PATH,
      socket: {
        open(s) {
          resolve(s as typeof socket);
        },
        data(_, data) {
          messageBuffer += data.toString();
          const messages = decode(messageBuffer);

          if (messages.length > 0) {
            const lastNewline = messageBuffer.lastIndexOf("\n");
            messageBuffer = lastNewline >= 0 ? messageBuffer.slice(lastNewline + 1) : "";

            for (const msg of messages) {
              handleServerMessage(msg as ServerMessage);
            }
          }
        },
        close() {
          println("\nDisconnected from server", "red");
          process.exit(1);
        },
        error(_, error) {
          reject(error);
        },
      },
    });
  });
}

function handleServerMessage(msg: ServerMessage) {
  switch (msg.type) {
    case "code_start":
      println();
      print("  ", "dim");
      break;

    case "code_chunk":
      print(msg.content, "dim");
      break;

    case "code_end":
      println();
      break;

    case "exec_start":
      // Execution starting
      break;

    case "exec_result":
      println();
      printResult(msg.output);
      println();
      if (currentResolve) {
        currentResolve();
        currentResolve = null;
      }
      break;

    case "error":
      println();
      println(msg.message, "red");
      println();
      if (currentResolve) {
        currentResolve();
        currentResolve = null;
      }
      break;

    case "pong":
      // Connection alive
      break;
  }
}

function send(msg: ClientMessage) {
  socket.write(encode(msg));
}

async function chat(content: string): Promise<void> {
  return new Promise((resolve) => {
    currentResolve = resolve;
    send({ type: "chat", content });
  });
}

async function main() {
  println();
  println("bund", "bright");
  println("a repl agent - it thinks in code", "dim");
  println();

  // Connect to server
  print("connecting... ", "dim");
  try {
    socket = await connect();
    println("connected", "green");
  } catch (error) {
    println("failed", "red");
    println();
    println("Start the server first: bun run server", "dim");
    process.exit(1);
  }

  println();
  println("type a message, or 'exit' to quit", "dim");
  println();

  const rl = createPrompt();

  while (true) {
    const input = await askQuestion(rl, "> ");

    if (!input.trim()) continue;

    if (input.trim().toLowerCase() === "exit") {
      println("\nbye!", "dim");
      rl.close();
      socket.end();
      process.exit(0);
    }

    await chat(input);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
