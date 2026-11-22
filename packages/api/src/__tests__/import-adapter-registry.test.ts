/**
 * Import adapter registry — the contract the web import wizard, the CLI and the
 * MCP import tools rely on: only registered sources work, and an unregistered
 * one is a client error (BAD_REQUEST) that names the sources that do work.
 *
 * "tally" and "generic" were offered by the web wizard until 0.10.1 but have no
 * adapter; this pins that so re-adding them to the UI without an adapter is
 * caught here (and in apps/web/src/lib/__tests__/import-sources.test.ts).
 */

import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import "../routers/import/adapters/index.js";
import { getAdapter, hasAdapter, listAdapterSources } from "../routers/import/adapters/registry.js";

describe("import adapter registry", () => {
  it("registers exactly the hisaabo and mybillbook adapters", () => {
    expect(listAdapterSources()).toEqual(["hisaabo", "mybillbook"]);
    expect(hasAdapter("hisaabo")).toBe(true);
    expect(hasAdapter("mybillbook")).toBe(true);
  });

  it.each(["tally", "generic", "excel", ""])("has no adapter for %j", (source) => {
    expect(hasAdapter(source)).toBe(false);
  });

  it("rejects an unknown source with BAD_REQUEST listing the supported ones", () => {
    let thrown: unknown;
    try {
      getAdapter("tally");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TRPCError);
    const err = thrown as TRPCError;
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toContain('Unknown import source "tally"');
    expect(err.message).toContain("hisaabo, mybillbook");
  });

  it("returns a full adapter for a registered source", () => {
    const adapter = getAdapter("hisaabo");
    for (const fn of ["transformParty", "transformItem", "transformInvoice", "transformPayment", "transformTransfer"] as const) {
      expect(typeof adapter[fn]).toBe("function");
    }
  });
});
