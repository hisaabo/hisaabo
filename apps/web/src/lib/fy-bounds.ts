import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);

// FY date helpers for the report pages.
// All boundaries are UTC — the DB stores UTC timestamps and local-time
// construction in IST would shift April 1 → March 31 UTC, pulling the
// previous March into the current FY.
//
// IMPORTANT: results are used as tRPC query inputs, so they must be stable
// for the lifetime of a page view. Never return `now.toISOString()` (ms
// precision changes on every call → new query key every render → endless
// refetch loop). The current FY ends at the end of *today*, which is constant
// for the whole day.

export interface FYBounds {
  start: string;
  end: string;
  year: number;
}

export function getCurrentFYBounds(now: Date = new Date()): FYBounds {
  const d = dayjs.utc(now);
  const fyYear = d.month() >= 3 ? d.year() : d.year() - 1;
  return {
    start: dayjs.utc(Date.UTC(fyYear, 3, 1)).toISOString(),
    end: d.endOf("day").toISOString(),
    year: fyYear,
  };
}

export function getPreviousFYBounds(now: Date = new Date()): FYBounds {
  const d = dayjs.utc(now);
  const prevFyYear = d.month() >= 3 ? d.year() - 1 : d.year() - 2;
  return {
    start: dayjs.utc(Date.UTC(prevFyYear, 3, 1)).toISOString(),
    end: dayjs.utc(Date.UTC(prevFyYear + 1, 2, 31)).endOf("day").toISOString(),
    year: prevFyYear,
  };
}

export function fyLabel(year: number): string {
  return `FY ${year}-${String(year + 1).slice(-2)}`;
}
