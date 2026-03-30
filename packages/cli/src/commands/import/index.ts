import * as fs from "fs";
import * as path from "path";
import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success, warn } from "../../output.js";

function readJsonFile(filePath: string): unknown[] {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) fatalError(`File not found: ${abs}`, EXIT.NOT_FOUND);
  const raw = fs.readFileSync(abs, "utf-8");
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) fatalError("Expected a JSON array", EXIT.USAGE);
    return parsed as unknown[];
  } catch {
    fatalError(`Invalid JSON in file: ${abs}`, EXIT.USAGE);
  }
}

function readCsvFile(filePath: string): Array<Record<string, string>> {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) fatalError(`File not found: ${abs}`, EXIT.NOT_FOUND);
  const lines = fs.readFileSync(abs, "utf-8").split("\n").filter((l) => l.trim());
  if (lines.length < 2) fatalError("CSV must have at least a header row and one data row", EXIT.USAGE);
  const headers = (lines[0] ?? "").split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const vals = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
    return obj;
  });
}

export async function importPartiesCommand(filePath: string, opts: { json?: boolean; format?: string }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  const fmt = opts.format ?? (filePath.endsWith(".csv") ? "csv" : "json");
  const data = fmt === "csv"
    ? readCsvFile(filePath)
    : readJsonFile(filePath) as Array<Record<string, unknown>>;

  console.log(`  Importing ${data.length} parties...`);

  try {
    const result = await client.import.importParties({ parties: data as Array<Record<string, unknown>> });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Imported: ${result.imported} parties`);
    if (result.skipped > 0) warn(`Skipped: ${result.skipped}`);
    result.errors.forEach((e) => console.error(`  Row ${e.row}: ${e.message}`));

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

export async function importItemsCommand(filePath: string, opts: { json?: boolean; format?: string }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  const fmt = opts.format ?? (filePath.endsWith(".csv") ? "csv" : "json");
  const data = fmt === "csv"
    ? readCsvFile(filePath)
    : readJsonFile(filePath) as Array<Record<string, unknown>>;

  console.log(`  Importing ${data.length} items...`);

  try {
    const result = await client.import.importItems({ items: data as Array<Record<string, unknown>> });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Imported: ${result.imported} items`);
    if (result.skipped > 0) warn(`Skipped: ${result.skipped}`);
    result.errors.forEach((e) => console.error(`  Row ${e.row}: ${e.message}`));

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
