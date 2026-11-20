import { describe, it, expect } from "vitest";
import { getCurrentFYBounds, getPreviousFYBounds, fyLabel } from "../fy-bounds";

describe("fy-bounds", () => {
  it("is stable across calls within the same day (query-key stability)", () => {
    const a = getCurrentFYBounds(new Date("2026-10-09T10:00:00.123Z"));
    const b = getCurrentFYBounds(new Date("2026-10-09T18:45:59.987Z"));
    expect(a).toEqual(b);
    expect(a.end).toBe("2026-10-09T23:59:59.999Z");
  });

  it("current FY starts April 1 UTC", () => {
    expect(getCurrentFYBounds(new Date("2026-10-09T00:00:00Z"))).toMatchObject({
      start: "2026-04-01T00:00:00.000Z",
      year: 2026,
    });
    expect(getCurrentFYBounds(new Date("2027-02-10T00:00:00Z"))).toMatchObject({
      start: "2026-04-01T00:00:00.000Z",
      year: 2026,
    });
  });

  it("previous FY spans April 1 to March 31 end of day", () => {
    expect(getPreviousFYBounds(new Date("2026-10-09T00:00:00Z"))).toEqual({
      start: "2025-04-01T00:00:00.000Z",
      end: "2026-03-31T23:59:59.999Z",
      year: 2025,
    });
  });

  it("handles the 31st of a month without date overflow", () => {
    expect(getCurrentFYBounds(new Date("2026-12-31T05:00:00Z")).start).toBe("2026-04-01T00:00:00.000Z");
  });

  it("labels FYs", () => {
    expect(fyLabel(2025)).toBe("FY 2025-26");
  });
});
