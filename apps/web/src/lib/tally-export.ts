/**
 * Helpers for the web "Tally Export" report (Reports > Tally Export).
 *
 * The report downloads Tally Prime XML from `reports.tallyExport`, the format
 * Tally actually imports (Gateway of Tally > Import). It used to download a CSV
 * from `party.tallyExport`, which Tally cannot import (that procedure is now
 * deprecated).
 */

/** `reports.tallyExport` requires both bounds; "All" has neither, so it starts here. */
export const TALLY_EXPORT_ALL_TIME_FROM = "2000-01-01T00:00:00.000Z";

/**
 * Fill in the bounds `reports.tallyExport` requires. The date-range bar yields
 * `undefined` for the "All" preset (and for an unfilled custom range): the start
 * becomes {@link TALLY_EXPORT_ALL_TIME_FROM} and the end becomes the end of
 * today (UTC, like every other preset boundary), so a later-dated entry is never
 * silently cut off.
 */
export function resolveTallyRange(
  range: { fromDate?: string; toDate?: string },
  now: Date = new Date(),
): { fromDate: string; toDate: string } {
  const endOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999),
  ).toISOString();
  return {
    fromDate: range.fromDate || TALLY_EXPORT_ALL_TIME_FROM,
    toDate: range.toDate || endOfToday,
  };
}

/** Number of vouchers in a generated Tally XML document (ledger masters are not counted). */
export function countTallyVouchers(xml: string): number {
  return (xml.match(/<VOUCHER[\s>]/g) ?? []).length;
}

export function tallyXmlBlob(xml: string): Blob {
  return new Blob([xml], { type: "application/xml;charset=utf-8" });
}
