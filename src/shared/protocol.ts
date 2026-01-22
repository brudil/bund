// IPC Protocol - messages between client and server

export const SOCKET_PATH = "/tmp/bund.sock";

// Client -> Server
export type ClientMessage =
  | { type: "chat"; content: string }
  | { type: "ping" };

// Server -> Client
export type ServerMessage =
  | { type: "code_start" }
  | { type: "code_chunk"; content: string }
  | { type: "code_end"; code: string }
  | { type: "exec_start" }
  | { type: "exec_result"; output: string; error?: string }
  | { type: "error"; message: string }
  | { type: "pong" };

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg) + "\n";
}

export function decode(data: string): (ClientMessage | ServerMessage)[] {
  const messages: (ClientMessage | ServerMessage)[] = [];
  const lines = data.split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      messages.push(JSON.parse(line));
    } catch {
      // Ignore malformed messages
    }
  }
  return messages;
}
