import { useEffect, useRef, useState, useCallback } from "react";
import {
  SOCKET_PATH,
  encode,
  decode,
  type ClientMessage,
  type ServerMessage,
} from "../../shared/protocol.js";

interface SocketCallbacks {
  onCodeStart?: () => void;
  onCodeChunk?: (chunk: string) => void;
  onCodeEnd?: (code: string) => void;
  onExecResult?: (output: string, error?: string) => void;
  onError?: (message: string) => void;
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
      case "code_start":
        cbs.onCodeStart?.();
        break;
      case "code_chunk":
        cbs.onCodeChunk?.(msg.content);
        break;
      case "code_end":
        cbs.onCodeEnd?.(msg.code);
        break;
      case "exec_result":
        cbs.onExecResult?.(msg.output, msg.error);
        break;
      case "error":
        cbs.onError?.(msg.message);
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
