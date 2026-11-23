import { sql } from "drizzle-orm";
import { businessDayStart } from "@hisaabo/shared";

// ── Date parsing helper ──────────────────────────────────────────────────────
// Handles: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, MM/DD/YYYY, "22 Mar 2026", ISO strings.
// A date without a time is a calendar day on the business calendar: 00:00 IST, whatever the
// server's zone (a server-local midnight is a different instant, and day, on every server).
const MONTH_ABBR = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function istDay(year: number, month1: number, day: number): Date | null {
  const check = new Date(Date.UTC(year, month1 - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month1 - 1 || check.getUTCDate() !== day) return null;
  return businessDayStart({ year, month: month1, day });
}

export function parseFlexibleDate(str: string): Date | null {
  if (!str || !str.trim()) return null;
  const s = str.trim();

  // ISO format: YYYY-MM-DD (a day) or a full datetime (an instant)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = istDay(parseInt(s.slice(0, 4), 10), parseInt(s.slice(5, 7), 10), parseInt(s.slice(8, 10), 10));
    if (d) return d;
  } else if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const iso = new Date(s);
    if (!isNaN(iso.getTime())) return iso;
  }

  // DD/MM/YYYY or DD-MM-YYYY (Indian format — most common in myBillBook exports)
  const ddmmyyyy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    const d = istDay(parseInt(yyyy!, 10), parseInt(mm!, 10), parseInt(dd!, 10));
    if (d) return d;
  }

  // "22 Mar 2026" or "22-Mar-2026"
  const dMonY = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,})[\s-](\d{4})$/);
  if (dMonY) {
    const month = MONTH_ABBR.indexOf(dMonY[2]!.slice(0, 3).toLowerCase());
    if (month >= 0) {
      const d = istDay(parseInt(dMonY[3]!, 10), month + 1, parseInt(dMonY[1]!, 10));
      if (d) return d;
    }
  }

  // Last resort — let JS try to parse it
  const fallback = new Date(s);
  if (!isNaN(fallback.getTime())) return fallback;

  return null;
}

// ── Shared invoice status UPDATE SQL ────────────────────────────────────────
// Set-based form: adds `addAmount` to amount_paid for many invoices in one
// statement and derives status with the same CASE logic. Callers pass unique
// invoice ids and chunk to a few hundred rows per call.
export function buildInvoiceStatusBatchUpdate(
  rows: Array<{ invoiceId: string; addAmount: string }>,
  businessId: string,
) {
  const values = sql.join(
    rows.map((r) => sql`(${r.invoiceId}::uuid, ${r.addAmount}::numeric)`),
    sql`, `,
  );
  return sql`
    UPDATE invoices SET
      amount_paid = invoices.amount_paid::numeric + v.add_amount,
      status = CASE
        WHEN (invoices.amount_paid::numeric + v.add_amount) >= invoices.total_amount::numeric THEN 'paid'
        WHEN (invoices.amount_paid::numeric + v.add_amount) > 0 THEN 'partial'
        ELSE invoices.status
      END,
      updated_at = NOW()
    FROM (VALUES ${values}) AS v(id, add_amount)
    WHERE invoices.id = v.id AND invoices.business_id = ${businessId}
  `;
}
