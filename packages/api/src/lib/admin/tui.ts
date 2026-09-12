/**
 * tui.ts — Zero-dependency terminal rendering toolkit for the admin dashboard.
 *
 * Everything in here is pure: functions take data + a width and return
 * arrays of strings (one per terminal row). Nothing touches stdout, so the
 * whole layer is unit-testable and works identically for the live TUI, the
 * `--once` snapshot, and the demo mode.
 *
 * Colours use the 256-colour ANSI palette, which every terminal that reaches
 * a `docker exec -it` prompt supports. Honour NO_COLOR / --no-color.
 */

// ── ANSI primitives ─────────────────────────────────────────────

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

let colorEnabled = !("NO_COLOR" in process.env) && process.env.TERM !== "dumb";

export function setColorEnabled(enabled: boolean): void {
  colorEnabled = enabled;
}

export function isColorEnabled(): boolean {
  return colorEnabled;
}

/**
 * Wrap `s` in an SGR sequence. Inner resets are re-opened so nested styles
 * compose: bold("a " + red("b") + " c") keeps "c" bold.
 */
function wrap(open: string, s: string): string {
  if (!colorEnabled || s === "") return s;
  return open + s.split(RESET).join(RESET + open) + RESET;
}

const fg = (n: number) => (s: string) => wrap(`${ESC}38;5;${n}m`, s);
const bg = (n: number) => (s: string) => wrap(`${ESC}48;5;${n}m`, s);

export type Style = (s: string) => string;

/** Palette — tuned to read well on both dark and light terminal themes. */
export const c = {
  bold: (s: string) => wrap(`${ESC}1m`, s),
  dim: (s: string) => wrap(`${ESC}2m`, s),
  italic: (s: string) => wrap(`${ESC}3m`, s),
  inverse: (s: string) => wrap(`${ESC}7m`, s),
  brand: fg(214),      // saffron — Hisaabo accent
  brandBg: bg(214),
  ink: fg(236),        // near-black, for text on brandBg
  ok: fg(78),
  warn: fg(220),
  bad: fg(203),
  info: fg(75),
  violet: fg(141),
  teal: fg(80),
  muted: fg(245),
  faint: fg(240),
  white: fg(255),
  panelBg: bg(235),
} as const;

export const PLAN_STYLE: Record<string, Style> = {
  free: c.muted,
  pro: c.info,
  business: c.violet,
  enterprise: c.brand,
};

export const STATUS_STYLE: Record<string, Style> = {
  active: c.ok,
  suspended: c.warn,
  deleted: c.bad,
  paid: c.ok,
  partial: c.info,
  sent: c.teal,
  unfulfilled: c.violet,
  overdue: c.bad,
  draft: c.muted,
  cancelled: c.faint,
  adjusted: c.muted,
};

// ── Width-aware string helpers ──────────────────────────────────

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

function isZeroWidth(cp: number): boolean {
  return (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0xfeff
  );
}

function charWidth(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (isZeroWidth(cp)) return 0;
  return isWide(cp) ? 2 : 1;
}

/** Visible column width of a string, ignoring ANSI escapes. */
export function width(s: string): number {
  let w = 0;
  for (const ch of stripAnsi(s)) w += charWidth(ch);
  return w;
}

/**
 * Truncate to `max` columns, appending an ellipsis when cut. ANSI-aware:
 * escape sequences are kept and a reset is appended so styles never leak.
 */
