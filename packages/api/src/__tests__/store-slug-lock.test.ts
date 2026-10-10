import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  storeSlugBusinessLockSql, storeSlugBusinessLockStatement, storeSlugBusinessLockKey,
} from "@hisaabo/db";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(resolve(here, rel), "utf-8");
const T = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("per-business slug advisory lock (single source)", () => {
  it("builds the expected statement for both drizzle and raw postgres.js callers", () => {
    expect(storeSlugBusinessLockKey(T, B)).toBe(`${T}:${B}`);
    expect(storeSlugBusinessLockStatement(T, B)).toEqual({
      text: "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      params: [`${T}:${B}`],
    });
    const q = new PgDialect().sqlToQuery(storeSlugBusinessLockSql(T, B));
    expect(q.sql).toBe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))");
    expect(q.params).toEqual([`${T}:${B}`]);
  });

  it("the API registry and the backfill both use the helper and never hand-roll the hash", () => {
    const api = src("../lib/store-slug-registry.ts");
    const backfill = src("../../../db/src/backfill-store-slugs.ts");
    expect(api).toContain("storeSlugBusinessLockSql(");
    expect(backfill).toContain("storeSlugBusinessLockStatement(");
    expect(api).not.toContain("hashtextextended");
    expect(backfill).not.toContain("hashtextextended");
  });
});
