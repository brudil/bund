// Terminal UI

import * as readline from "readline";

// ANSI colors
export const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bright: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
};

export function print(text: string, color?: keyof typeof colors) {
  if (color) {
    process.stdout.write(`${colors[color]}${text}${colors.reset}`);
  } else {
    process.stdout.write(text);
  }
}

export function println(text: string = "", color?: keyof typeof colors) {
  print(text + "\n", color);
}

export function printCode(code: string) {
  // Print code with dim styling
  const lines = code.split("\n");
  for (const line of lines) {
    print("  ", "dim");
    println(line, "dim");
  }
}

export function printResult(output: string) {
  if (!output) return;
  const lines = output.split("\n");
  for (const line of lines) {
    if (line.startsWith("→")) {
      println(line, "green");
    } else if (line.startsWith("Error:") || line.startsWith("[error]")) {
      println(line, "red");
    } else if (line.startsWith("[warn]")) {
      println(line, "yellow");
    } else {
      println(line);
    }
  }
}

export function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

export async function askQuestion(
  rl: readline.Interface,
  prompt: string
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(`${colors.cyan}${prompt}${colors.reset}`, (answer) => {
      resolve(answer);
    });
  });
}

export function clearLine() {
  process.stdout.write("\r\x1b[K");
}

export function moveCursorUp(lines: number = 1) {
  process.stdout.write(`\x1b[${lines}A`);
}

export function spinner() {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  let interval: Timer | null = null;

  return {
    start(message: string = "thinking") {
      interval = setInterval(() => {
        clearLine();
        print(`${colors.dim}${frames[i]} ${message}${colors.reset}`);
        i = (i + 1) % frames.length;
      }, 80);
    },
    stop() {
      if (interval) {
        clearInterval(interval);
        clearLine();
      }
    },
  };
}