export function truncate(s: string, max: number, ellipsis = "…"): string {
  if (max <= 0) return "";
  if (width(s) <= max) return s;
  const ellW = width(ellipsis);
  const budget = Math.max(0, max - ellW);
  let out = "";
  let w = 0;
  let hadAnsi = false;
  const tokens = s.split(/(\x1b\[[0-9;?]*[A-Za-z])/); // eslint-disable-line no-control-regex
  outer: for (const tok of tokens) {
    if (tok === "") continue;
    if (tok.startsWith("\x1b[")) {
      out += tok;
      hadAnsi = true;
      continue;
    }
    for (const ch of tok) {
      const cw = charWidth(ch);
      if (w + cw > budget) break outer;
      out += ch;
      w += cw;
    }
  }
  return out + (hadAnsi ? RESET : "") + ellipsis;
}

export type Align = "left" | "right" | "center";

/** Pad (never truncate) a possibly-styled string to exactly `w` columns. */
export function pad(s: string, w: number, align: Align = "left"): string {
  const gap = w - width(s);
  if (gap <= 0) return s;
  if (align === "right") return " ".repeat(gap) + s;
  if (align === "center") {
    const left = Math.floor(gap / 2);
    return " ".repeat(left) + s + " ".repeat(gap - left);
  }
  return s + " ".repeat(gap);
}

/** Truncate then pad — guarantees exactly `w` columns. */
export function fit(s: string, w: number, align: Align = "left"): string {
  return pad(truncate(s, w), w, align);
}

/** Left text and right text on one line of `w` columns, gap-filled. */
export function spread(left: string, right: string, w: number, fill = " "): string {
  const lw = width(left);
  const rw = width(right);
  if (lw + rw + 1 > w) return fit(left + " " + right, w);
  return left + fill.repeat(w - lw - rw) + right;
}

export function repeat(ch: string, n: number): string {
  return n > 0 ? ch.repeat(n) : "";
}

// ── Layout ──────────────────────────────────────────────────────

/** Place blocks (arrays of equal-width rows) side by side. */
export function hstack(blocks: string[][], gap = 1): string[] {
  const widths = blocks.map((b) => (b.length ? width(b[0]) : 0));
  const height = Math.max(0, ...blocks.map((b) => b.length));
  const out: string[] = [];
  for (let r = 0; r < height; r++) {
    out.push(
      blocks
        .map((b, i) => (r < b.length ? pad(b[r], widths[i]) : " ".repeat(widths[i])))
        .join(" ".repeat(gap)),
    );
  }
  return out;
}

/** Stack blocks vertically, with `gap` blank rows of `w` columns between. */
export function vstack(blocks: string[][], w: number, gap = 0): string[] {
  const out: string[] = [];
  blocks.forEach((b, i) => {
    if (i > 0 && gap > 0) for (let g = 0; g < gap; g++) out.push(" ".repeat(w));
    out.push(...b);
  });
  return out;
}

/** Pad or trim a block to exactly `h` rows of `w` columns. */
export function fitHeight(block: string[], h: number, w: number): string[] {
  const out = block.slice(0, h).map((l) => fit(l, w));
  while (out.length < h) out.push(" ".repeat(w));
  return out;
}

/** Split `total` columns into `n` widths with `gap` between them. */
export function splitWidth(total: number, n: number, gap = 1): number[] {
  const usable = total - gap * (n - 1);
  const base = Math.floor(usable / n);
  let extra = usable - base * n;
  return Array.from({ length: n }, () => base + (extra-- > 0 ? 1 : 0));
}

// ── Widgets ─────────────────────────────────────────────────────

export interface BoxOptions {
  title?: string;
  width: number;
  /** Fixed outer height (rows). Omit for natural height. */
  height?: number;
  lines: string[];
  border?: Style;
  titleStyle?: Style;
  padX?: number;
  /** Text placed at the right end of the top border. */
  hint?: string;
}

/** Rounded box with an optional embedded title: ╭─ Title ───╮ */
export function box(o: BoxOptions): string[] {
  const border = o.border ?? c.faint;
  const titleStyle = o.titleStyle ?? ((s: string) => c.bold(c.white(s)));
  const padX = o.padX ?? 1;
  const inner = Math.max(0, o.width - 2 - padX * 2);

  const titleText = o.title ? ` ${titleStyle(o.title)} ` : "";
  const hintText = o.hint ? ` ${c.muted(o.hint)} ` : "";
  const dashes = Math.max(0, o.width - 2 - width(titleText) - width(hintText) - 1);
  const top = border("╭─") + titleText + border(repeat("─", dashes)) + hintText + border("╮");
  const bottom = border("╰" + repeat("─", o.width - 2) + "╯");

  let body = o.lines;
  if (o.height !== undefined) {
    const innerH = Math.max(0, o.height - 2);
    body = body.slice(0, innerH);
    while (body.length < innerH) body.push("");
  }
  const side = border("│");
  const gutter = " ".repeat(padX);
  const rows = body.map((l) => side + gutter + fit(l, inner) + gutter + side);
  return [top, ...rows, bottom];
}

export interface KpiOptions {
  label: string;
  value: string;
  sub?: string;
  width: number;
  accent?: Style;
  subStyle?: Style;
}

/** A 5-row stat tile: label / big value / sub-line. */
export function kpiTile(o: KpiOptions): string[] {
  const accent = o.accent ?? c.brand;
  return box({
    width: o.width,
    height: 5,
    border: c.faint,
    lines: [
      c.muted(o.label.toUpperCase()),
      c.bold(accent(o.value)),
      (o.subStyle ?? c.muted)(o.sub ?? ""),
    ],
  });
}

/** Horizontal bar: ██████░░░░ */
export function hbar(value: number, max: number, w: number, style: Style = c.brand): string {
  if (w <= 0) return "";
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  let filled = Math.round(ratio * w);
  if (value > 0 && filled === 0) filled = 1;
  return style(repeat("█", filled)) + c.faint(repeat("░", w - filled));
}

export interface BreakdownItem {
  label: string;
  value: number;
  display?: string;
  style?: Style;
}

/** Label ─ bar ─ value (pct) rows, bars scaled to the largest item. */
export function breakdown(items: BreakdownItem[], w: number, opts: { showPct?: boolean } = {}): string[] {
  if (items.length === 0) return [c.muted("no data")];
  const max = Math.max(...items.map((i) => i.value));
  const total = items.reduce((a, i) => a + i.value, 0);
  const labelW = Math.min(14, Math.max(...items.map((i) => width(i.label))));
  const valueStrs = items.map((i) => i.display ?? fmtInt(i.value));
  const valueW = Math.max(...valueStrs.map(width));
  const pctW = opts.showPct === false ? 0 : 5;
  const barW = Math.max(3, w - labelW - valueW - pctW - 3);
  return items.map((item, idx) => {
    const style = item.style ?? c.brand;
    const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
    const pctStr = pctW ? c.muted(pad(`${pct}%`, 4, "right")) : "";
    return (
      fit(item.label, labelW) + " " + hbar(item.value, max, barW, style) + " " +
      pad(style(valueStrs[idx]), valueW, "right") + (pctW ? " " + pctStr : "")
    );
  });
}

const SPARK = "▁▂▃▄▅▆▇█";

/** One-line sparkline. */
export function sparkline(values: number[], style: Style = c.info): string {
  const max = Math.max(0, ...values);
  return style(
    values
      .map((v) => {
        if (max <= 0 || v <= 0) return SPARK[0];
        const i = Math.min(7, Math.max(1, Math.round((v / max) * 7)));
        return SPARK[i];
      })
      .join(""),
  );
}

export interface ColumnChartOptions {
  values: number[];
  labels: string[];
  width: number;
  /** Rows of bar area (excludes axis + label rows). */
  height: number;
  style?: Style;
  yFormat?: (n: number) => string;
}

const EIGHTHS = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇"];

/**
 * Vertical column chart with sub-cell (1/8 block) resolution.
 * Returns `height + 2` rows: bars, x-axis, labels.
 */
export function columnChart(o: ColumnChartOptions): string[] {
  const style = o.style ?? c.brand;
  const yFormat = o.yFormat ?? ((n: number) => fmtInt(Math.round(n)));
  const max = Math.max(0, ...o.values);
  const yTop = yFormat(max);
  const yMid = yFormat(max / 2);
  const gutter = Math.max(width(yTop), width(yMid), 1) + 1;
  const areaW = Math.max(1, o.width - gutter - 1);

  // Choose bar width + gap that fit; drop oldest points if the area is tiny.
  let values = o.values;
  let labels = o.labels;
  let n = values.length;
  let gap = 1;
  let barW = Math.floor((areaW - gap * (n - 1)) / n);
  if (barW < 1) {
    gap = 0;
    barW = Math.floor(areaW / n);
  }
  if (barW < 1) {
    n = Math.max(1, areaW);
    values = values.slice(-n);
    labels = labels.slice(-n);
    barW = 1;
  }
  // Spread leftover columns into the gaps for a centred, balanced look.
  const used = barW * n + gap * (n - 1);
  const leftPad = Math.floor((areaW - used) / 2);

  const totalEighths = o.height * 8;
  const heights = values.map((v) => (max > 0 && v > 0 ? Math.max(1, Math.round((v / max) * totalEighths)) : 0));

  const rows: string[] = [];
  for (let r = 0; r < o.height; r++) {
    const level = o.height - 1 - r; // 0 = bottom row
    const cells = heights.map((h) => {
      const filledInRow = h - level * 8;
      let ch = " ";
      if (filledInRow >= 8) ch = "█";
      else if (filledInRow > 0) ch = EIGHTHS[filledInRow];
      return ch === " " ? repeat(" ", barW) : style(repeat(ch, barW));
    });
    let label = "";
    if (r === 0) label = yTop;
    else if (r === Math.floor(o.height / 2)) label = yMid;
    else if (r === o.height - 1) label = yFormat(0);
    rows.push(
      c.muted(pad(label, gutter - 1, "right")) + " " + c.faint("│") +
      repeat(" ", leftPad) + cells.join(repeat(" ", gap)),
    );
  }
  rows.push(repeat(" ", gutter) + c.faint("└" + repeat("─", areaW)));

  const slot = barW + gap;
  const labelCells = labels.map((l, i) => {
    const w = i === labels.length - 1 ? barW : slot;
    const text = w >= width(l) ? l : l.slice(0, Math.max(1, w));
    return fit(text, w, "left");
  });
  rows.push(repeat(" ", gutter + 1 + leftPad) + c.muted(labelCells.join("")));
  return rows.map((row) => fit(row, o.width));
}

export interface TableColumn<T> {
  key: keyof T | string;
  label: string;
  align?: Align;
  /** Fixed width; omit for auto (content-sized). */
  width?: number;
  /** The column that absorbs overflow / shrinks first. Exactly one should be flex. */
  flex?: boolean;
  render?: (row: T) => string;
}

export interface TableOptions<T> {
  columns: TableColumn<T>[];
  rows: T[];
  width: number;
  /** Zero-based index of a highlighted row. */
  selected?: number;
  emptyText?: string;
}

/** Column-aligned table with a header rule. Returns rows.length + 2 lines. */
export function table<T extends object>(o: TableOptions<T>): string[] {
  const cellText = (col: TableColumn<T>, row: T): string =>
    col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key as string] ?? "");

  const rendered = o.rows.map((r) => o.columns.map((col) => cellText(col, r)));
  const widths = o.columns.map((col, i) => {
    if (col.width) return col.width;
    const content = Math.max(width(col.label), ...rendered.map((r) => width(r[i])), 1);
    return content;
  });
  const gapTotal = o.columns.length - 1;
  let sum = widths.reduce((a, b) => a + b, 0) + gapTotal;
  const flexIdx = o.columns.findIndex((col) => col.flex);
  if (sum > o.width && flexIdx >= 0) {
    widths[flexIdx] = Math.max(4, widths[flexIdx] - (sum - o.width));
    sum = widths.reduce((a, b) => a + b, 0) + gapTotal;
  }
  if (sum < o.width && flexIdx >= 0) {
    widths[flexIdx] += o.width - sum;
    sum = o.width;
  }

  const line = (cells: string[], style?: Style) => {
    const s = cells.map((cell, i) => fit(cell, widths[i], o.columns[i].align ?? "left")).join(" ");
    return fit(style ? style(s) : s, o.width);
  };

  const out: string[] = [
    line(o.columns.map((col) => c.bold(c.muted(col.label)))),
    fit(c.faint(repeat("─", Math.min(o.width, sum))), o.width),
  ];
  if (rendered.length === 0) {
    out.push(fit(c.muted(o.emptyText ?? "nothing here yet"), o.width));
    return out;
  }
  rendered.forEach((cells, i) => {
    out.push(i === o.selected ? line(cells.map(stripAnsi), c.inverse) : line(cells));
  });
  return out;
}

