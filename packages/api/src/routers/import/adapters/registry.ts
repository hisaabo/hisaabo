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
  if (!adapter) throw new Error(`Unknown import source: "${source}"`);
  return adapter;
}

export function hasAdapter(source: string): boolean {
  return adapters.has(source);
}
