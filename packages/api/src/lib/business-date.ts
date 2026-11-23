import { gte, lt, lte, type SQL, type SQLWrapper } from "drizzle-orm";
import { businessDateColumnFor, type BusinessDateTable } from "@hisaabo/db";

/**
 * A value accepted as the lower or upper bound of a business-date range.
 * - `Date`: already a JS Date.
 * - `string`: an ISO datetime string from a tRPC input (parsed via `new Date`).
 * - `SQL` / `SQLWrapper`: a raw SQL expression (e.g. `sql\`NOW() - INTERVAL '30 days'\``).
 * - `null` / `undefined`: bound is absent; no condition produced for this side.
 */
export type BusinessDateBound = Date | string | SQL | SQLWrapper | null | undefined;

function coerce(v: BusinessDateBound): Date | SQL | SQLWrapper | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return new Date(v);
  return v;
}

/**
 * Build the WHERE conditions for a user-entered business-date range over a
 * registered document table, using the canonical business-date column
 * declared in `BUSINESS_DATE_COLUMN` / `businessDateColumnFor`.
 *
 * This is the only supported way to filter list/report/dashboard queries by
 * "date". It forbids filtering by `createdAt` by construction — the caller
 * passes a table reference, and the correct column is resolved from the
 * schema registry.
 *
 * Omitted bounds produce no condition for that side.
 *
 * `to` is INCLUSIVE (a user-entered end-of-day such as 23:59:59.999). A computed period
 * (a month, a quarter) should use `before` instead: the EXCLUSIVE start of the next period.
 * A period written as "to 23:59:59" leaves a gap before the next one, and a document stamped
 * in it is in no period. Give `to` or `before`, not both.
 *
 * @example
 *   conditions.push(...buildBusinessDateFilter(invoices, input));
 *
 * @example
 *   // Fixed computed range (e.g. financial year, quarter):
 *   conditions.push(...buildBusinessDateFilter(invoices, { from: fyStart, to: fyEnd }));
 *
 * @example
 *   // SQL-expression bound:
 *   conditions.push(...buildBusinessDateFilter(expenses, {
 *     from: sql`NOW() - INTERVAL '30 days'`,
 *   }));
 */
export function buildBusinessDateFilter(
  table: BusinessDateTable,
  range: { from?: BusinessDateBound; to?: BusinessDateBound; before?: BusinessDateBound },
): SQL[] {
  const col = businessDateColumnFor(table);
  const f = coerce(range.from);
  const t = coerce(range.to);
  const b = coerce(range.before);
  const out: SQL[] = [];
  if (f !== undefined) out.push(gte(col, f));
  if (t !== undefined) {
    // An inclusive end at millisecond precision ("... 23:59:59.999") is the half-open "< the next
    // millisecond". `<= 23:59:59.999` would drop a stored timestamp with microseconds
    // (23:59:59.999500), which the next period (`>= 00:00:00.000`) does not take either.
    // (The "unbounded" sentinel 9999-12-31T23:59:59.999Z has no next millisecond Postgres accepts.)
    const next = t instanceof Date ? new Date(t.getTime() + 1) : null;
    out.push(next && next.getUTCFullYear() <= 9999 ? lt(col, next) : lte(col, t));
  }
  if (b !== undefined) out.push(lt(col, b));
  return out;
}
