import { describe, it, expect } from "vitest";
import { showsItemDescriptionOnStore, STORE_DESCRIPTION_FALLBACK_NOTE } from "../storeItemHints";

describe("showsItemDescriptionOnStore", () => {
  it("is true when the item has a description and no store description (catalog falls back)", () => {
    expect(showsItemDescriptionOnStore({ description: "Cost 40, supplier Raju", storeDescription: null })).toBe(true);
    expect(showsItemDescriptionOnStore({ description: "Internal note" })).toBe(true);
  });
  it("is false when a store description is set, so the internal one is not shown", () => {
    expect(showsItemDescriptionOnStore({ description: "Internal", storeDescription: "Handmade fudge" })).toBe(false);
  });
  it("is false for an explicitly empty store description (COALESCE only skips NULL)", () => {
    expect(showsItemDescriptionOnStore({ description: "Internal", storeDescription: "" })).toBe(false);
  });
  it("is false when there is no internal description to expose", () => {
    expect(showsItemDescriptionOnStore({ description: null, storeDescription: null })).toBe(false);
    expect(showsItemDescriptionOnStore({ description: "   ", storeDescription: null })).toBe(false);
    expect(showsItemDescriptionOnStore({})).toBe(false);
  });
  it("has user-facing copy", () => {
    expect(STORE_DESCRIPTION_FALLBACK_NOTE).toContain("online store");
  });
});
