/**
 * Scratch control database builder for db-layer tests. Creates a throwaway
 * database on the test server and applies the committed drizzle-control SQL
 * migrations up to (and including) `upTo`, the way a real deployment would
 * have them applied. Using upTo=4 reproduces the PREVIOUS schema.
 */
import postgres from "postgres";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

export const DB_PKG = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../db");
const baseUrl = process.env.TEST_DATABASE_URL ?? "postgresql://test:test@localhost:5433/hisaabo_test";

export function migrationFiles(dir: "drizzle-control" | "drizzle"): string[] {
  return readdirSync(resolve(DB_PKG, dir)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
}

export async function applyMigrationFile(sql: postgres.Sql, dir: string, file: string): Promise<void> {
  const content = readFileSync(resolve(DB_PKG, dir, file), "utf-8");
  for (const stmt of content.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) {
    await sql.unsafe(stmt);
  }
}

export interface Scratch { url: string; name: string; sql: postgres.Sql; drop(): Promise<void> }

export async function createScratchControlDb(upTo: number): Promise<Scratch> {
  const name = `p1_${randomBytes(5).toString("hex")}`;
  const admin = postgres(baseUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${name}`);
  await admin.end();
  const u = new URL(baseUrl);
  u.pathname = `/${name}`;
  const url = u.toString();
  const sql = postgres(url, { max: 4, onnotice: () => {} });
  const files = migrationFiles("drizzle-control").filter((f) => Number(f.slice(0, 4)) <= upTo);
  for (const f of files) await applyMigrationFile(sql, "drizzle-control", f);
  return {
    url, name, sql,
    async drop() {
      await sql.end({ timeout: 2 });
      const a = postgres(baseUrl, { max: 1, onnotice: () => {} });
      await a.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}
