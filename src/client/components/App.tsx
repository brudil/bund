import React, { useState, useCallback, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { InputArea } from "./InputArea.js";
import { MessageList } from "./MessageList.js";
import { useSocket } from "../hooks/useSocket.js";
import { Spinner } from "./Spinner.js";

export interface Message {
  id: string;
  type: "user" | "result" | "error" | "system" | "call";
  content: string;
  streaming?: boolean;
}

export function App() {
  const { exit } = useApp();
  const idCounter = useRef(0);
  const nextId = (prefix: string) => `${prefix}-${++idCounter.current}`;

  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      type: "system",
      content: "a repl agent that thinks in code",
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [connected, setConnected] = useState(false);
  const [thoughtText, setThoughtText] = useState<string | null>(null);
  const [contextTokens, setContextTokens] = useState<number | null>(null);

  const { send, status } = useSocket({
    onThinking: () => {
      setIsStreaming(true);
    },
    onThought: (text) => {
      setThoughtText(text);
    },
    onResult: (output) => {
      if (output) {
        setMessages((prev) => [
          ...prev,
          { id: nextId("result"), type: "result", content: output },
        ]);
      }
      setIsStreaming(false);
      setThoughtText(null);
    },
    onError: (message) => {
      setMessages((prev) => [
        ...prev,
        { id: nextId("error"), type: "error", content: message },
      ]);
      setIsStreaming(false);
      setThoughtText(null);
    },
    onContextTokens: (count) => {
      setContextTokens(count);
    },
    onCall: (name, args) => {
      // Format: name(args) - truncate long args
      const argsDisplay = args.length > 60 ? args.slice(0, 60) + "..." : args;
      setMessages((prev) => [
        ...prev,
        { id: nextId("call"), type: "call", content: `${name}(${argsDisplay})` },
      ]);
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
        { id: nextId("user"), type: "user", content: value },
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
        <Text color="magenta" bold>bund</Text>
        {status === "error" ? (
          <Box flexDirection="column">
            <Box>
              <Text color="red" bold>✗ </Text>
              <Text color="red">Failed to connect to server</Text>
            </Box>
            <Text dimColor>  Run: bun run server</Text>
          </Box>
        ) : (
          <Box>
            <Spinner color="blue" />
            <Text dimColor>connecting...</Text>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <MessageList messages={messages} isStreaming={isStreaming} thoughtText={thoughtText} />
      <InputArea
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSubmit}
        disabled={isStreaming}
        placeholder={isStreaming ? "thinking..." : "message"}
        contextTokens={contextTokens}
      />
    </Box>
  );
}
