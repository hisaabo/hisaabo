import { describe, it, expect } from "vitest";
import { defineAbilityFor } from "@hisaabo/shared";
import { findRoutePermission } from "../route-access";

const nav = [
  { to: "/", resource: "Report", action: "read" },
  { to: "/gst", resource: "GstReport", action: "read" },
  { to: "/reports", resource: "Report", action: "read" },
  { to: "/quotations", resource: "Invoice", action: "read" },
] as const;

describe("findRoutePermission", () => {
  it("matches exact and nested paths", () => {
    expect(findRoutePermission("/gst", [...nav])).toEqual({ action: "read", resource: "GstReport" });
    expect(findRoutePermission("/quotations/123", [...nav])).toEqual({ action: "read", resource: "Invoice" });
  });
  it("does not match prefix lookalikes or unguarded routes", () => {
    expect(findRoutePermission("/gstx", [...nav])).toBeNull();
    expect(findRoutePermission("/settings", [...nav])).toBeNull();
  });
  it("guards the POS register", () => {
    expect(findRoutePermission("/pos", [...nav])).toEqual({ action: "create", resource: "Invoice" });
  });
  it("denies unknown roles", () => {
    const p = findRoutePermission("/reports", [...nav])!;
    expect(defineAbilityFor("").can(p.action, p.resource)).toBe(false);
  });
});
