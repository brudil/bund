#!/usr/bin/env bun

// bund - a REPL agent
// The agent responds with code. The code runs. That's it.

import { chat, type Message } from "./agent";
import { execute, formatResult } from "./repl";
import {
  colors,
  print,
  println,
  printCode,
  printResult,
  createPrompt,
  askQuestion,
  clearLine,
} from "./ui";

const history: Message[] = [];

async function main() {
  println();
  println("bund", "bright");
  println("a repl agent - it thinks in code", "dim");
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
      process.exit(0);
    }

    // Add user message to history
    history.push({ role: "user", content: input });

    // Get agent response (streaming)
    println();
    print("  ", "dim");

    let code = "";
    try {
      for await (const chunk of chat(history)) {
        code += chunk;
        print(chunk, "dim");
      }
      println();
    } catch (error) {
      println();
      println(`Error calling Claude: ${error}`, "red");
      history.pop(); // Remove failed message
      continue;
    }

    // Add assistant response to history
    history.push({ role: "assistant", content: code });

    // Execute the code
    println();
    const result = await execute(code);
    const output = formatResult(result);
    printResult(output);

    // Add execution result to conversation context
    // This lets the agent see what happened
    if (output) {
      history.push({
        role: "user",
        content: `[execution result]\n${output}`,
      });
      // Immediately add empty assistant response to maintain turn structure
      history.push({
        role: "assistant",
        content: "// noted"
      });
    }

    println();
  }
}

main().catch(console.error);
