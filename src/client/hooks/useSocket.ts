import { useEffect, useRef, useState, useCallback } from "react";
import {
  SOCKET_PATH,
  encode,
  decode,
  type ClientMessage,
  type ServerMessage,
} from "../../shared/protocol.js";

interface SocketCallbacks {
  onThinking?: () => void;
  onThought?: (text: string) => void;
  onResult?: (output: string) => void;
  onError?: (message: string) => void;
  onContextTokens?: (count: number) => void;
  onCall?: (name: string, args: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

type SocketStatus = "connecting" | "connected" | "disconnected" | "error";

export function useSocket(callbacks: SocketCallbacks) {
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const socketRef = useRef<Awaited<ReturnType<typeof Bun.connect>> | null>(null);
  const bufferRef = useRef("");
  const callbacksRef = useRef(callbacks);

  // Keep callbacks ref updated
  callbacksRef.current = callbacks;

  const handleMessage = useCallback((msg: ServerMessage) => {
    const cbs = callbacksRef.current;
    switch (msg.type) {
      case "thinking":
        cbs.onThinking?.();
        break;
      case "thought":
        cbs.onThought?.(msg.text);
        break;
      case "result":
        cbs.onResult?.(msg.output);
        break;
      case "error":
        cbs.onError?.(msg.message);
        break;
      case "context_tokens":
        cbs.onContextTokens?.(msg.count);
        break;
      case "call":
        cbs.onCall?.(msg.name, msg.args);
        break;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function connect() {
      try {
        const socket = await Bun.connect({
          unix: SOCKET_PATH,
          socket: {
            open() {
              if (mounted) {
                setStatus("connected");
                callbacksRef.current.onConnect?.();
              }
            },
            data(_, data) {
              if (!mounted) return;

              bufferRef.current += data.toString();
              const messages = decode(bufferRef.current);

              if (messages.length > 0) {
                const lastNewline = bufferRef.current.lastIndexOf("\n");
                bufferRef.current =
                  lastNewline >= 0
                    ? bufferRef.current.slice(lastNewline + 1)
                    : "";

                for (const msg of messages) {
                  handleMessage(msg as ServerMessage);
                }
              }
            },
            close() {
              if (mounted) {
                setStatus("disconnected");
                callbacksRef.current.onDisconnect?.();
              }
            },
            error() {
              if (mounted) {
                setStatus("error");
              }
            },
          },
        });

        socketRef.current = socket;
      } catch {
        if (mounted) {
          setStatus("error");
        }
      }
    }

    connect();

    return () => {
      mounted = false;
      socketRef.current?.end();
    };
  }, [handleMessage]);

  const send = useCallback((msg: ClientMessage) => {
    socketRef.current?.write(encode(msg));
  }, []);

  return { send, status };
}
