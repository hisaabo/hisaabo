/**
 * Promise-based confirmation service for agent-initiated writes.
 *
 * The runtime asks; a mounted host (WebMcpConfirmHost in __root.tsx) shows the
 * app's ConfirmDialog and settles the promise. Requests queue so two tool
 * calls never overwrite each other's dialog. When no host is mounted the
 * runtime falls back to `window.confirm`.
 */

import { stripControlChars } from "@hisaabo/shared";
import type { WebMcpConfirmChange, WebMcpConfirmSummary } from "./types";

export interface ConfirmRequest {
  title: string;
  /** The sentence the person reads first: what the agent wants to do. Lines and changes follow it. */
  description: string;
  /** Supporting facts, one per line (already sanitised — see describeSummary). */
  lines?: string[];
  /** Field-level before → after for an update. */
  changes?: WebMcpConfirmChange[];
  /** Writes the agent may still make this session (see budget.ts), shown so the user can see it running down. */
  writesLeft?: number;
  /**
   * Aborts when the registration that asked is torn down (business switch,
   * sign-out). The host then denies this request and closes its dialog, so a
   * prompt can never outlive the context it was shown for.
   */
  signal?: AbortSignal;
}

type ConfirmHost = (request: ConfirmRequest) => Promise<boolean>;

let host: ConfirmHost | null = null;

/** Mount a host; returns the unregister function. Last host wins. */
export function registerConfirmHost(next: ConfirmHost): () => void {
  host = next;
  return () => {
    if (host === next) host = null;
  };
}

export function isConfirmHostMounted(): boolean {
  return host !== null;
}

/** Resolves true only on an explicit yes; any failure denies. */
export async function requestConfirmation(request: ConfirmRequest): Promise<boolean> {
  if (!host) return false;
  try {
    return (await host(request)) === true;
  } catch {
    return false;
  }
}

const MAX_VALUE_CHARS = 60;
const MAX_FIELDS = 8;
const MAX_SUMMARY_CHARS = 320;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function describeValue(value: unknown): string {
  if (value === null || value === undefined) return "none";
  if (typeof value === "string") return clip(stripControlChars(value), MAX_VALUE_CHARS);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  try {
    return clip(stripControlChars(JSON.stringify(value) ?? ""), MAX_VALUE_CHARS);
  } catch {
    return "(unprintable)";
  }
}

function humanizeKey(key: string): string {
  return stripControlChars(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}

/** Short, readable one-paragraph summary of tool input: "name: Acme; phone: 9999999999; 3 more". */
export function summarizeInput(input: Record<string, unknown>): string {
  const entries = Object.entries(input).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "No details provided.";
  const shown = entries.slice(0, MAX_FIELDS).map(([k, v]) => `${humanizeKey(k)}: ${describeValue(v)}`);
  const extra = entries.length - shown.length;
  if (extra > 0) shown.push(`${extra} more field${extra === 1 ? "" : "s"}`);
  return clip(shown.join("; "), MAX_SUMMARY_CHARS);
}

const MAX_HEADLINE_CHARS = 160;
const MAX_LINE_CHARS = 200;
const MAX_LINES = 8;
const MAX_CHANGES = 8;
const MAX_CHANGE_FIELD_CHARS = 40;
const MAX_CHANGE_VALUE_CHARS = 80;

function oneLine(text: unknown, max: number): string {
  return clip(stripControlChars(String(text ?? "")).replace(/\s+/g, " ").trim(), max);
}

/**
 * Turn a tool's summary into the fields of a ConfirmRequest. Everything in a
 * summary can originate from the user's books (a party named by a third party),
 * so each string is stripped of control and bidi characters, flattened to one
 * line and clipped; a summary can never grow the dialog without bound or
 * smuggle in a second paragraph that looks like part of Hisaabo's own wording.
 */
export function describeSummary(summary: WebMcpConfirmSummary): Pick<ConfirmRequest, "description" | "lines" | "changes"> {
  const headline = oneLine(summary.headline, MAX_HEADLINE_CHARS);
  const lines = (summary.details ?? [])
    .map((d) => oneLine(d, MAX_LINE_CHARS))
    .filter((d) => d.length > 0)
    .slice(0, MAX_LINES);
  const changes = (summary.changes ?? []).slice(0, MAX_CHANGES).map((c) => ({
    field: oneLine(c.field, MAX_CHANGE_FIELD_CHARS),
    before: oneLine(c.before, MAX_CHANGE_VALUE_CHARS) || "none",
    after: oneLine(c.after, MAX_CHANGE_VALUE_CHARS) || "none",
  }));
  return { description: headline, lines, changes };
}

/** Everything a request says, as plain text — for window.confirm, which cannot render a list. */
export function requestToPlainText(request: Pick<ConfirmRequest, "title" | "description" | "lines" | "changes">): string {
  const parts = [
    request.title,
    "",
    request.description,
    ...(request.lines ?? []),
    ...(request.changes ?? []).map((c) => `${c.field}: ${c.before} → ${c.after}`),
  ];
  return parts.join("\n").trim();
}
