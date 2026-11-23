// formatDate prints the calendar day in the business zone (IST by default), not the machine's.
import test from "node:test";
import assert from "node:assert/strict";
import { formatDate } from "../src/format.ts";
import { setTimeZone } from "../src/dates.ts";

test("formatDate shows the IST day: 1 Nov 03:00 IST is 01 Nov, not 31 Oct", () => {
  const saved = process.env["HISAABO_TZ"];
  delete process.env["HISAABO_TZ"];
  try {
    setTimeZone();
    assert.equal(formatDate("2026-10-31T21:30:00.000Z"), "01 Nov 2026");
    assert.equal(formatDate("2026-10-31T18:29:59.999Z"), "31 Oct 2026");
    assert.equal(formatDate("2026-10-31T18:30:00.000Z"), "01 Nov 2026");
    assert.equal(formatDate("2026-03-31T18:30:00.000Z"), "01 Apr 2026");
    assert.equal(formatDate(null), "-");
  } finally {
    if (saved !== undefined) process.env["HISAABO_TZ"] = saved;
  }
});
