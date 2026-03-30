import React from "react";
import { Text } from "ink";

interface Props {
  status: string;
}

type StatusColor = "green" | "blue" | "yellow" | "red" | "cyan" | "white" | "gray";

const STATUS_MAP: Record<string, { label: string; color: StatusColor; dimColor?: boolean }> = {
  paid:        { label: "PAID",    color: "green" },
  sent:        { label: "SENT",    color: "blue" },
  draft:       { label: "DRAFT",   color: "white", dimColor: true },
  partial:     { label: "PARTIAL", color: "yellow" },
  overdue:     { label: "OVERDUE", color: "red" },
  cancelled:   { label: "CANCEL",  color: "white", dimColor: true },
  unfulfilled: { label: "UNFUL",   color: "blue" },
  pending:     { label: "PEND",    color: "yellow" },
  confirmed:   { label: "CONF",    color: "blue" },
  delivered:   { label: "DELIV",   color: "green" },
  shipped:     { label: "SHIPPED", color: "cyan" },
  in_transit:  { label: "TRANSIT", color: "cyan" },
  returned:    { label: "RETURN",  color: "red" },
  preparing:   { label: "PREP",    color: "yellow" },
  ready:       { label: "READY",   color: "cyan" },
};

export function StatusBadge({ status }: Props) {
  const cfg = STATUS_MAP[status.toLowerCase()];
  const label = cfg ? `[${cfg.label}]` : `[${status.toUpperCase()}]`;
  const color = cfg?.color ?? "white";
  const dimColor = cfg?.dimColor ?? false;

  return (
    <Text color={color} dimColor={dimColor}>
      {label}
    </Text>
  );
}
