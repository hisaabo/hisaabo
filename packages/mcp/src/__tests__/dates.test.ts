/**
 * MCP date handling is on the business calendar (IST), whatever zone the MCP server runs in.
 *
 * A "YYYY-MM-DD" an agent passes is a whole IST day: 00:00 IST (= 18:30 UTC of the day before) to the last
 * millisecond of that day; a journal entry date is stored as 00:00 IST. The dashboard periods are IST windows
 * and "this-year" is the Indian financial year. Run under TZ=UTC, Asia/Kolkata and America/Los_Angeles with
 * the same results. IST midnight of a day is 18:30 UTC of the day before.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import superjson from "superjson";
import { registerWith, callTool, recordingClient, writeAdmin, UUID } from "./helpers.js";
import { resolvePeriod } from "../tools/dashboard.js";

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  vi.useRealTimers();
});

function setup() {
  const rec = recordingClient(() => ({}));
  restore = rec.restore;
  const { tools } = registerWith(writeAdmin, rec.client);
  return { ...rec, tools };
}

/** The `input` of a tRPC GET call, deserialised. */
const queryInput = (url: URL) => superjson.deserialize(JSON.parse(url.searchParams.get("input")!)) as Record<string, unknown>;

describe("report tools widen a plain date to the IST day", () => {
  it("trial balance as of 30 Nov: the last millisecond of 30 Nov IST", async () => {
    const { tools, calls } = setup();
    await callTool(tools.get("report_trial_balance")!, { as_of_date: "2026-11-30" });
    expect(queryInput(calls[0]!.url)).toMatchObject({ asOfDate: "2026-11-30T18:29:59.999Z" });
  });

  it("trial balance with no date is today on the IST calendar (1 Nov at 03:00 IST is still 31 Oct in UTC)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T21:30:00.000Z"));
    const { tools, calls } = setup();
    await callTool(tools.get("report_trial_balance")!, {});
    expect(queryInput(calls[0]!.url)).toMatchObject({ asOfDate: "2026-11-01T18:29:59.999Z" }); // end of 1 Nov IST
  });
});

describe("journal and e-invoice tools", () => {
  it("journal_list: 1 Nov .. 30 Nov is 1 Nov 00:00 IST .. the last millisecond of 30 Nov IST", async () => {
    const { tools, calls } = setup();
    await callTool(tools.get("journal_list")!, { from_date: "2026-11-01", to_date: "2026-11-30" });
    expect(queryInput(calls[0]!.url)).toMatchObject({ fromDate: "2026-10-31T18:30:00.000Z", toDate: "2026-11-30T18:29:59.999Z" });
  });

  it("einvoice_dashboard widens the same way", async () => {
    const { tools, calls } = setup();
    await callTool(tools.get("einvoice_dashboard")!, { from_date: "2026-04-01", to_date: "2026-04-30" });
    expect(queryInput(calls[0]!.url)).toMatchObject({ fromDate: "2026-03-31T18:30:00.000Z", toDate: "2026-04-30T18:29:59.999Z" });
  });

  it("journal_create stores the entry date as 00:00 IST of the day: 1 April is 31 March 18:30 UTC", async () => {
    const { tools, calls } = setup();
    await callTool(tools.get("journal_create")!, {
      date: "2026-04-01",
      narration: "Depreciation",
      lines: [{ accountId: UUID, debit: "10.00" }, { accountId: UUID, credit: "10.00" }],
    });
    expect(calls[0]!.body).toMatchObject({ entryDate: "2026-03-31T18:30:00.000Z" });
  });
});

describe("dashboard periods are IST windows (03:00 IST on 1 Nov 2026 = 2026-10-31T21:30Z)", () => {
  const now = new Date("2026-10-31T21:30:00.000Z");

  it.each([
    ["this-month", { fromDate: "2026-10-31T18:30:00.000Z", toDate: "2026-11-30T18:29:59.999Z" }],
    ["last-month", { fromDate: "2026-09-30T18:30:00.000Z", toDate: "2026-10-31T18:29:59.999Z" }],
    ["this-quarter", { fromDate: "2026-09-30T18:30:00.000Z", toDate: "2026-12-31T18:29:59.999Z" }], // Oct-Dec
    ["this-fy", { fromDate: "2026-03-31T18:30:00.000Z", toDate: "2026-11-01T18:29:59.999Z" }], // 1 Apr 2026 .. end of today
    ["this-year", { fromDate: "2026-03-31T18:30:00.000Z", toDate: "2027-03-31T18:29:59.999Z" }], // the whole FY 2026-27, not Jan-Dec
  ])("%s", (period, expected) => {
    expect(resolvePeriod(period, now)).toEqual(expected);
  });

  it("no period means this-fy with explicit dates (it used to send nothing, which the API reads as all time); all sends nothing", () => {
    expect(resolvePeriod(undefined, now)).toEqual(resolvePeriod("this-fy", now));
    expect(resolvePeriod("all", now)).toEqual({});
  });

  it("the financial year flips at 00:00 IST on 1 April", () => {
    expect(resolvePeriod("this-year", new Date("2026-03-31T18:29:59.999Z"))).toEqual({ fromDate: "2025-03-31T18:30:00.000Z", toDate: "2026-03-31T18:29:59.999Z" });
    expect(resolvePeriod("this-year", new Date("2026-03-31T18:30:00.000Z"))).toEqual({ fromDate: "2026-03-31T18:30:00.000Z", toDate: "2027-03-31T18:29:59.999Z" });
  });

  it("dashboard_summary with no period sends the financial-year-to-date window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const { tools, calls } = setup();
    await callTool(tools.get("dashboard_summary")!, {});
    expect(queryInput(calls[0]!.url)).toEqual({ fromDate: "2026-03-31T18:30:00.000Z", toDate: "2026-11-01T18:29:59.999Z" });
  });
});
