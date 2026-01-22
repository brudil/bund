import React, { useState, useEffect } from "react";
import { Text } from "ink";

const frames = ["◐", "◓", "◑", "◒"];

interface Props {
  color?: string;
}

export function Spinner({ color = "yellow" }: Props) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, 100);
    return () => clearInterval(timer);
  }, []);

  return <Text color={color}>{frames[frame]} </Text>;
}
