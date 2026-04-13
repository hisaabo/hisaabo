import chalk from "chalk";
import { hasColor } from "./output.js";

// ── INR formatting ─────────────────────────────────────────────────────────

/**
 * Format a decimal string as Indian-locale currency with ₹ symbol.
 * Uses en-IN grouping (lakh/crore system).
 */
export function formatINR(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "0.00";
  const abs = Math.abs(num);
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);
  return (num < 0 ? "-" : "") + "₹" + formatted;
}

/**
 * Format for table cells — no ₹ symbol (column header has it).
 */
export function formatAmount(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "0.00";
  const abs = Math.abs(num);
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);
  return (num < 0 ? "-" : "") + formatted;
}

// ── Date formatting ────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Format ISO date string as "dd MMM yyyy" (en-IN style).
 */
export function formatDate(date: string | null | undefined): string {
  if (!date) return "-";
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return date;
    const day = String(d.getDate()).padStart(2, "0");
    const month = MONTHS[d.getMonth()];
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  } catch {
    return date;
  }
}

/**
 * Relative date — "Today", "Yesterday", "2d ago", etc.
 */
export function formatRelativeDate(date: string | null | undefined): string {
  if (!date) return "-";
  try {
    const d = new Date(date);
    const now = new Date();
    const diff = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    if (diff < 30) return `${diff}d ago`;
    if (diff < 365) return `${Math.floor(diff / 30)}mo ago`;
    return `${Math.floor(diff / 365)}y ago`;
  } catch {
    return date ?? "-";
  }
}

// ── Status badges ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: (s: string) => string }> = {
  paid:        { label: "PAID",    color: (s) => chalk.green(s) },
  sent:        { label: "SENT",    color: (s) => chalk.blue(s) },
  draft:       { label: "DRAFT",   color: (s) => chalk.dim(s) },
  partial:     { label: "PARTIAL", color: (s) => chalk.yellow(s) },
  overdue:     { label: "OVERDUE", color: (s) => chalk.red(s) },
  cancelled:   { label: "CANCEL",  color: (s) => chalk.dim(chalk.strikethrough(s)) },
  adjusted:    { label: "ADJUST",  color: (s) => chalk.magenta(s) },
  unfulfilled: { label: "UNFUL",   color: (s) => chalk.blue(s) },
  pending:     { label: "PEND",    color: (s) => chalk.yellow(s) },
  confirmed:   { label: "CONF",    color: (s) => chalk.blue(s) },
  delivered:   { label: "DELIV",   color: (s) => chalk.green(s) },
  shipped:     { label: "SHIPPED", color: (s) => chalk.blue(s) },
  in_transit:  { label: "TRANSIT", color: (s) => chalk.cyan(s) },
  returned:    { label: "RETURN",  color: (s) => chalk.red(s) },
  preparing:   { label: "PREP",    color: (s) => chalk.yellow(s) },
  ready:       { label: "READY",   color: (s) => chalk.cyan(s) },
};

export function formatStatus(status: string): string {
  const cfg = STATUS_CONFIG[status.toLowerCase()];
  const label = cfg ? `[${cfg.label}]` : `[${status.toUpperCase()}]`;
  if (!hasColor() || !cfg) return label;
  return cfg.color(label);
}

// ── Financial year ─────────────────────────────────────────────────────────

/**
 * Current FY string, e.g. "2025-26". Assumes FY starts April 1.
 */
export function currentFY(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-indexed
  if (month >= 4) {
    return `${year}-${String(year + 1).slice(2)}`;
  }
  return `${year - 1}-${String(year).slice(2)}`;
}

/**
 * FY start date as ISO string (April 1 of current FY).
 */
export function fyStart(): string {
  const now = new Date();
  const year = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-04-01`;
}

/**
 * Today as ISO date string.
 */
export function todayISO(): string {
  return new Date().toISOString().split("T")[0] ?? "";
}

/**
 * First day of current month.
 */
export function monthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Last day of current month.
 */
export function monthEnd(): string {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
}

/**
 * Quarter start/end for a quarter string like "Q1", "Q2", "Q3", "Q4".
 * Q1 = Apr-Jun, Q2 = Jul-Sep, Q3 = Oct-Dec, Q4 = Jan-Mar
 */
export function quarterRange(q: string): { from: string; to: string; month: number; year: number } {
  const now = new Date();
  const fyYear = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;

  const ranges: Record<string, { from: string; to: string; month: number; year: number }> = {
    Q1: { from: `${fyYear}-04-01`, to: `${fyYear}-06-30`, month: 4, year: fyYear },
    Q2: { from: `${fyYear}-07-01`, to: `${fyYear}-09-30`, month: 7, year: fyYear },
    Q3: { from: `${fyYear}-10-01`, to: `${fyYear}-12-31`, month: 10, year: fyYear },
    Q4: { from: `${fyYear + 1}-01-01`, to: `${fyYear + 1}-03-31`, month: 1, year: fyYear + 1 },
  };

  const upper = q.toUpperCase();
  return ranges[upper] ?? ranges["Q1"]!;
}

export function deliveryMethodLabel(method: string): string {
  const map: Record<string, string> = {
    self_pickup: "Self Pickup",
    hand_delivery: "Hand Delivery",
    courier: "Courier",
    bus: "Bus",
    transport: "Transport",
    post: "Post",
  };
  return map[method] ?? method;
}
