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
 *   F  "Run now" x3 then pause and resume: Run now consumes the next occurrence early and moves the
 *        template on, so a resume must NOT move it back (it used to recompute from "now", which handed
 *        the consumed occurrences back to the scheduler: billed again, or refused by the one-run-per-
 *        occurrence index and the template stuck). A template paused past its run date resumes on the
 *        first occurrence after now ON ITS SCHEDULE (1 Apr), with no burst of the missed runs.
 *   G  a template due on an occurrence that already has a run recorded (not a concurrent runner: nothing
 *        advanced it) is advanced past it, without billing it again, instead of conflicting on every tick.
 *
 * Which templates are anchored: only one created with a start date in the future AND still on that
 * start date's schedule (see `templateAnchor`). A template written by an older version drifted off its
 * schedule (31 Jan -> 3 Mar, 3 Apr, ...) and is not snapped onto one it was never on: it carries on from
 * its own next run date, counted on the IST calendar.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { eq, and, asc } from "drizzle-orm";
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
  const t = await w.caller.recurringInvoice.create({
    partyId,
    name: "Retainer",
    type: "sale",
    frequency: over.frequency ?? "monthly",
    startDate: over.startDate,
    ...(over.endDate ? { endDate: over.endDate } : {}),
    lineItems: [{ itemName: "Retainer", quantity: "1", unitPrice: "1000.00", taxPercent: "0", discountPercent: "0" }],
  });
  // The database stamps created_at with its real clock; the test clock is faked. Put it on the faked one so
  // "created with a start date in the future" means what it does in production.
  await getTenantTestDb().update(recurringInvoiceTemplates).set({ createdAt: new Date() }).where(eq(recurringInvoiceTemplates.id, t.id));
  return t;
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
  const chain = (start: string, frequency: string, steps: number, withAnchor: boolean) => {
    const anchor = withAnchor ? new Date(start) : null;
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

  describe("templateAnchor: only a template created with a future start date AND still on its schedule is anchored", () => {
    const start = new Date("2026-01-30T18:30:00.000Z"); // 31 Jan 2026 00:00 IST
    const tpl = (over: Partial<Parameters<typeof templateAnchor>[0]> = {}) => ({
      startDate: start,
      createdAt: new Date("2026-01-10T10:00:00.000Z"),
      nextRunDate: start,
      frequency: "monthly",
      ...over,
    });

    it("created with a future start date, next run on its schedule: anchored, on every occurrence (31 Jan, 28 Feb, 31 Mar)", () => {
      for (const next of ["2026-01-30T18:30:00.000Z", "2026-02-27T18:30:00.000Z", "2026-03-30T18:30:00.000Z", "2027-01-30T18:30:00.000Z"]) {
        expect(templateAnchor(tpl({ nextRunDate: new Date(next) })), next).toEqual(start);
      }
    });

    it("a start date in the past (not after the creation time) is not anchored", () => {
      expect(templateAnchor(tpl({ startDate: new Date("2026-01-01T00:00:00Z"), createdAt: new Date("2026-01-01T10:00:00Z"), nextRunDate: new Date("2026-01-01T00:00:00Z") }))).toBeNull();
      expect(templateAnchor(tpl({ createdAt: start }))).toBeNull(); // created exactly at the start: not 'future'
    });

    it("an OLD template that drifted (start 31 Jan IST; the old setMonth chain gave 3 Mar, 3 Apr) is NOT anchored: it carries on from its own date", () => {
      // startDate is after createdAt, which is all the previous rule asked for
      for (const drifted of ["2026-03-02T18:30:00.000Z", "2026-04-02T18:30:00.000Z", "2026-03-30T18:31:00.000Z", "2026-03-30T20:00:00.000Z"]) {
        expect(templateAnchor(tpl({ nextRunDate: new Date(drifted) })), drifted).toBeNull();
      }
      const drifted = new Date("2026-04-02T18:30:00.000Z"); // 3 Apr 00:00 IST
      expect(iso(computeNextRunDate(drifted, "monthly", null, templateAnchor(tpl({ nextRunDate: drifted }))))).toBe("2026-05-02T18:30:00.000Z"); // 3 May, not 31 Mar-style snapping
    });

    it("a frequency change puts the next run off the new schedule and drops the anchor; a quarterly template stays anchored on 3-month steps", () => {
      expect(templateAnchor(tpl({ frequency: "quarterly", nextRunDate: new Date("2026-02-27T18:30:00.000Z") }))).toBeNull(); // 28 Feb is 1 month on
      expect(templateAnchor(tpl({ frequency: "quarterly", nextRunDate: new Date("2026-04-29T18:30:00.000Z") }))).toEqual(start); // 30 Apr is 3 months on
      expect(templateAnchor(tpl({ frequency: "yearly", nextRunDate: new Date("2027-01-30T18:30:00.000Z") }))).toEqual(start);
    });

    it("day-based frequencies and a missing field have no anchor", () => {
      for (const frequency of ["weekly", "biweekly", "custom"]) expect(templateAnchor(tpl({ frequency }))).toBeNull();
      expect(templateAnchor({})).toBeNull();
      expect(templateAnchor({ startDate: start, createdAt: new Date("2026-01-10T10:00:00Z") })).toBeNull();
    });
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

describe("golden 23 F: Run now, pause, resume", () => {
  const run = (w: GoldenWorld, id: string) => w.caller.recurringInvoice.runNow({ id });

  it("Run now x3 then pause and resume keeps the next run where Run now left it; nothing is billed twice", async () => {
    const { w, partyId } = await newWorld();
    vi.useFakeTimers({ toFake: ["Date"] });
    at("2026-01-10T10:00:00.000Z");
    const t = await createTemplate(w, partyId, { startDate: "2026-01-31T18:30:00.000Z" }); // 1 Feb 00:00 IST

    await run(w, t.id);
    await run(w, t.id);
    await run(w, t.id);
    expect(await state(t.id)).toMatchObject({
      totalRuns: 3,
      scheduled: ["2026-01-31T18:30:00.000Z", "2026-02-28T18:30:00.000Z", "2026-03-31T18:30:00.000Z"], // 1 Feb, 1 Mar, 1 Apr consumed early
      next: "2026-04-30T18:30:00.000Z", // 1 May 00:00 IST
    });

    await w.caller.recurringInvoice.pause({ id: t.id });
    at("2026-01-15T10:00:00.000Z");
    await w.caller.recurringInvoice.resume({ id: t.id });
    // kept. (Recomputed from "now" it was 15 Feb: Feb billed a second time.)
    expect(await state(t.id)).toMatchObject({ status: "active", totalRuns: 3, next: "2026-04-30T18:30:00.000Z" });

    at("2026-02-20T10:00:00.000Z");
    await tick();
    await tick();
    expect((await state(t.id)).totalRuns).toBe(3); // nothing due until 1 May

    at("2026-04-30T18:30:05.000Z"); // 1 May 00:00:05 IST
    await tick();
    expect(await state(t.id)).toMatchObject({
      totalRuns: 4,
      scheduled: ["2026-01-31T18:30:00.000Z", "2026-02-28T18:30:00.000Z", "2026-03-31T18:30:00.000Z", "2026-04-30T18:30:00.000Z"],
      next: "2026-05-31T18:30:00.000Z", // 1 Jun
    });
  });

  it("paused past its run date: resume lands on the first occurrence after now on the 1st (1 Apr), with no burst of the missed runs", async () => {
    const { w, partyId } = await newWorld();
    vi.useFakeTimers({ toFake: ["Date"] });
    at("2026-01-10T10:00:00.000Z");
    const t = await createTemplate(w, partyId, { startDate: "2026-01-31T18:30:00.000Z" }); // 1 Feb
    await w.caller.recurringInvoice.pause({ id: t.id });

    at("2026-03-20T10:00:00.000Z"); // 20 Mar IST: the 1 Feb and 1 Mar occurrences were missed while paused
    await w.caller.recurringInvoice.resume({ id: t.id });
    // old code: 20 Apr 10:00Z (a month from now, off the 1st)
    expect(await state(t.id)).toMatchObject({ status: "active", totalRuns: 0, next: "2026-03-31T18:30:00.000Z" }); // 1 Apr 00:00 IST
    await tick();
    expect((await state(t.id)).totalRuns).toBe(0);

    at("2026-03-31T18:30:05.000Z");
    await tick();
    expect(await state(t.id)).toMatchObject({ totalRuns: 1, invoiceDays: ["2026-04-01"], next: "2026-04-30T18:30:00.000Z" });
  });
});

describe("golden 23 G: a due occurrence that already has a run recorded is advanced, not retried for ever", () => {
  it("the template is moved to the next occurrence without a new invoice, then runs on schedule", async () => {
    const { w, partyId } = await newWorld();
    vi.useFakeTimers({ toFake: ["Date"] });
    at("2026-01-10T10:00:00.000Z");
    const t = await createTemplate(w, partyId, { startDate: "2026-01-31T18:30:00.000Z" }); // 1 Feb
    await w.caller.recurringInvoice.runNow({ id: t.id }); // consumes 1 Feb early; next 1 Mar
    expect(await state(t.id)).toMatchObject({ totalRuns: 1, next: "2026-02-28T18:30:00.000Z" });

    // the template is put back onto the occurrence Run now consumed (an old resume, a manual edit)
    await getTenantTestDb().update(recurringInvoiceTemplates)
      .set({ nextRunDate: new Date("2026-01-31T18:30:00.000Z") })
      .where(eq(recurringInvoiceTemplates.id, t.id));

    at("2026-02-02T10:00:00.000Z"); // 1 Feb is due
    await tick();
    // not billed again; moved on (it conflicted on every tick and never moved before)
    expect(await state(t.id)).toMatchObject({ status: "active", totalRuns: 1, next: "2026-02-28T18:30:00.000Z" });
    await tick();
    expect(await state(t.id)).toMatchObject({ totalRuns: 1, next: "2026-02-28T18:30:00.000Z" });
    const db = getTenantTestDb();
    expect(await db.select().from(invoices).where(and(eq(invoices.businessId, w.businessId), eq(invoices.source, "recurring")))).toHaveLength(1);

    at("2026-02-28T18:30:05.000Z"); // 1 Mar
    await tick();
    expect(await state(t.id)).toMatchObject({
      totalRuns: 2,
      scheduled: ["2026-01-31T18:30:00.000Z", "2026-02-28T18:30:00.000Z"],
      next: "2026-03-31T18:30:00.000Z",
    });
  });

  it("several consumed occurrences in a row are skipped in one tick (bounded catch-up), and the end date still completes the template", async () => {
    const { w, partyId } = await newWorld();
    vi.useFakeTimers({ toFake: ["Date"] });
    at("2026-01-10T10:00:00.000Z");
    const t = await createTemplate(w, partyId, { startDate: "2026-01-31T18:30:00.000Z", endDate: "2026-03-31T18:30:00.000Z" }); // ends 1 Apr
    for (let i = 0; i < 3; i++) await w.caller.recurringInvoice.runNow({ id: t.id }); // 1 Feb, 1 Mar, 1 Apr consumed; next 1 May
    // moved back to 1 Feb with the end date 1 Apr
    await getTenantTestDb().update(recurringInvoiceTemplates)
      .set({ nextRunDate: new Date("2026-01-31T18:30:00.000Z"), status: "active" })
      .where(eq(recurringInvoiceTemplates.id, t.id));

    at("2026-05-10T10:00:00.000Z"); // 1 Feb, 1 Mar, 1 Apr and 1 May are all due
    await tick();
    // 1 Feb, 1 Mar, 1 Apr are consumed already; the advance past 1 Apr is after the end date: completed, nothing billed
    expect(await state(t.id)).toMatchObject({ status: "completed", totalRuns: 3 });
    expect(await getTenantTestDb().select().from(invoices).where(and(eq(invoices.businessId, w.businessId), eq(invoices.source, "recurring")))).toHaveLength(3);
  });
});
