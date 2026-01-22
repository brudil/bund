import React from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function InputArea({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
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
    <Box>
      <Text color={disabled ? "gray" : "cyan"} bold>
        {">"}{" "}
      </Text>
      {disabled ? (
        <Text color="gray" dimColor>
          {placeholder}
        </Text>
      ) : (
        <TextInput
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          showCursor
        />
      )}
    </Box>
  );
}
