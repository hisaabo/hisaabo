import { describe, it, expect } from "vitest";
import { defineAbilityFor } from "@hisaabo/shared";
import { findRoutePermission, getVisibleNavItems } from "../route-access";

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

describe("getVisibleNavItems", () => {
  const items = [
    { to: "/sales-returns", label: "Sales Returns", resource: "Invoice", action: "read" },
    { to: "/gst", label: "__REPORTS__", resource: "GstReport", action: "read" },
    { to: "/itc", label: "Input Tax Credit", resource: "ITC", action: "read", gstOnly: true },
  ] as const;
  const allow = () => true;

  it("labels /gst as Tax Reports and hides GST-only items when unregistered", () => {
    const out = getVisibleNavItems([...items], allow, false);
    expect(out.map((i) => i.label)).toEqual(["Sales Returns", "Tax Reports"]);
  });
  it("labels /gst as GST Returns and keeps GST-only items when registered", () => {
    const out = getVisibleNavItems([...items], allow, true);
    expect(out.map((i) => i.label)).toEqual(["Sales Returns", "GST Returns", "Input Tax Credit"]);
  });
  it("drops items the role cannot access", () => {
    const out = getVisibleNavItems([...items], (r) => r !== "Invoice", true);
    expect(out.map((i) => i.to)).toEqual(["/gst", "/itc"]);
  });
});
