import { describe, it, expect } from "vitest";
import { IMPORT_SOURCES } from "../import-sources";

/**
 * The server only registers the "mybillbook" and "hisaabo" import adapters
 * (packages/api/src/routers/import/adapters). Every source the wizard offers
 * must be one the server can handle; "hisaabo" is the canonical format used by
 * the CLI/MCP, not a wizard option.
 */
const SERVER_REGISTERED = new Set(["mybillbook", "hisaabo"]);

describe("IMPORT_SOURCES", () => {
  it("offers only sources the server has an adapter for", () => {
    for (const src of IMPORT_SOURCES) {
      expect(SERVER_REGISTERED.has(src.key)).toBe(true);
    }
  });

  it("does not offer Tally or Generic CSV (no server adapter)", () => {
    const keys = IMPORT_SOURCES.map((s) => s.key as string);
    expect(keys).not.toContain("tally");
    expect(keys).not.toContain("generic");
  });

  it("keeps myBillBook as the recommended default", () => {
    expect(IMPORT_SOURCES.map((s) => s.key)).toEqual(["mybillbook"]);
    expect(IMPORT_SOURCES[0]!.recommended).toBe(true);
  });
});
