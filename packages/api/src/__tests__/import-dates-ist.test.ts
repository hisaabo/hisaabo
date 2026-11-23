/**
 * Imported dates are calendar days on the business calendar (IST): 00:00 IST, whatever the server's
 * zone. A server-local midnight is a different instant (and, around the 1st, a different day) on every
 * server. IST midnight of a day is 18:30 UTC of the day before. Run under TZ=UTC, Asia/Kolkata and
 * America/Los_Angeles with the same results.
 */
import { describe, it, expect } from "vitest";
import { parseDate } from "../lib/csv-parser.js";
import { parseFlexibleDate } from "../routers/import/helpers.js";

const iso = (d: Date | null) => d?.toISOString() ?? null;

describe("bank statement parseDate: every format is 00:00 IST of the day", () => {
  it.each([
    ["01/04/2026", undefined, "2026-03-31T18:30:00.000Z"],
    ["1/4/2026", undefined, "2026-03-31T18:30:00.000Z"],
    ["2026-04-01", undefined, "2026-03-31T18:30:00.000Z"],
    ["2026-04-01T10:00:00Z", undefined, "2026-03-31T18:30:00.000Z"], // the time of day is dropped, as before
    ["20260401", undefined, "2026-03-31T18:30:00.000Z"],
    ["01-Apr-2026", undefined, "2026-03-31T18:30:00.000Z"],
    ["01-Apr-26", undefined, "2026-03-31T18:30:00.000Z"],
    ["01.04.2026", undefined, "2026-03-31T18:30:00.000Z"],
    ["04/01/2026", "MM/DD/YYYY", "2026-03-31T18:30:00.000Z"],
    ["31/12/2025", undefined, "2025-12-30T18:30:00.000Z"],
    ["29/02/2028", undefined, "2028-02-28T18:30:00.000Z"], // leap day
  ])("%s (%s) -> %s", (raw, format, expected) => {
    expect(iso(parseDate(raw, format))).toBe(expected);
  });

  it("a day that does not exist is null, not the next month", () => {
    expect(parseDate("30/02/2026")).toBeNull();
    expect(parseDate("31/04/2026")).toBeNull();
    expect(parseDate("29/02/2026")).toBeNull();
    expect(parseDate("2026-13-01")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("importer parseFlexibleDate: a date without a time is 00:00 IST of the day", () => {
  it.each([
    ["2026-04-01", "2026-03-31T18:30:00.000Z"],
    ["01/04/2026", "2026-03-31T18:30:00.000Z"],
    ["01-04-2026", "2026-03-31T18:30:00.000Z"],
    ["22 Mar 2026", "2026-03-21T18:30:00.000Z"],
    ["22-Mar-2026", "2026-03-21T18:30:00.000Z"],
    ["1 April 2026", "2026-03-31T18:30:00.000Z"],
  ])("%s -> %s", (raw, expected) => {
    expect(iso(parseFlexibleDate(raw))).toBe(expected);
  });

  it("a full datetime is an instant and is kept", () => {
    expect(iso(parseFlexibleDate("2026-04-01T10:00:00.000Z"))).toBe("2026-04-01T10:00:00.000Z");
  });

  it("empty and nonsense are null; an impossible day falls through rather than rolling over", () => {
    expect(parseFlexibleDate("")).toBeNull();
    expect(parseFlexibleDate("not a date")).toBeNull();
    expect(parseFlexibleDate("31/02/2026")).toBeNull();
  });
});
