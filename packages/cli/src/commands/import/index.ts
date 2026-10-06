import * as fs from "fs";
import * as path from "path";
import { HisaaboClient, HisaaboApiError, type ImportResult } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success, warn } from "../../output.js";
import { parseCsv } from "../../csv.js";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 5000;
const DEFAULT_SOURCE = "hisaabo";

interface ImportOpts {
  json?: boolean;
  format?: string;
  source?: string;
}

function readInputFile(filePath: string): string {
  const abs = path.resolve(filePath);
  let size: number;
  try {
    size = fs.statSync(abs).size;
  } catch {
    return fatalError(`File not found: ${abs}`, EXIT.NOT_FOUND);
  }
  if (size > MAX_FILE_BYTES) {
    fatalError(`File too large (${Math.round(size / 1024 / 1024)} MB; max ${MAX_FILE_BYTES / 1024 / 1024} MB)`, EXIT.USAGE);
  }
  return fs.readFileSync(abs, "utf-8");
}

function readJsonFile(filePath: string): Array<Record<string, unknown>> {
  const raw = readInputFile(filePath);
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) fatalError("Expected a JSON array", EXIT.USAGE);
    return parsed as Array<Record<string, unknown>>;
  } catch {
    return fatalError(`Invalid JSON in file: ${path.resolve(filePath)}`, EXIT.USAGE);
  }
}

function readCsvFile(filePath: string): Array<Record<string, unknown>> {
  let rows: string[][];
  try {
    rows = parseCsv(readInputFile(filePath));
  } catch (e) {
    return fatalError(`Invalid CSV: ${e instanceof Error ? e.message : String(e)}`, EXIT.USAGE);
  }
  if (rows.length < 2) fatalError("CSV must have at least a header row and one data row", EXIT.USAGE);
  const headers = (rows[0] ?? []).map((h) => h.trim());
  return rows.slice(1).map((vals) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
    return obj;
  });
}

function loadRows(filePath: string, opts: ImportOpts): Array<Record<string, unknown>> {
  const fmt = opts.format ?? (filePath.toLowerCase().endsWith(".csv") ? "csv" : "json");
  if (fmt !== "csv" && fmt !== "json") fatalError("--format must be json or csv", EXIT.USAGE);
  const data = fmt === "csv" ? readCsvFile(filePath) : readJsonFile(filePath);
  if (data.length > MAX_ROWS) {
    fatalError(`Too many rows (${data.length}; max ${MAX_ROWS} per import). Split the file.`, EXIT.USAGE);
  }
  return data;
}

function resolveSource(opts: ImportOpts): string {
  const source = opts.source ?? DEFAULT_SOURCE;
  if (!/^[a-z0-9_-]{1,50}$/i.test(source)) fatalError("Invalid --source", EXIT.USAGE);
  return source;
}

async function runImport(
  label: string,
  filePath: string,
  opts: ImportOpts,
  send: (client: HisaaboClient, rows: Array<Record<string, unknown>>, source: string) => Promise<ImportResult>,
): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const source = resolveSource(opts);
  const data = loadRows(filePath, opts);

  console.log(`  Importing ${data.length} ${label}...`);

  try {
    const result = await send(client, data, source);

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Imported: ${result.imported} ${label}`);
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

export function importPartiesCommand(filePath: string, opts: ImportOpts): Promise<void> {
  return runImport("parties", filePath, opts, (c, parties, source) => c.import.importParties({ source, parties }));
}

export function importItemsCommand(filePath: string, opts: ImportOpts): Promise<void> {
  return runImport("items", filePath, opts, (c, items, source) => c.import.importItems({ source, items }));
}

export function importInvoicesCommand(filePath: string, opts: ImportOpts): Promise<void> {
  return runImport("invoices", filePath, opts, (c, invoices, source) => c.import.importInvoices({ source, invoices }));
}

export function importPaymentsCommand(filePath: string, opts: ImportOpts): Promise<void> {
  return runImport("payments", filePath, opts, (c, payments, source) => c.import.importPayments({ source, payments }));
}
