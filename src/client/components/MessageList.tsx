import React from "react";
import { Box, Text } from "ink";
import type { Message } from "./App.js";

interface Props {
  messages: Message[];
  streamingCode: string;
  maxHeight: number;
}

function MessageItem({ message }: { message: Message }) {
  switch (message.type) {
    case "user":
      return (
        <Box marginY={0}>
          <Text color="cyan" bold>
            {">"}{" "}
          </Text>
          <Text>{message.content}</Text>
        </Box>
      );

    case "code":
      return (
        <Box flexDirection="column" marginY={0} marginLeft={2}>
          {message.content.split("\n").map((line, i) => (
            <Text key={i} color="gray">
              {line}
            </Text>
          ))}
        </Box>
      );

    case "result":
      return (
        <Box flexDirection="column" marginY={0}>
          {message.content.split("\n").map((line, i) => (
            <Text
              key={i}
              color={line.startsWith("→") ? "green" : undefined}
            >
              {line}
            </Text>
          ))}
        </Box>
      );

    case "error":
      return (
        <Box marginY={0}>
          <Text color="red">{message.content}</Text>
        </Box>
      );

    case "system":
      return (
        <Box marginY={0} marginBottom={1}>
          <Text color="gray" dimColor>
            {message.content}
          </Text>
        </Box>
      );

    default:
      return null;
  }
}

export function MessageList({ messages, streamingCode, maxHeight }: Props) {
  // Calculate total lines and determine which messages to show
  const allItems: { key: string; node: React.ReactNode }[] = [];

  for (const msg of messages) {
    allItems.push({
      key: msg.id,
      node: <MessageItem message={msg} />,
    });
  }

  // Add streaming code if present
  if (streamingCode) {
    allItems.push({
      key: "streaming",
      node: (
        <Box flexDirection="column" marginY={0} marginLeft={2}>
          {streamingCode.split("\n").map((line, i) => (
            <Text key={i} color="gray">
              {line}
            </Text>
          ))}
          <Text color="gray">▋</Text>
        </Box>
      ),
    });
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {allItems.map(({ key, node }) => (
        <Box key={key} flexDirection="column">
          {node}
        </Box>
      ))}
    </Box>
  );
}
