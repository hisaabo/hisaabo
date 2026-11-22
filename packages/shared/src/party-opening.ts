/**
 * Party opening balance as the party forms enter it.
 *
 * The stored value is SIGNED, the documented convention everywhere (API, MCP,
 * WebMCP, docs): positive = they owe you, negative = you owe them, for customers
 * and suppliers alike. A bare signed number is easy to get backwards, so the web
 * and mobile forms ask for an unsigned amount and a direction ("To receive" /
 * "To pay") and use these helpers to turn that into, and read it back from, the
 * stored value.
 */

import { money } from "./money.js";

/** "receive": they owe you (stored positive). "pay": you owe them (stored negative). */
export type OpeningBalanceDirection = "receive" | "pay";

/**
 * The stored signed opening balance for an amount and a direction. A sign typed
 * into the amount is ignored (the direction owns it); blank or zero is "0".
 */
export function composeOpeningBalance(amount: string | null | undefined, direction: OpeningBalanceDirection): string {
  const magnitude = money.add((amount ?? "").trim().replace(/^[+-]/, "") || "0", "0");
  if (money.isZero(magnitude)) return "0";
  return direction === "pay" ? money.sub("0", magnitude) : magnitude;
}

/**
 * The unsigned amount and the direction for a stored opening balance, for edit
 * forms. Zero (or nothing stored) is an empty amount with "receive".
 */
export function splitOpeningBalance(stored: string | null | undefined): {
  amount: string;
  direction: OpeningBalanceDirection;
} {
  const value = money.add(stored ?? "0", "0");
  if (money.isZero(value)) return { amount: "", direction: "receive" };
  if (money.compare(value, "0") < 0) return { amount: money.sub("0", value), direction: "pay" };
  return { amount: value, direction: "receive" };
}
