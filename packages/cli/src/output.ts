import chalk from "chalk";
import { csvCell, stripControlChars } from "@hisaabo/shared";

// ── Environment detection ──────────────────────────────────────────────────

export function isInteractive(): boolean {
  return process.stdout.isTTY === true;
}

export function hasColor(): boolean {
  if (process.env["NO_COLOR"] !== undefined) return false;
  if (process.env["FORCE_COLOR"] === "0") return false;
  return process.stdout.hasColors?.() ?? isInteractive();
}

// ── Strip ANSI ─────────────────────────────────────────────────────────────

export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Neutralise terminal escape/control characters in untrusted text. Colour
 * (SGR) sequences are kept so our own chalk styling survives; every other
 * control sequence introducer is replaced.
 */
export function sanitizeTerminal(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.split(/(\x1b\[[0-9;]*m)/).map((part, i) => (i % 2 === 1 ? part : stripControlChars(part))).join("");
}

/**
 * Defence in depth: route every string written to stdout/stderr (including
 * console.*) through sanitizeTerminal so server-supplied text can't inject
 * escape sequences. A single leading CR is kept for in-place progress lines.
 */
export function installTerminalSanitizer(): void {
  for (const stream of [process.stdout, process.stderr]) {
    const orig = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean;
    stream.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
      if (typeof chunk === "string") {
        const lead = chunk.startsWith("\r") ? "\r" : "";
        chunk = lead + sanitizeTerminal(chunk.slice(lead.length));
      }
      return orig(chunk, ...rest);
    }) as typeof stream.write;
  }
}

/** Sanitise a table cell: no control chars and no line breaks. */
function cellText(str: string): string {
  return sanitizeTerminal(str).replace(/[\r\n\t]+/g, " ");
}

// ── Terminal width tiers ──────────────────────────────────────────────────

export type WidthTier = "narrow" | "standard" | "wide";

export function getWidthTier(): WidthTier {
  const w = process.stdout.columns ?? 80;
  if (w < 80) return "narrow";
  if (w <= 120) return "standard";
  return "wide";
}

export function termWidth(): number {
  return process.stdout.columns ?? 80;
}

// ── Exit codes ────────────────────────────────────────────────────────────

export const EXIT = {
  SUCCESS: 0,
  GENERAL: 1,
  USAGE: 2,
  AUTH: 3,
  FORBIDDEN: 4,
  NOT_FOUND: 5,
  VALIDATION: 6,
  NETWORK: 7,
  CONFLICT: 8,
  RATE_LIMITED: 9,
} as const;

// ── Output helpers ────────────────────────────────────────────────────────

export function fatalError(message: string, code = 1): never {
  if (hasColor()) {
    process.stderr.write(chalk.red("Error: ") + sanitizeTerminal(message) + "\n");
  } else {
    process.stderr.write("Error: " + sanitizeTerminal(message) + "\n");
  }
  process.exit(code);
}

export function success(message: string): void {
  if (hasColor()) {
    process.stdout.write(chalk.green("✓ ") + sanitizeTerminal(message) + "\n");
  } else {
    process.stdout.write("OK: " + sanitizeTerminal(message) + "\n");
  }
}

export function warn(message: string): void {
  if (hasColor()) {
    process.stderr.write(chalk.yellow("Warning: ") + sanitizeTerminal(message) + "\n");
  } else {
    process.stderr.write("Warning: " + sanitizeTerminal(message) + "\n");
  }
}

// ── JSON output ───────────────────────────────────────────────────────────

