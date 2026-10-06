import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT } from "../../output.js";
import { formatAmount, quarterRange, formatDate } from "../../format.js";
import { safeFilename, writeFileSafe } from "../../safety.js";

interface GstOpts {
  json?: boolean;
  quarter?: string;
  month?: number;
  year?: number;
}

function resolveMonthYear(opts: GstOpts): { month: number; year: number } {
  if (opts.quarter) {
    const range = quarterRange(opts.quarter);
    return { month: range.month, year: range.year };
  }
  const now = new Date();
  return {
    month: opts.month ?? (now.getMonth() + 1),
    year: opts.year ?? now.getFullYear(),
  };
}

export async function gstR1Command(opts: GstOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const { month, year } = resolveMonthYear(opts);

  try {
    const report = await client.gst.gstr1({ month, year });

    if (opts.json) {
      outputJSON(report);
      return;
    }

    const quarterLabel = opts.quarter ? `${opts.quarter} ` : "";
    console.log(`\n GSTR-1 Summary                        ${quarterLabel}FY ${year}-${String(year + 1).slice(2)}`);
    console.log(` ${"═".repeat(60)}\n`);

    console.log(`  Total Taxable:    ${formatAmount(report.totalTaxableValue)}`);
    console.log(`  Total Tax:         ${formatAmount(report.totalTax)}`);
    console.log(`  Total Invoices:    ${report.invoiceCount}`);
    console.log();
    console.log("  Use --json for full report data.");
    console.log("  Use: hisaabo gst r1-csv to download GSTN-compatible CSV.\n");

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

export async function gstR3bCommand(opts: GstOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const { month, year } = resolveMonthYear(opts);

  try {
    const report = await client.gst.gstr3b({ month, year });

    if (opts.json) {
      outputJSON(report);
      return;
    }

    console.log(`\n GSTR-3B Summary                       ${month}/${year}`);
    console.log(` ${"═".repeat(60)}\n`);

    const rows: Array<[string, number]> = [
      ["Outward taxable value", report.outwardSupplies.taxable.taxableValue],
      ["Outward tax (IGST)", report.outwardSupplies.taxable.igst],
      ["Outward tax (CGST)", report.outwardSupplies.taxable.cgst],
      ["Outward tax (SGST)", report.outwardSupplies.taxable.sgst],
      ["Eligible ITC (total)", report.itc.total],
      ["Net tax payable (total)", report.netTax.total],
    ];
    for (const [label, value] of rows) {
      console.log(`  ${label.padEnd(28)}: ${formatAmount(value)}`);
    }
    console.log();

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

export async function gstR1CsvCommand(opts: GstOpts & { output?: string }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const { month, year } = resolveMonthYear(opts);

  try {
    const result = await client.gst.gstr1CSV({ month, year });
    const outputPath = opts.output ?? safeFilename(result.filename, "gstr1.csv");
    writeFileSafe(outputPath, result.csv);
    console.log(`  Saved: ${outputPath}`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

export async function gstR9Command(financialYear: string, opts: GstOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  // "2023-24" -> start year 2023 (the server keys GSTR-9 by FY start year)
  const startYear = /^\d{4}(-\d{2})?$/.test(financialYear) ? Number(financialYear.slice(0, 4)) : NaN;
  if (!Number.isInteger(startYear)) {
    fatalError("Financial year must look like 2023-24.", EXIT.USAGE);
  }

  try {
    const report = await client.gst.gstr9({ financialYear: startYear });

    if (opts.json) {
      outputJSON(report);
      return;
    }

    console.log(`\n GSTR-9 Annual Return — FY ${financialYear}`);
    console.log(` ${"═".repeat(60)}\n`);

    const t = report.partIITotals;
    const itc = report.table6.netItc;
    console.log(`  Total Turnover:   ${formatAmount(t.taxableValue)}`);
    console.log(`  Total Tax:         ${formatAmount(t.cgst + t.sgst + t.igst + t.cess)}`);
    console.log(`  Total ITC:         ${formatAmount(itc.cgst + itc.sgst + itc.igst + itc.cess)}`);
    console.log();
    console.log("  Use --json for full GSTR-9 data.\n");

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

export async function gstr2bUploadsCommand(opts: GstOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.gst.gstr2bUploads();

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const uploads = result.uploads;

    console.log("\n GSTR-2B Uploads\n");
    console.log(` ${"═".repeat(60)}\n`);

    if (uploads.length === 0) {
      console.log("  No uploads found.\n");
      return;
    }

    for (const up of uploads) {
      const id = up.id.slice(0, 8);
      const period = up.returnPeriod.padEnd(10);
      const date = formatDate(up.uploadedAt);
      const records = String(up.totalRecords).padStart(8);
      console.log(`  ${id}  ${period} ${date.padEnd(13)} Records: ${records}`);
    }
    console.log();

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
