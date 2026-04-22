import { gte, lte, type SQL, type SQLWrapper } from "drizzle-orm";
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
  range: { from?: BusinessDateBound; to?: BusinessDateBound },
): SQL[] {
  const col = businessDateColumnFor(table);
  const f = coerce(range.from);
  const t = coerce(range.to);
  const out: SQL[] = [];
  if (f !== undefined) out.push(gte(col, f));
  if (t !== undefined) out.push(lte(col, t));
  return out;
}
