import { describe, it, expect } from "vitest";
import { isStoreSlugLocked, showAutoAssignedNotice } from "../storeSlugLock";

describe("store slug lock", () => {
  it("is unlocked when no slug is set yet", () => {
    expect(isStoreSlugLocked(null, false)).toBe(false);
    expect(isStoreSlugLocked(undefined, undefined)).toBe(false);
  });
  it("is locked once a user-chosen slug exists", () => {
    expect(isStoreSlugLocked("acme", false)).toBe(true);
    expect(isStoreSlugLocked("acme", undefined)).toBe(true);
  });
  it("is unlocked while the slug is auto-assigned", () => {
    expect(isStoreSlugLocked("ab12-acme", true)).toBe(false);
  });
  it("shows the notice only for an existing auto-assigned slug", () => {
    expect(showAutoAssignedNotice("ab12-acme", true)).toBe(true);
    expect(showAutoAssignedNotice("acme", false)).toBe(false);
    expect(showAutoAssignedNotice(null, true)).toBe(false);
  });
});
