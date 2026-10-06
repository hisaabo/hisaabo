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
export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "-";
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return String(date);
    const day = String(d.getDate()).padStart(2, "0");
    const month = MONTHS[d.getMonth()];
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  } catch {
    return String(date);
  }
}

/**
 * Relative date — "Today", "Yesterday", "2d ago", etc.
 */
export function formatRelativeDate(date: string | Date | null | undefined): string {
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
    return date ? String(date) : "-";
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

// Date/time-zone helpers live in dates.ts (dependency-free, unit-tested directly).
export * from "./dates.js";
