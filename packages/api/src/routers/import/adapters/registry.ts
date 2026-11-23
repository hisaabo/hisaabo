import { TRPCError } from "@trpc/server";
import type {
  CanonicalParty,
  CanonicalItem,
  CanonicalInvoice,
  CanonicalPayment,
  CanonicalTransfer,
} from "../types.js";

// ── Source Adapter interface ──────────────────────────────────────────────────
// Each adapter receives the raw tRPC input row (typed as Record<string, unknown>)
// and returns a canonical type or null (to signal "skip this row").
export type SourceAdapter = {
  transformParty:    (raw: Record<string, unknown>) => CanonicalParty | null;
  transformItem:     (raw: Record<string, unknown>) => CanonicalItem | null;
  transformInvoice:  (raw: Record<string, unknown>) => CanonicalInvoice | null;
  transformPayment:  (raw: Record<string, unknown>) => CanonicalPayment | null;
  transformTransfer: (raw: Record<string, unknown>) => CanonicalTransfer | null;
};

const adapters = new Map<string, SourceAdapter>();

export function registerAdapter(source: string, adapter: SourceAdapter): void {
  adapters.set(source, adapter);
}

export function getAdapter(source: string): SourceAdapter {
  const adapter = adapters.get(source);
  if (!adapter) {
    // A client error, not a server fault: report the sources that do work.
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Unknown import source "${source}". Supported sources: ${listAdapterSources().join(", ")}`,
    });
  }
  return adapter;
}

/** Registered source names, sorted (for error messages and tests). */
export function listAdapterSources(): string[] {
  return [...adapters.keys()].sort();
}

export function hasAdapter(source: string): boolean {
  return adapters.has(source);
}
