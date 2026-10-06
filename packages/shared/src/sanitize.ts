/**
 * Output-sanitisation helpers shared by the API, CLI, MCP and web.
 *
 * - `csvCell`: RFC 4180 quoting plus spreadsheet formula-injection guard.
 * - `stripControlChars`: removes C0/C1 control characters (terminal escape
 *   sequences, OSC/CSI introducers) and Unicode bidi overrides from
 *   untrusted text before it is printed or handed to an LLM.
 */

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Serialise one value as a CSV cell. Always quoted; embedded quotes are
 * doubled; values that a spreadsheet would interpret as a formula
 * (leading `= + - @ TAB CR`) are neutralised with a leading apostrophe.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let s = typeof value === "string" ? value : String(value);
  // Plain negative numbers are data, not formulas.
  const isPlainNumber = typeof value === "number" || /^-?\d+(\.\d+)?$/.test(s);
  if (!isPlainNumber && FORMULA_PREFIX.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Join cells into one CSV line (no trailing newline). */
export function csvRow(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(",");
}

// C0 (except \t \n), DEL, C1, and Unicode bidi embedding/override/isolate marks.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/** Replace control and bidi-override characters with U+FFFD. */
export function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS, "�");
}
