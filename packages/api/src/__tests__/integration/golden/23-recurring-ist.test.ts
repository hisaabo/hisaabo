/**
 * Scenario 23 — Recurring invoices run on IST calendar days, whatever the server's time zone.
 *
 * A template's run date (`next_run_date`) is an instant whose IST day is the day it is due. The
 * next one is computed on the IST calendar: the day moves, the IST time of day is kept, month-ends
 * clamp (31 Jan -> 28/29 Feb), and a template created with a future start date counts every later
 * monthly / quarterly / yearly run from that start day, so "the 1st" stays the 1st and "the 31st"
 * comes back after a short month. Before 0.10.1 the arithmetic used the server's day (a UTC server
 * saw IST midnight as the 18:30 UTC evening before): a monthly template due on the 1st ran
 * 1 Feb, 1 Mar, then 29 Mar, 29 Apr, ...
 *
 * IST midnight of a day is 18:30 UTC of the day before. "Now" is faked (Date only) per step.
 *
 *   A  monthly, start 1 Feb 2026 00:00 IST (2026-01-31T18:30Z), created on 10 Jan:
 *        runs 1 Feb, 1 Mar, 1 Apr, once each, dated the 1st IST; next after 1 Apr is 1 May
 *        (2026-04-30T18:30Z). Old code: 1 Mar, 29 Mar.
 *   B  month ends, start 31 Jan 2026 00:00 IST: 31 Jan -> 28 Feb -> 31 Mar -> 30 Apr -> 31 May
 *        (2028, a leap year: 31 Jan -> 29 Feb -> 31 Mar). Quarterly from 30 Nov: -> 28 Feb -> 30 May.
 *   C  catch-up: monthly from 1 Jan 2026 IST, the scheduler down until 5 Apr 2026 11:30 IST:
 *        4 invoices (scheduled 1 Jan, 1 Feb, 1 Mar, 1 Apr), all dated 5 Apr IST (never back-dated),
 *        next run 1 May IST; a second tick generates nothing.
 *   D  no anchor (start date in the past): created 30 Jan 20:00 UTC (= 31 Jan 01:30 IST), monthly:
 *        next 28 Feb 01:30 IST (2026-02-27T20:00Z); the old UTC arithmetic gave 1 Mar 01:30 IST.
 *   E  the end date is a calendar day and an occurrence ON it still runs: monthly at 20:00 IST from
 *        1 Feb, end date 1 Mar: runs 1 Feb and 1 Mar 20:00 IST, then completes.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { eq, asc } from "drizzle-orm";
import { getTenantDb, invoices, recurringInvoiceTemplates, recurringInvoiceRuns } from "@hisaabo/db";
import { businessDateOf } from "@hisaabo/shared";
import { getTenantTestDb } from "../../helpers/test-db.js";
import { processDueTemplates } from "../../../lib/recurring-invoice-scheduler.js";
import { computeNextRunDate, templateAnchor } from "../../../lib/recurring-invoice-generator.js";
import { useGoldenDb, createGoldenWorld, addParty, type GoldenWorld } from "./golden-helpers.js";

useGoldenDb();

afterEach(() => vi.useRealTimers());

const at = (iso: string) => vi.setSystemTime(new Date(iso));
const iso = (d: Date) => d.toISOString();

async function newWorld() {
  const w = await createGoldenWorld();
  const partyId = (await addParty(w, "customer", "MH")).id;
  return { w, partyId };
}

async function createTemplate(
  w: GoldenWorld,
  partyId: string,
  over: { frequency?: "monthly" | "quarterly" | "yearly" | "weekly"; startDate: string; endDate?: string },
) {
  return w.caller.recurringInvoice.create({
    partyId,
    name: "Retainer",
    type: "sale",
    frequency: over.frequency ?? "monthly",
    startDate: over.startDate,
    ...(over.endDate ? { endDate: over.endDate } : {}),
    lineItems: [{ itemName: "Retainer", quantity: "1", unitPrice: "1000.00", taxPercent: "0", discountPercent: "0" }],
  });
}

async function tick() {
  await processDueTemplates(await getTenantDb("single"));
}

async function state(templateId: string) {
  const db = getTenantTestDb();
  const [t] = await db.select().from(recurringInvoiceTemplates).where(eq(recurringInvoiceTemplates.id, templateId));
  const runs = await db.select().from(recurringInvoiceRuns).where(eq(recurringInvoiceRuns.templateId, templateId)).orderBy(asc(recurringInvoiceRuns.scheduledFor));
  const ids = runs.map((r) => r.invoiceId!).filter(Boolean);
  const invs = ids.length ? await db.select().from(invoices).where(eq(invoices.businessId, t!.businessId)) : [];
  return {
    next: t!.nextRunDate.toISOString(),
    status: t!.status,
    totalRuns: t!.totalRuns,
    scheduled: runs.map((r) => r.scheduledFor?.toISOString()),
    invoiceDays: invs.filter((i) => ids.includes(i.id)).map((i) => businessDateOf(i.invoiceDate)).sort(),
  };
}

describe("golden 23 A: monthly on the 1st runs on the 1st IST, once each, with no drift", () => {
  it("1 Feb, 1 Mar, 1 Apr 00:00 IST; next 1 May", async () => {
    const { w, partyId } = await newWorld();
    vi.useFakeTimers({ toFake: ["Date"] });
    at("2026-01-10T10:00:00.000Z");
    const t = await createTemplate(w, partyId, { startDate: "2026-01-31T18:30:00.000Z" }); // 1 Feb 00:00 IST
    expect(iso(t.nextRunDate)).toBe("2026-01-31T18:30:00.000Z");

    at("2026-01-31T18:29:59.000Z"); // 23:59:59 IST on 31 Jan: not yet
    await tick();
    expect((await state(t.id)).totalRuns).toBe(0);

    at("2026-01-31T18:30:05.000Z"); // 00:00:05 IST on 1 Feb
    await tick();
    await tick(); // a second tick the same minute generates nothing: once
    expect(await state(t.id)).toMatchObject({
      totalRuns: 1,
      invoiceDays: ["2026-02-01"],
      next: "2026-02-28T18:30:00.000Z", // 1 Mar 00:00 IST
    });

    at("2026-02-28T18:30:05.000Z"); // 1 Mar
    await tick();
    expect(await state(t.id)).toMatchObject({
      totalRuns: 2,
      invoiceDays: ["2026-02-01", "2026-03-01"],
      next: "2026-03-31T18:30:00.000Z", // 1 Apr 00:00 IST (old code: 28 Mar 18:30Z = 29 Mar IST)
    });

    at("2026-03-31T18:30:05.000Z"); // 1 Apr
    await tick();
    expect(await state(t.id)).toMatchObject({
      totalRuns: 3,
      invoiceDays: ["2026-02-01", "2026-03-01", "2026-04-01"],
      scheduled: ["2026-01-31T18:30:00.000Z", "2026-02-28T18:30:00.000Z", "2026-03-31T18:30:00.000Z"],
      next: "2026-04-30T18:30:00.000Z", // 1 May 00:00 IST
    });
  });
});

describe("golden 23 B: month-end clamping on the IST calendar", () => {
  const anchored = (start: string) => ({ startDate: new Date(start), createdAt: new Date("2025-01-01T00:00:00.000Z") });
  const chain = (start: string, frequency: string, steps: number, withAnchor: boolean) => {
    const anchor = withAnchor ? templateAnchor(anchored(start)) : null;
    const out = [start];
    let cur = new Date(start);
    for (let i = 0; i < steps; i++) {
      cur = computeNextRunDate(cur, frequency, null, anchor);
      out.push(iso(cur));
    }
    return out;
  };

  it("monthly from 31 Jan 2026 IST: 28 Feb, 31 Mar, 30 Apr, 31 May (the 31st comes back)", () => {
    expect(chain("2026-01-30T18:30:00.000Z", "monthly", 4, true)).toEqual([
      "2026-01-30T18:30:00.000Z", // 31 Jan
      "2026-02-27T18:30:00.000Z", // 28 Feb
      "2026-03-30T18:30:00.000Z", // 31 Mar
      "2026-04-29T18:30:00.000Z", // 30 Apr
      "2026-05-30T18:30:00.000Z", // 31 May
    ]);
  });

  it("leap year: 31 Jan 2028 -> 29 Feb 2028 -> 31 Mar 2028", () => {
    expect(chain("2028-01-30T18:30:00.000Z", "monthly", 2, true)).toEqual([
      "2028-01-30T18:30:00.000Z",
      "2028-02-28T18:30:00.000Z", // 29 Feb 00:00 IST
      "2028-03-30T18:30:00.000Z", // 31 Mar
    ]);
  });

  it("quarterly from 30 Nov: 28 Feb, 30 May; yearly from 29 Feb 2028: 28 Feb 2029, 29 Feb 2032 stays on the anchor", () => {
    expect(chain("2025-11-29T18:30:00.000Z", "quarterly", 2, true)).toEqual([
      "2025-11-29T18:30:00.000Z", // 30 Nov
      "2026-02-27T18:30:00.000Z", // 28 Feb
      "2026-05-29T18:30:00.000Z", // 30 May
    ]);
    const y = chain("2028-02-28T18:30:00.000Z", "yearly", 4, true); // 29 Feb 2028 00:00 IST
    expect(y.slice(1)).toEqual([
      "2029-02-27T18:30:00.000Z", // 28 Feb 2029
      "2030-02-27T18:30:00.000Z", // 28 Feb 2030
      "2031-02-27T18:30:00.000Z", // 28 Feb 2031
      "2032-02-28T18:30:00.000Z", // 29 Feb 2032
    ]);
  });

  it("without an anchor each run is counted from the previous one: 31 Jan -> 28 Feb -> 28 Mar (the clamped day sticks)", () => {
    expect(chain("2026-01-30T18:30:00.000Z", "monthly", 2, false)).toEqual([
      "2026-01-30T18:30:00.000Z",
      "2026-02-27T18:30:00.000Z",
      "2026-03-27T18:30:00.000Z", // 28 Mar
    ]);
  });

  it("weekly / biweekly / custom add whole days and keep the IST time of day", () => {
    expect(iso(computeNextRunDate(new Date("2026-03-30T20:15:00.000Z"), "weekly"))).toBe("2026-04-06T20:15:00.000Z");
    expect(iso(computeNextRunDate(new Date("2026-03-30T20:15:00.000Z"), "biweekly"))).toBe("2026-04-13T20:15:00.000Z");
    expect(iso(computeNextRunDate(new Date("2026-03-30T20:15:00.000Z"), "custom", 10))).toBe("2026-04-09T20:15:00.000Z");
  });

  it("an anchor exists only for a template created with a future start date", () => {
    expect(templateAnchor({ startDate: new Date("2026-02-01T00:00:00Z"), createdAt: new Date("2026-01-01T00:00:00Z") })).toEqual(new Date("2026-02-01T00:00:00Z"));
    expect(templateAnchor({ startDate: new Date("2026-01-01T00:00:00Z"), createdAt: new Date("2026-01-01T10:00:00Z") })).toBeNull();
    expect(templateAnchor({})).toBeNull();
  });

  it("a drifted run date (old code: 29 Mar IST) is pulled back onto the 1st at its next occurrence", () => {
    const anchor = new Date("2026-01-31T18:30:00.000Z"); // 1 Feb 00:00 IST
    const drifted = new Date("2026-03-28T18:30:00.000Z"); // 29 Mar 00:00 IST
    expect(iso(computeNextRunDate(drifted, "monthly", null, anchor))).toBe("2026-03-31T18:30:00.000Z"); // 1 Apr
  });
});

describe("golden 23 C: catch-up after the scheduler was down", () => {
  it("four missed monthly runs are generated once, dated the day they run, then the next is 1 May", async () => {
    const { w, partyId } = await newWorld();
    vi.useFakeTimers({ toFake: ["Date"] });
    at("2025-12-20T10:00:00.000Z");
    const t = await createTemplate(w, partyId, { startDate: "2025-12-31T18:30:00.000Z" }); // 1 Jan 2026 00:00 IST

    at("2026-04-05T06:00:00.000Z"); // 5 Apr 2026 11:30 IST
    await tick();
    await tick();
    expect(await state(t.id)).toMatchObject({
      totalRuns: 4,
      scheduled: ["2025-12-31T18:30:00.000Z", "2026-01-31T18:30:00.000Z", "2026-02-28T18:30:00.000Z", "2026-03-31T18:30:00.000Z"], // 1 Jan, 1 Feb, 1 Mar, 1 Apr
      invoiceDays: ["2026-04-05", "2026-04-05", "2026-04-05", "2026-04-05"],
      next: "2026-04-30T18:30:00.000Z", // 1 May 00:00 IST
    });
  });
});

describe("golden 23 D: no anchor, counted from the previous run in IST", () => {
  it("created at 01:30 IST on 31 Jan with a past start: next is 28 Feb 01:30 IST", async () => {
    const { w, partyId } = await newWorld();
    vi.useFakeTimers({ toFake: ["Date"] });
    at("2026-01-30T20:00:00.000Z"); // 31 Jan 01:30 IST (30 Jan in UTC)
    const t = await createTemplate(w, partyId, { startDate: "2026-01-01T00:00:00.000Z" });
    expect(iso(t.nextRunDate)).toBe("2026-02-27T20:00:00.000Z"); // 28 Feb 01:30 IST; UTC arithmetic gave 28 Feb 20:00Z = 1 Mar 01:30 IST
  });
});

describe("golden 23 E: the end date is a calendar day and the occurrence on it still runs", () => {
  it("monthly at 20:00 IST from 1 Feb, end date 1 Mar: runs 1 Feb and 1 Mar, then completes", async () => {
    const { w, partyId } = await newWorld();
    vi.useFakeTimers({ toFake: ["Date"] });
    at("2026-01-10T10:00:00.000Z");
    // 1 Feb 2026 20:00 IST = 14:30 UTC; the end date is the picked day 1 Mar = 00:00 IST
    const t = await createTemplate(w, partyId, { startDate: "2026-02-01T14:30:00.000Z", endDate: "2026-02-28T18:30:00.000Z" });

    at("2026-02-01T14:30:05.000Z");
    await tick();
    expect(await state(t.id)).toMatchObject({ totalRuns: 1, status: "active", next: "2026-03-01T14:30:00.000Z" });

    at("2026-03-01T14:30:05.000Z"); // 1 Mar 20:00 IST: after the end date's midnight, on the end date's day
    await tick();
    expect(await state(t.id)).toMatchObject({ totalRuns: 2, status: "completed", invoiceDays: ["2026-02-01", "2026-03-01"] });
  });
});
