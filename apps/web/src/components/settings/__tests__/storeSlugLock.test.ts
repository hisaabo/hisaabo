import { describe, it, expect } from "vitest";
import { STORE_SLUG_RESERVED_MESSAGE } from "@hisaabo/shared";
import { isStoreSlugLocked, showAutoAssignedNotice, reservedStoreSlugError } from "../storeSlugLock";

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

describe("reserved store slug (client-side validation)", () => {
  it("flags a reserved slug typed into an unlocked field", () => {
    expect(reservedStoreSlugError("login", null, false)).toBe(STORE_SLUG_RESERVED_MESSAGE);
    expect(reservedStoreSlugError("support", "ab12-acme", false)).toBe(STORE_SLUG_RESERVED_MESSAGE);
  });
  it("flags the brand prefix/suffix (hisaabo-*, *-hisaabo) but not hisaab-*", () => {
    expect(reservedStoreSlugError("hisaabo-support", null, false)).toBe(STORE_SLUG_RESERVED_MESSAGE);
    expect(reservedStoreSlugError("acme-hisaabo", null, false)).toBe(STORE_SLUG_RESERVED_MESSAGE);
    expect(reservedStoreSlugError("hisaab-traders", null, false)).toBeNull();
  });
  it("accepts ordinary slugs and an empty field", () => {
    expect(reservedStoreSlugError("acme-traders", null, false)).toBeNull();
    expect(reservedStoreSlugError("", null, false)).toBeNull();
  });
  it("does not flag the reserved slug a business already holds (grandfathered)", () => {
    expect(reservedStoreSlugError("shop", "shop", false)).toBeNull();
    expect(reservedStoreSlugError("hisaabo-demo", "hisaabo-demo", false)).toBeNull();
  });
  it("does not validate a locked (read-only) field", () => {
    expect(reservedStoreSlugError("shop", "shop", true)).toBeNull();
    expect(reservedStoreSlugError("login", "shop", true)).toBeNull();
  });
});
