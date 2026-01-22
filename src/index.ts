#!/usr/bin/env bun

// bund - launches server and client together

import { spawn } from "bun";
import { existsSync } from "fs";
import { SOCKET_PATH } from "./shared/protocol";

const serverPath = new URL("./server/index.ts", import.meta.url).pathname;
const clientPath = new URL("./client/index.tsx", import.meta.url).pathname;

// Start server in background
const server = spawn(["bun", "run", serverPath], {
  stdio: ["ignore", "ignore", "inherit"],
});

// Wait for socket to appear
async function waitForServer(timeout = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (existsSync(SOCKET_PATH)) {
      return true;
    }
    await Bun.sleep(50);
  }
  return false;
}

const ready = await waitForServer();
if (!ready) {
  console.error("Server failed to start");
  server.kill();
  process.exit(1);
}

// Start client in foreground
const client = spawn(["bun", "run", clientPath], {
  stdio: ["inherit", "inherit", "inherit"],
});

// When client exits, kill server
await client.exited;
server.kill();
process.exit(client.exitCode ?? 0);
