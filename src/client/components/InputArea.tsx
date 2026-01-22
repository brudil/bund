import React from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  contextTokens?: number | null;
}

function formatTokens(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
}

export const InputArea = React.memo(function InputArea({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
  contextTokens,
}: Props) {
  useInput(
    (input, key) => {
      if (key.return && !disabled && value.trim()) {
        onSubmit(value);
      }
    },
    { isActive: !disabled }
  );

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      <Box>
        <Text color={disabled ? "gray" : "blue"} bold>
          ❯{" "}
        </Text>
        {disabled ? (
          <Text dimColor>{placeholder}</Text>
        ) : (
          <TextInput
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            showCursor
          />
        )}
        {contextTokens != null && (
          <Text dimColor> ({formatTokens(contextTokens)} tokens)</Text>
        )}
      </Box>
    </Box>
  );
});
