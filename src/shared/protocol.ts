// IPC Protocol - messages between client and server

export const SOCKET_PATH = "/tmp/bund.sock";

// Client -> Server
export type ClientMessage =
  | { type: "chat"; content: string }
  | { type: "ping" };

// Server -> Client
export type ServerMessage =
  | { type: "thinking" }
  | { type: "thought"; text: string }
  | { type: "result"; output: string }
  | { type: "error"; message: string }
  | { type: "pong" }
  | { type: "context_tokens"; count: number }
  | { type: "call"; name: string; args: string }; // Runtime function call (args JSON-stringified)

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
      // Silently ignore incomplete messages (will be retried when more data arrives)
      // Only log if it looks like a complete message that failed
      if (line.endsWith("}")) {
        console.error(`[PROTOCOL] Failed to parse message (${line.length} chars)`);
      }
    }
  }
  return messages;
}
