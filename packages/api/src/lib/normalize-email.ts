import { sql, type Column, type SQL } from "drizzle-orm";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Case-insensitive equality on an email column (covers legacy mixed-case rows). */
export function emailEq(column: Column, email: string): SQL {
  return sql`lower(${column}) = ${normalizeEmail(email)}`;
}
