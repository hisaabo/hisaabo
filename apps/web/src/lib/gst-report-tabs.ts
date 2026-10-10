// Tab state for the GST Returns / Tax Reports page (routes/gst.tsx).
//
// The available tabs depend on the *active* business's GST status, and users
// can own several businesses with different statuses. So the remembered tab is
// stored per business, and any tab (from the URL or storage) that the current
// business can't show falls back to the default.

export const REPORT_TABS = ["gstr1", "gstr3b", "gstr9", "pnl", "trial-balance", "balance-sheet", "aging", "ledger", "tally"] as const;
export type ReportTab = (typeof REPORT_TABS)[number];

/** Tabs that only make sense for GST-registered businesses. */
const GST_ONLY_TABS: ReadonlySet<ReportTab> = new Set(["gstr9"]);

const DEFAULT_TAB: ReportTab = "gstr1";
const STORAGE_PREFIX = "hisaabo_gst_tab:";

export function availableReportTabs(isGstRegistered: boolean): ReportTab[] {
  return REPORT_TABS.filter((t) => isGstRegistered || !GST_ONLY_TABS.has(t));
}

function asAvailableTab(value: string | null | undefined, isGstRegistered: boolean): ReportTab | undefined {
  return availableReportTabs(isGstRegistered).find((t) => t === value);
}

export function readStoredReportTab(businessId: string | null): string | null {
  if (!businessId) return null;
  try {
    return localStorage.getItem(STORAGE_PREFIX + businessId);
  } catch {
    return null; // storage unavailable
  }
}

export function storeReportTab(businessId: string | null, tab: ReportTab): void {
  const index = REPORT_TABS.indexOf(tab);
  if (!businessId || index < 0) return;
  try {
    // Write the constant from REPORT_TABS (looked up by index) rather than the
    // caller's value: only a known tab name can ever reach storage, and static
    // analysis (CodeQL clear-text-storage) can see that too.
    localStorage.setItem(STORAGE_PREFIX + businessId, REPORT_TABS[index]);
  } catch {
    // storage unavailable — the URL still carries the tab
  }
}

/** URL tab wins, then this business's remembered tab, then the default — each only if available. */
export function resolveReportTab(
  fromUrl: string | undefined,
  stored: string | null,
  isGstRegistered: boolean,
): ReportTab {
  return asAvailableTab(fromUrl, isGstRegistered) ?? asAvailableTab(stored, isGstRegistered) ?? DEFAULT_TAB;
}
