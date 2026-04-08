import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT } from "../../output.js";
import { formatAmount, quarterRange, formatDate } from "../../format.js";
import * as fs from "fs";

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

    if (report.summary && typeof report.summary === "object") {
      const s = report.summary as Record<string, unknown>;
      if (s["totalTaxableValue"]) console.log(`  Total Taxable:    ${formatAmount(String(s["totalTaxableValue"]))}`);
      if (s["totalTax"]) console.log(`  Total Tax:         ${formatAmount(String(s["totalTax"]))}`);
      if (s["totalInvoices"]) console.log(`  Total Invoices:    ${s["totalInvoices"]}`);
    }
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

    if (report.summary && typeof report.summary === "object") {
      const s = report.summary as Record<string, unknown>;
      Object.entries(s).forEach(([k, v]) => {
        console.log(`  ${k.padEnd(28)}: ${String(v ?? "-")}`);
      });
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
    const outputPath = opts.output ?? result.filename;
    fs.writeFileSync(outputPath, result.csv);
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

  try {
    const report = await client.gst.gstr9({ financialYear });

    if (opts.json) {
      outputJSON(report);
      return;
    }

    console.log(`\n GSTR-9 Annual Return — FY ${financialYear}`);
    console.log(` ${"═".repeat(60)}\n`);

    const r = report as Record<string, unknown>;
    if (r["summary"] && typeof r["summary"] === "object") {
      const s = r["summary"] as Record<string, unknown>;
      if (s["totalTurnover"]) console.log(`  Total Turnover:   ${formatAmount(String(s["totalTurnover"]))}`);
      if (s["totalTax"]) console.log(`  Total Tax:         ${formatAmount(String(s["totalTax"]))}`);
      if (s["totalITC"]) console.log(`  Total ITC:         ${formatAmount(String(s["totalITC"]))}`);
    }
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

    const uploads = Array.isArray(result) ? result
      : Array.isArray(result?.data) ? result.data
      : [];

    console.log("\n GSTR-2B Uploads\n");
    console.log(` ${"═".repeat(60)}\n`);

    if (uploads.length === 0) {
      console.log("  No uploads found.\n");
      return;
    }

    for (const up of uploads as Array<Record<string, unknown>>) {
      const id = String(up["id"] ?? "-").slice(0, 8);
      const period = String(up["period"] ?? up["returnPeriod"] ?? "-").padEnd(10);
      const date = formatDate(String(up["uploadedAt"] ?? up["createdAt"] ?? ""));
      const records = String(up["totalRecords"] ?? up["records"] ?? "-").padStart(8);
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
