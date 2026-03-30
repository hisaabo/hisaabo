import React from "react";
import { Box, Text } from "ink";

interface Column<T extends object> {
  key: keyof T | string;
  header: string;
  width?: number;
  align?: "left" | "right";
  render?: (value: unknown, row: T) => React.ReactNode;
}

interface Props<T extends object> {
  rows: T[];
  columns: Column<T>[];
}

function getVal(obj: object, key: string): unknown {
  const parts = key.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function Table<T extends object>({ rows, columns }: Props<T>) {
  if (rows.length === 0) {
    return <Text dimColor>  (no results)</Text>;
  }

  const sep = "─".repeat(columns.reduce((s, c) => s + (c.width ?? 12) + 2, 1));

  return (
    <Box flexDirection="column">
      <Text dimColor>{" " + sep}</Text>
      <Box>
        {columns.map((col, i) => (
          <Box key={i} width={col.width ?? 12} marginRight={2}>
            <Text dimColor>{col.header}</Text>
          </Box>
        ))}
      </Box>
      <Text dimColor>{" " + sep}</Text>
      {rows.map((row, ri) => (
        <Box key={ri}>
          {columns.map((col, ci) => {
            const val = getVal(row, col.key as string);
            const node = col.render
              ? col.render(val, row)
              : <Text>{String(val ?? "")}</Text>;
            return (
              <Box key={ci} width={col.width ?? 12} marginRight={2} justifyContent={col.align === "right" ? "flex-end" : "flex-start"}>
                {node}
              </Box>
            );
          })}
        </Box>
      ))}
      <Text dimColor>{" " + sep}</Text>
    </Box>
  );
}