/** Key-hint chip:  [q] Quit  */
export function key(k: string, label: string): string {
  return c.inverse(c.bold(` ${k} `)) + " " + c.muted(label);
}

// ── Formatting ──────────────────────────────────────────────────

/** Indian digit grouping: 12345678 → "1,23,45,678" */
export function fmtInt(n: number): string {
  const sign = n < 0 ? "-" : "";
  const s = String(Math.round(Math.abs(n)));
  if (s.length <= 3) return sign + s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${sign}${rest},${last3}`;
}

/** Full rupee amount with Indian grouping and 2 decimals: ₹1,23,456.78 */
export function fmtINR(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const whole = Math.floor(abs);
  const paise = Math.round((abs - whole) * 100);
  return `${sign}₹${fmtInt(whole)}.${String(paise).padStart(2, "0")}`;
}

function trimDigits(v: number): string {
  const rounded = Number(v.toFixed(2));
  const digits = rounded < 10 ? 2 : rounded < 100 ? 1 : 0;
  return rounded.toFixed(digits);
}

/** Compact rupee amount in Indian units: ₹1.24 Cr · ₹45.6 L · ₹12,345 */
export function fmtINRCompact(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${sign}₹${trimDigits(abs / 1e7)} Cr`;
  if (abs >= 1e5) return `${sign}₹${trimDigits(abs / 1e5)} L`;
  return `${sign}₹${fmtInt(abs)}`;
}

/** Compact count: 1.2K, 3.4M — for axis labels where space is tight. */
export function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${trimDigits(abs / 1e6)}M`;
  if (abs >= 1e3) return `${trimDigits(abs / 1e3)}K`;
  return fmtInt(n);
}

export function fmtPct(part: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-03" → "Mar" */
export function fmtMonth(ym: string): string {
  const m = Number(ym.slice(5, 7));
  return MONTHS[m - 1] ?? ym;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "5m ago", "3h ago", "2d ago", "3w ago", or a date for anything older. */
export function fmtRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sec = Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000));
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  if (day < 60) return `${Math.round(day / 7)}w ago`;
  return fmtDate(iso);
}

export function fmtClock(d: Date): string {
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

/** Uptime-style: 3d 4h, 5h 12m, 7m */
export function fmtUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