export function outputJSON(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

// ── Table output ──────────────────────────────────────────────────────────

export interface ColumnDef<T extends object> {
  /** A property of the row, or a dotted path into a nested object (e.g. "party.name"). */
  key: (keyof T & string) | `${string}.${string}`;
  header: string;
  width?: number;
  align?: "left" | "right";
  format?: (value: unknown, row: T) => string;
}

function getNestedValue(obj: object, key: string): unknown {
  const parts = key.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function cellValue<T extends object>(col: ColumnDef<T>, row: T): string {
  const raw = col.format
    ? col.format(getNestedValue(row, col.key as string), row)
    : String(getNestedValue(row, col.key as string) ?? "");
  return cellText(raw);
}

function padEnd(str: string, len: number): string {
  const visual = stripAnsi(str).length;
  const pad = Math.max(0, len - visual);
  return str + " ".repeat(pad);
}

function padStart(str: string, len: number): string {
  const visual = stripAnsi(str).length;
  const pad = Math.max(0, len - visual);
  return " ".repeat(pad) + str;
}

export function outputTable<T extends object>(rows: T[], columns: ColumnDef<T>[]): void {
  if (rows.length === 0) {
    process.stdout.write("  (no results)\n");
    return;
  }

  // Compute column widths
  const widths = columns.map((col) => {
    let max = stripAnsi(col.header).length;
    for (const row of rows) {
      const vis = stripAnsi(cellValue(col, row)).length;
      if (vis > max) max = vis;
    }
    if (col.width) max = Math.min(max, col.width);
    return max;
  });

  const sep = "─".repeat(widths.reduce((s, w) => s + w + 2, 1));

  // Header
  let header = " ";
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    const hdr = cellText(col.header);
    const h = col.align === "right"
      ? padStart(hdr, widths[i])
      : padEnd(hdr, widths[i]);
    header += (hasColor() ? chalk.dim(h) : h) + "  ";
  }
  process.stdout.write(" " + (hasColor() ? chalk.dim(sep) : sep) + "\n");
  process.stdout.write(header.trimEnd() + "\n");
  process.stdout.write(" " + (hasColor() ? chalk.dim(sep) : sep) + "\n");

  // Rows
  for (const row of rows) {
    let line = " ";
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      let val = cellValue(col, row);
      // Truncate if needed
      const vis = stripAnsi(val).length;
      if (col.width && vis > col.width) {
        val = val.slice(0, col.width - 1) + "…";
      }
      const cell = col.align === "right"
        ? padStart(val, widths[i])
        : padEnd(val, widths[i]);
      line += cell + "  ";
    }
    process.stdout.write(line.trimEnd() + "\n");
  }

  process.stdout.write(" " + (hasColor() ? chalk.dim(sep) : sep) + "\n");
}

// ── TSV output ────────────────────────────────────────────────────────────

export function outputTSV<T extends object>(rows: T[], columns: ColumnDef<T>[]): void {
  process.stdout.write(columns.map((c) => stripControlChars(c.header).replace(/[\t\r\n]+/g, " ")).join("\t") + "\n");
  for (const row of rows) {
    const line = columns.map((col) => stripAnsi(cellValue(col, row)));
    process.stdout.write(line.join("\t") + "\n");
  }
}

// ── CSV output ────────────────────────────────────────────────────────────

export function outputCSV<T extends object>(rows: T[], columns: ColumnDef<T>[]): void {
  process.stdout.write(columns.map((c) => csvCell(stripControlChars(c.header))).join(",") + "\n");
  for (const row of rows) {
    const line = columns.map((col) => {
      const val = stripAnsi(cellValue(col, row));
      return val === "-" ? '"-"' : csvCell(val); // bare dash is an empty-value placeholder, not a formula
    });
    process.stdout.write(line.join(",") + "\n");
  }
}

// ── ID-only output ────────────────────────────────────────────────────────

export function outputIds(ids: string[]): void {
  for (const id of ids) {
    process.stdout.write(sanitizeTerminal(id).replace(/[\r\n]+/g, " ") + "\n");
  }
}

// ── Pagination footer ─────────────────────────────────────────────────────

export function paginationFooter(page: number, limit: number, total: number): void {
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const msg = `  Showing ${from}-${to} of ${total}`;
  process.stdout.write("\n" + (hasColor() ? chalk.dim(msg) : msg) + "\n");
}
