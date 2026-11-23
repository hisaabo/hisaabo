import {
  resolveDatePreset,
  windowToQuery,
  businessFinancialYearStartYear,
} from "@hisaabo/shared";

// FY date helpers for the report pages: the Indian financial year (1 April - 31 March) on the
// business calendar (IST). Boundaries are IST midnights: 1 April 00:00 IST is 31 March 18:30 UTC.
// A UTC-midnight boundary would pull the last 5h30m of 31 March into the new year.
//
// IMPORTANT: results are used as tRPC query inputs, so they must be stable
// for the lifetime of a page view. Never return `now.toISOString()` (ms
// precision changes on every call -> new query key every render -> endless
// refetch loop). The current FY ends at the end of *today* (IST), which is constant
// for the whole day.

export interface FYBounds {
  start: string;
  end: string;
  year: number;
}

export function getCurrentFYBounds(now: Date = new Date()): FYBounds {
  const q = windowToQuery(resolveDatePreset("this-fy", now));
  return { start: q.fromDate!, end: q.toDate!, year: businessFinancialYearStartYear(now) };
}

export function getPreviousFYBounds(now: Date = new Date()): FYBounds {
  const q = windowToQuery(resolveDatePreset("last-fy", now));
  return { start: q.fromDate!, end: q.toDate!, year: businessFinancialYearStartYear(now) - 1 };
}

export function fyLabel(year: number): string {
  return `FY ${year}-${String(year + 1).slice(-2)}`;
}
