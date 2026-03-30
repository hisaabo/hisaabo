import React from "react";
import { Box, Text } from "ink";

interface Props {
  message: string;
  detail?: string;
}

export function ErrorDisplay({ message, detail }: Props) {
  return (
    <Box flexDirection="column">
      <Text color="red">Error: {message}</Text>
      {detail && <Text color="gray">{detail}</Text>}
    </Box>
  );
}
