import { describe, it, expect } from "vitest";
import { getCurrentFYBounds, getPreviousFYBounds, fyLabel } from "../fy-bounds";

// FY boundaries are IST midnights: 1 April 00:00 IST is 31 March 18:30 UTC. Literals worked out by
// hand; the suite runs under TZ=UTC, Asia/Kolkata and America/Los_Angeles with the same results.
describe("fy-bounds", () => {
  it("is stable across calls within the same IST day (query-key stability)", () => {
    const a = getCurrentFYBounds(new Date("2026-10-09T10:00:00.123Z"));
    const b = getCurrentFYBounds(new Date("2026-10-09T18:15:59.987Z")); // 23:45 IST, still 9 Oct
    expect(a).toEqual(b);
    expect(a.end).toBe("2026-10-09T18:29:59.999Z"); // the last millisecond of 9 Oct IST
  });

  it("current FY starts 1 April 00:00 IST", () => {
    expect(getCurrentFYBounds(new Date("2026-10-09T00:00:00Z"))).toMatchObject({
      start: "2026-03-31T18:30:00.000Z",
      year: 2026,
    });
    expect(getCurrentFYBounds(new Date("2027-02-10T00:00:00Z"))).toMatchObject({
      start: "2026-03-31T18:30:00.000Z",
      year: 2026,
    });
  });

  it("previous FY spans 1 April 00:00 IST to the last millisecond of 31 March IST", () => {
    expect(getPreviousFYBounds(new Date("2026-10-09T00:00:00Z"))).toEqual({
      start: "2025-03-31T18:30:00.000Z",
      end: "2026-03-31T18:29:59.999Z",
      year: 2025,
    });
  });

  it("flips at 00:00 IST on 1 April: the last millisecond of 31 March is still the old FY", () => {
    expect(getCurrentFYBounds(new Date("2026-03-31T18:29:59.999Z")).year).toBe(2025);
    expect(getCurrentFYBounds(new Date("2026-03-31T18:30:00.000Z")).year).toBe(2026);
  });

  it("handles the 31st of a month without date overflow", () => {
    expect(getCurrentFYBounds(new Date("2026-12-31T05:00:00Z")).start).toBe("2026-03-31T18:30:00.000Z");
  });

  it("labels FYs", () => {
    expect(fyLabel(2025)).toBe("FY 2025-26");
  });
});
