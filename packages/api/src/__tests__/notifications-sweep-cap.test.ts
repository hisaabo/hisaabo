/**
 * Collections sweep cap (no database needed).
 *
 * The sweep selects invoices inside the due-today / 7 / 30 / 60-day windows. On
 * the first run after an upgrade that can be a large backlog, so each run emits
 * at most `maxPerBusiness` NEW events per business. Already-emitted invoices
 * dedupe and do not count, which is what lets later runs make progress.
 */

import { describe, it, expect } from "vitest";
import type { TenantDatabase } from "@hisaabo/db";
import { MAX_EVENTS_PER_BUSINESS_PER_SWEEP, sweepCollections } from "../lib/notifications/collections-sweep.js";

const TENANT = "11111111-1111-4111-8111-111111111111";

function dueRow(business: string, n: number) {
  return {
    id: `${business}-inv-${n}`,
    business_id: business,
    invoice_number: `INV-${n}`,
    party_name: "Priya Textiles",
    amount_due: "1000.00",
    days: 0,
    due_date: "2026-11-20",
    created_by_user_id: null,
  };
}

/** A database whose outbox enforces the (tenant, dedupe_key) unique index, like the real one. */
function fakeDb(rows: unknown[]) {
  const outbox = new Map<string, string>();
  const db = {
    execute: async () => rows,
    insert: () => ({
      values: (v: { dedupeKey: string; businessId: string }) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (outbox.has(v.dedupeKey)) return [];
            outbox.set(v.dedupeKey, v.businessId);
            return [{ id: v.dedupeKey }];
          },
        }),
      }),
    }),
  };
  const countFor = (business: string) => [...outbox.values()].filter((b) => b === business).length;
  return { db: db as unknown as TenantDatabase, countFor };
}

describe("collections sweep cap", () => {
  it("defaults to 50 new events per business per run", () => {
    expect(MAX_EVENTS_PER_BUSINESS_PER_SWEEP).toBe(50);
  });

  it("emits at most the cap per business per run and drains the backlog over later runs", async () => {
    const rows = [
      ...[1, 2, 3, 4, 5].map((n) => dueRow("biz-a", n)),
      ...[1, 2].map((n) => dueRow("biz-b", n)),
    ];
    const { db, countFor } = fakeDb(rows);

    expect(await sweepCollections(db, TENANT, 2)).toBe(4);   // a: 2 of 5, b: both
    expect(countFor("biz-a")).toBe(2);
    expect(countFor("biz-b")).toBe(2);
    expect(await sweepCollections(db, TENANT, 2)).toBe(2);   // a: the next 2 (first 2 dedupe, uncounted)
    expect(await sweepCollections(db, TENANT, 2)).toBe(1);   // a: the last one
    expect(await sweepCollections(db, TENANT, 2)).toBe(0);   // nothing left; no repeats
    expect(countFor("biz-a")).toBe(5);
    expect(countFor("biz-b")).toBe(2);
  });

  it("the cap is per business: a large business does not starve a small one", async () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => dueRow("big", i)),
      dueRow("small", 0),
    ];
    const { db, countFor } = fakeDb(rows);

    await sweepCollections(db, TENANT, 3);

    expect(countFor("big")).toBe(3);
    expect(countFor("small")).toBe(1);
  });

  it("emits everything when the backlog is under the cap", async () => {
    const { db } = fakeDb([1, 2, 3].map((n) => dueRow("biz-a", n)));
    expect(await sweepCollections(db, TENANT)).toBe(3);
  });
});
