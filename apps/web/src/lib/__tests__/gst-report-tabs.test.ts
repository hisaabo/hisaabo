/**
 * Tests for the GST Returns / Tax Reports tab state (lib/gst-report-tabs.ts).
 * A user can own several businesses with different GST status, so the
 * remembered tab is per business and never resolves to a tab the active
 * business can't show.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  availableReportTabs,
  readStoredReportTab,
  resolveReportTab,
  storeReportTab,
} from "@/lib/gst-report-tabs";

describe("gst report tabs", () => {
  beforeEach(() => localStorage.clear());

  it("hides GST-only tabs for unregistered businesses", () => {
    expect(availableReportTabs(true)).toContain("gstr9");
    expect(availableReportTabs(false)).not.toContain("gstr9");
    expect(availableReportTabs(false)).toContain("gstr1");
  });

  it("remembers the tab per business", () => {
    storeReportTab("biz-gst", "gstr9");
    storeReportTab("biz-plain", "aging");
    expect(readStoredReportTab("biz-gst")).toBe("gstr9");
    expect(readStoredReportTab("biz-plain")).toBe("aging");
    expect(readStoredReportTab("biz-other")).toBeNull();
  });

  it("does not store or read without an active business", () => {
    storeReportTab(null, "pnl");
    expect(localStorage.length).toBe(0);
    expect(readStoredReportTab(null)).toBeNull();
  });

  it("prefers the URL tab, then the stored tab, then the default", () => {
    expect(resolveReportTab("ledger", "pnl", true)).toBe("ledger");
    expect(resolveReportTab(undefined, "pnl", true)).toBe("pnl");
    expect(resolveReportTab(undefined, null, true)).toBe("gstr1");
  });

  it("falls back when the tab isn't available for the active business", () => {
    // GSTR-9 remembered/linked from a GST-registered business, now viewing an unregistered one
    expect(resolveReportTab("gstr9", null, false)).toBe("gstr1");
    expect(resolveReportTab(undefined, "gstr9", false)).toBe("gstr1");
    expect(resolveReportTab("gstr9", "aging", false)).toBe("aging");
  });

  it("ignores garbage stored values", () => {
    expect(resolveReportTab(undefined, "not-a-tab", true)).toBe("gstr1");
  });
});
