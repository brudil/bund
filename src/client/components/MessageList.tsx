import React from "react";
import { Box, Text, Static } from "ink";
import type { Message } from "./App.js";
import { Markdown } from "./Markdown.js";
import { Spinner } from "./Spinner.js";

interface Props {
  messages: Message[];
  isStreaming: boolean;
  thoughtText: string | null;
}

const MessageItem = React.memo(function MessageItem({ message }: { message: Message }) {
  switch (message.type) {
    case "user":
      return (
        <Box marginTop={1}>
          <Text color="blue" bold>❯ </Text>
          <Text bold>{message.content}</Text>
        </Box>
      );

    case "result":
      return (
        <Box flexDirection="column" marginTop={0} marginLeft={2}>
          <Markdown>{message.content}</Markdown>
        </Box>
      );

    case "error":
      return (
        <Box marginTop={1} marginLeft={2}>
          <Text color="red" bold>✗ </Text>
          <Text color="red">{message.content}</Text>
        </Box>
      );

    case "system":
      return (
        <Box flexDirection="column" marginBottom={0}>
          <Text color="magenta" bold>bund</Text>
          <Text dimColor>{message.content}</Text>
        </Box>
      );

    case "call":
      return (
        <Box marginLeft={2}>
          <Text dimColor>→ </Text>
          <Text dimColor>{message.content}</Text>
        </Box>
      );

    default:
      return null;
  }
});

export const MessageList = React.memo(function MessageList({ messages, isStreaming, thoughtText }: Props) {
  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Completed messages - rendered once, never re-rendered */}
      <Static items={messages}>
        {(message) => (
          <Box key={message.id} flexDirection="column">
            <MessageItem message={message} />
          </Box>
        )}
      </Static>

      {/* Streaming indicator - updates frequently */}
      {isStreaming && (
        <Box marginTop={1} marginLeft={2}>
          <Spinner />
          <Text dimColor italic>
            {thoughtText || "thinking..."}
          </Text>
        </Box>
      )}
    </Box>
  );
});
