/**
 * Promise-based confirmation service for agent-initiated writes.
 *
 * The runtime asks; a mounted host (WebMcpConfirmHost in __root.tsx) shows the
 * app's ConfirmDialog and settles the promise. Requests queue so two tool
 * calls never overwrite each other's dialog. When no host is mounted the
 * runtime falls back to `window.confirm`.
 */

import { stripControlChars } from "@hisaabo/shared";

export interface ConfirmRequest {
  title: string;
  description: string;
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
