/**
 * Building blocks for a write tool's `summarize()` — the text a person reads in
 * the confirmation dialog before approving what an agent asked for.
 *
 * The raw input of a write is mostly UUIDs ("partyId: 3f1c…") and decimal
 * strings, which tells a human nothing. A summary resolves them: the party's
 * name, the invoice number, the computed total, and for an update the
 * field-by-field before → after. Everything here is best effort and read-only:
 * a failed lookup degrades to a shorter summary, never to a failed call (the
 * runtime falls back to the plain input summary if `summarize` throws).
 *
 * Every string that reaches the dialog is sanitised and clipped again in
 * confirm.ts, so a party named "Allow this" followed by control characters cannot
 * restyle the prompt.
 */

import type { WebMcpConfirmChange, WebMcpToolContext } from "../types";
import { formatCurrency } from "@/lib/utils";
import { str } from "./shared";

/** "₹17,700.00" from a decimal string. Display only — the exact string still goes to the API. */
export function rupees(amount: unknown): string {
  const value = typeof amount === "string" || typeof amount === "number" ? String(amount) : "";
  return /^-?\d+(\.\d+)?$/.test(value) ? formatCurrency(value) : "an unspecified amount";
}

/** "14 Oct 2026" from an ISO string, or the raw text when it does not parse. */
export function day(iso: unknown): string | null {
  const value = str(iso);
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export interface PartyInfo {
  name: string;
  type: string | null;
}

/** The party's name and type, or null when it cannot be resolved (missing, forbidden, offline). */
export async function lookupParty(ctx: WebMcpToolContext, id: string | undefined): Promise<PartyInfo | null> {
  if (!id) return null;
  try {
    const party = record(await ctx.client.party.getById.query({ id }));
    const name = str(party?.name);
    return name ? { name, type: str(party?.type) ?? null } : null;
  } catch {
    return null;
  }
}

export interface InvoiceInfo {
  number: string;
  status: string | null;
  total: string | null;
  paid: string | null;
  partyName: string | null;
}

/** The invoice's number, status, total and party, or null when it cannot be resolved. */
export async function lookupInvoice(ctx: WebMcpToolContext, id: string | undefined): Promise<InvoiceInfo | null> {
  if (!id) return null;
  try {
    const invoice = record(await ctx.client.invoice.getById.query({ id }));
    const number = str(invoice?.invoiceNumber);
    if (!invoice || !number) return null;
    return {
      number,
      status: str(invoice.status) ?? null,
      total: str(invoice.totalAmount) ?? null,
      paid: str(invoice.amountPaid) ?? null,
      partyName: str(record(invoice.party)?.name) ?? null,
    };
  } catch {
    return null;
  }
}

/** Short label for an id the lookup could not resolve — enough to tell two apart, never the whole UUID. */
export function shortId(id: string | undefined): string {
  return id ? `…${id.slice(-6)}` : "unknown";
}

/**
 * Field-level before → after for an update. `labels` maps an input key to the
 * label shown to the person; only keys the agent actually sent AND whose value
 * differs from `before` are listed, so a no-op does not look like a change.
 * `format` renders one value (money, dates); the default prints strings as-is
 * and `none` for empty.
 */
export function buildChanges(
  labels: Record<string, string>,
  before: Record<string, unknown> | null,
  input: Record<string, unknown>,
  format: (key: string, value: unknown) => string = defaultFormat,
): WebMcpConfirmChange[] {
  const changes: WebMcpConfirmChange[] = [];
  for (const [key, label] of Object.entries(labels)) {
    if (input[key] === undefined) continue;
    const prior = before?.[key];
    if (String(prior ?? "") === String(input[key] ?? "")) continue;
    changes.push({ field: label, before: format(key, prior), after: format(key, input[key]) });
  }
  return changes;
}

function defaultFormat(_key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "none";
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "…";
}
