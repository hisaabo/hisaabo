import { Command } from "commander";
import { gstR1Command, gstR3bCommand, gstR1CsvCommand } from "../../commands/gst/index.js";

export function registerGstCommands(program: Command): void {
  // ── gst ───────────────────────────────────────────────────────────────────

  const gst = program.command("gst").description("GST reports");

  gst
    .command("r1")
    .description("GSTR-1 report")
    .option("--json", "JSON output")
    .option("--quarter <q>", "Quarter: Q1, Q2, Q3, Q4")
    .option("--month <n>", "Month number (1-12)", parseInt)
    .option("--year <n>", "Year", parseInt)
    .action(async (opts) => {
      await gstR1Command({ json: opts.json, quarter: opts.quarter, month: opts.month, year: opts.year });
    });

  gst
    .command("r3b")
    .description("GSTR-3B report")
    .option("--json", "JSON output")
    .option("--quarter <q>", "Quarter: Q1, Q2, Q3, Q4")
    .option("--month <n>", "Month number (1-12)", parseInt)
    .option("--year <n>", "Year", parseInt)
    .action(async (opts) => {
      await gstR3bCommand({ json: opts.json, quarter: opts.quarter, month: opts.month, year: opts.year });
    });

  gst
    .command("r1-csv")
    .description("Download GSTR-1 as GSTN-compatible CSV")
    .option("--quarter <q>", "Quarter")
    .option("--month <n>", "Month", parseInt)
    .option("--year <n>", "Year", parseInt)
    .option("--output <path>", "Output file path")
    .action(async (opts) => {
      await gstR1CsvCommand({ quarter: opts.quarter, month: opts.month, year: opts.year, output: opts.output });
    });
}
