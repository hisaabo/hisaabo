import React from "react";
import { Text } from "ink";
import { formatAmount } from "../format.js";

interface Props {
  amount: string | number;
  colored?: boolean;
}

export function MoneyCell({ amount, colored = false }: Props) {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  const formatted = formatAmount(amount);
  if (!colored) return <Text>{formatted}</Text>;
  if (num < 0) return <Text color="red">{formatted}</Text>;
  return <Text color="green">{formatted}</Text>;
}
