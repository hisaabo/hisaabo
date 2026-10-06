// Run with: node --experimental-strip-types --test packages/cli/test/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  InvalidTimeZoneError, resolveTimeZone, setTimeZone, toApiDateTime, apiFrom, apiTo,
  todayISO, monthStart, monthEnd, fyStart, currentFY, quarterRange,
} from "../src/dates.ts";

test("UTC day boundaries", () => {
  assert.equal(toApiDateTime("2025-06-15", "start", "UTC"), "2025-06-15T00:00:00.000Z");
  assert.equal(toApiDateTime("2025-06-15", "end", "UTC"), "2025-06-15T23:59:59.999Z");
});

test("Asia/Kolkata (UTC+05:30, no DST)", () => {
  assert.equal(toApiDateTime("2025-06-15", "start", "Asia/Kolkata"), "2025-06-14T18:30:00.000Z");
  assert.equal(toApiDateTime("2025-06-15", "end", "Asia/Kolkata"), "2025-06-15T18:29:59.999Z");
  assert.equal(toApiDateTime("2025-01-01", "start", "Asia/Kolkata"), "2024-12-31T18:30:00.000Z");
});

test("America/New_York across DST (spring forward 2025-03-09, fall back 2025-11-02)", () => {
  // EST (-05:00) before, EDT (-04:00) after.
  assert.equal(toApiDateTime("2025-03-08", "start", "America/New_York"), "2025-03-08T05:00:00.000Z");
  assert.equal(toApiDateTime("2025-03-08", "end", "America/New_York"), "2025-03-09T04:59:59.999Z");
  // The transition day itself: starts in EST, ends in EDT (23h long).
  assert.equal(toApiDateTime("2025-03-09", "start", "America/New_York"), "2025-03-09T05:00:00.000Z");
  assert.equal(toApiDateTime("2025-03-09", "end", "America/New_York"), "2025-03-10T03:59:59.999Z");
  assert.equal(toApiDateTime("2025-03-10", "start", "America/New_York"), "2025-03-10T04:00:00.000Z");
  // Fall back: 25h day.
  assert.equal(toApiDateTime("2025-11-02", "start", "America/New_York"), "2025-11-02T04:00:00.000Z");
  assert.equal(toApiDateTime("2025-11-02", "end", "America/New_York"), "2025-11-03T04:59:59.999Z");
  assert.equal(toApiDateTime("2025-11-03", "start", "America/New_York"), "2025-11-03T05:00:00.000Z");
});

test("midnight skipped by DST (America/Sao_Paulo 2018-11-04) resolves to the first instant after the gap", () => {
  assert.equal(toApiDateTime("2018-11-04", "start", "America/Sao_Paulo"), "2018-11-04T03:00:00.000Z");
});

test("non-date input passes through; apiFrom/apiTo handle undefined", () => {
  assert.equal(toApiDateTime("2025-06-15T10:00:00.000Z", "start", "Asia/Kolkata"), "2025-06-15T10:00:00.000Z");
  assert.equal(apiFrom(undefined), undefined);
  assert.equal(apiTo(undefined), undefined);
});

test("resolveTimeZone precedence: flag > HISAABO_TZ > machine zone", () => {
  const machine = Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.equal(resolveTimeZone("Asia/Tokyo", { HISAABO_TZ: "Asia/Kolkata" }), "Asia/Tokyo");
  assert.equal(resolveTimeZone(undefined, { HISAABO_TZ: "Asia/Kolkata" }), "Asia/Kolkata");
  assert.equal(resolveTimeZone("", { HISAABO_TZ: "Asia/Kolkata" }), "Asia/Kolkata");
  assert.equal(resolveTimeZone(undefined, {}), machine);
});

test("invalid zone is a clear error from flag and from env", () => {
  assert.throws(() => resolveTimeZone("Mars/Olympus", {}), (e: unknown) =>
    e instanceof InvalidTimeZoneError && /Mars\/Olympus.*--tz.*IANA/.test(e.message));
  assert.throws(() => resolveTimeZone(undefined, { HISAABO_TZ: "nope" }), /HISAABO_TZ/);
  // an invalid flag is not rescued by a valid env var
  assert.throws(() => resolveTimeZone("nope", { HISAABO_TZ: "UTC" }), InvalidTimeZoneError);
});

test("setTimeZone drives the default zone of toApiDateTime and the 'today' helpers", () => {
  setTimeZone("Asia/Kolkata");
  assert.equal(toApiDateTime("2025-06-15", "start"), "2025-06-14T18:30:00.000Z");
  // 2025-06-30T20:00Z is already 1 July in Kolkata but still 30 June in New York.
  const now = new Date("2025-06-30T20:00:00Z");
  assert.equal(todayISO(now), "2025-07-01");
  assert.equal(monthStart(now), "2025-07-01");
  assert.equal(monthEnd(now), "2025-07-31");
  assert.equal(currentFY(now), "2025-26");
  setTimeZone("America/New_York");
  assert.equal(todayISO(now), "2025-06-30");
  assert.equal(monthEnd(now), "2025-06-30");
  assert.equal(apiFrom(monthStart(now)), "2025-06-01T04:00:00.000Z");
  assert.equal(apiTo(monthEnd(now)), "2025-07-01T03:59:59.999Z");
  // FY rolls over on 1 April local time, not UTC.
  const fyEdge = new Date("2026-03-31T20:00:00Z");
  setTimeZone("Asia/Kolkata");
  assert.equal(fyStart(fyEdge), "2026-04-01");
  assert.equal(quarterRange("Q1", fyEdge).from, "2026-04-01");
  setTimeZone("UTC");
  assert.equal(fyStart(fyEdge), "2025-04-01");
});
