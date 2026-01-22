import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { InputArea } from "./InputArea.js";
import { MessageList } from "./MessageList.js";
import { useSocket } from "../hooks/useSocket.js";

export interface Message {
  id: string;
  type: "user" | "code" | "result" | "error" | "system";
  content: string;
  streaming?: boolean;
}

export function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      type: "system",
      content: "bund - a repl agent that thinks in code",
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [connected, setConnected] = useState(false);
  const [streamingCode, setStreamingCode] = useState("");

  const terminalHeight = stdout?.rows ?? 24;

  const { send, status } = useSocket({
    onCodeStart: () => {
      setIsStreaming(true);
      setStreamingCode("");
    },
    onCodeChunk: (chunk) => {
      setStreamingCode((prev) => prev + chunk);
    },
    onCodeEnd: (code) => {
      setMessages((prev) => [
        ...prev,
        { id: `code-${Date.now()}`, type: "code", content: code },
      ]);
      setStreamingCode("");
    },
    onExecResult: (output, error) => {
      if (output || error) {
        setMessages((prev) => [
          ...prev,
          {
            id: `result-${Date.now()}`,
            type: error ? "error" : "result",
            content: output || error || "",
          },
        ]);
      }
      setIsStreaming(false);
    },
    onError: (message) => {
      setMessages((prev) => [
        ...prev,
        { id: `error-${Date.now()}`, type: "error", content: message },
      ]);
      setIsStreaming(false);
    },
    onConnect: () => setConnected(true),
    onDisconnect: () => {
      setConnected(false);
      exit();
    },
  });

  const handleSubmit = useCallback(
    (value: string) => {
      if (!value.trim() || isStreaming) return;

      if (value.trim().toLowerCase() === "exit") {
        exit();
        return;
      }

      setMessages((prev) => [
        ...prev,
        { id: `user-${Date.now()}`, type: "user", content: value },
      ]);
      setInputValue("");
      send({ type: "chat", content: value });
    },
    [isStreaming, send, exit]
  );

  // Handle Ctrl+C
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
    }
  });

  if (!connected) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow">Connecting to server...</Text>
        {status === "error" && (
          <Text color="red">
            Failed to connect. Start the server first: bun run server
          </Text>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={terminalHeight}>
      {/* Messages area - takes remaining space */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        <MessageList
          messages={messages}
          streamingCode={streamingCode}
          maxHeight={terminalHeight - 4}
        />
      </Box>

      {/* Input area - fixed at bottom */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
      >
        <InputArea
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
          disabled={isStreaming}
          placeholder={isStreaming ? "thinking..." : "message"}
        />
      </Box>
    </Box>
  );
}
