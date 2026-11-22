/**
 * Helpers for the web "Tally Export" report (Reports > Tally Export).
 *
 * The report downloads Tally Prime XML from `reports.tallyExport`, the format
 * Tally actually imports (Gateway of Tally > Import). It used to download a CSV
 * from `party.tallyExport`, which Tally cannot import (that procedure is now
 * deprecated).
 */

/**
 * `reports.tallyExport` requires both bounds, but "All" (and a half-filled custom
 * range) has none. A missing bound becomes one of these, which lie outside any
 * date a voucher can carry, so "All" cuts nothing off, future-dated entries
 * included.
 */
export const TALLY_EXPORT_UNBOUNDED_FROM = "1900-01-01T00:00:00.000Z";
export const TALLY_EXPORT_UNBOUNDED_TO = "9999-12-31T23:59:59.999Z";

type Range = { fromDate?: string; toDate?: string };

/** Fill in the bounds `reports.tallyExport` requires; a missing side is unbounded. */
export function resolveTallyRange(range: Range): { fromDate: string; toDate: string } {
  return {
    fromDate: range.fromDate || TALLY_EXPORT_UNBOUNDED_FROM,
    toDate: range.toDate || TALLY_EXPORT_UNBOUNDED_TO,
  };
}

/**
 * Name of the downloaded file. The server names the file after the dates it was
 * given, which would read "1900-01-01-to-9999-12-31" for an open range, so a
 * missing side is named here instead.
 */
export function tallyExportFilename(range: Range, serverFilename: string): string {
  if (!range.fromDate && !range.toDate) return "tally-export-all.xml";
  if (range.fromDate && range.toDate) return serverFilename;
  return `tally-export-${range.fromDate?.slice(0, 10) ?? "start"}-to-${range.toDate?.slice(0, 10) ?? "latest"}.xml`;
}

/** Number of vouchers in a generated Tally XML document (ledger masters are not counted). */
export function countTallyVouchers(xml: string): number {
  return (xml.match(/<VOUCHER[\s>]/g) ?? []).length;
}

export function tallyXmlBlob(xml: string): Blob {
  return new Blob([xml], { type: "application/xml;charset=utf-8" });
}
