/**
 * Import sources the Import wizard may offer.
 *
 * Every entry in IMPORT_SOURCES MUST have a matching server adapter registered
 * in packages/api/src/routers/import/adapters/ (see registry.ts). The import
 * procedures call `getAdapter(input.source)`, which throws "Unknown import
 * source" for anything unregistered, so offering a source without an adapter
 * lets the user walk through the whole wizard and then fail on the first
 * batch. Project rule: never show a button that fails server-side.
 *
 * "tally" and "generic" were offered by the wizard until 0.10.1 but never had
 * an adapter, so they were removed from the picker. Add them back only together
 * with a registered server adapter.
 */
export type ImportSource = "mybillbook" | "tally" | "generic";

export interface ImportSourceOption {
  key: ImportSource;
  label: string;
  subtitle: string;
  recommended?: boolean;
}

export const IMPORT_SOURCES: readonly ImportSourceOption[] = [
  {
    key: "mybillbook",
    label: "myBillBook",
    subtitle: "Auto-detects all column names",
    recommended: true,
  },
];
