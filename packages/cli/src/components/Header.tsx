import React from "react";
import { Box, Text } from "ink";

interface Props {
  title: string;
  subtitle?: string;
  right?: string;
}

export function Header({ title, subtitle, right }: Props) {
  const width = process.stdout.columns ?? 80;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color="white">{" " + title}</Text>
        {right && (
          <Box flexGrow={1} justifyContent="flex-end">
            <Text dimColor>{right + " "}</Text>
          </Box>
        )}
      </Box>
      {subtitle && <Text dimColor>{" " + subtitle}</Text>}
      <Text dimColor>{" " + "═".repeat(Math.min(width - 2, 70))}</Text>
    </Box>
  );
}
