// Time-zone-aware date helpers. Built-in Intl only, no imports (keeps it testable with
// `node --experimental-strip-types`).

// ── Time zone ──────────────────────────────────────────────────────────────

/** Thrown for an unknown IANA time zone name. */
export class InvalidTimeZoneError extends Error {
  constructor(tz: string, source: string) {
    super(`Invalid time zone "${tz}" (${source}); expected an IANA name such as Asia/Kolkata or America/New_York`);
    this.name = "InvalidTimeZoneError";
  }
}

function assertValidTimeZone(tz: string, source: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new InvalidTimeZoneError(tz, source);
  }
  return tz;
}

/**
 * Resolve the time zone used for day boundaries: explicit `--tz` flag, then
 * the `HISAABO_TZ` env var, then the machine's local zone.
 */
export function resolveTimeZone(flag?: string, env: NodeJS.ProcessEnv = process.env): string {
  if (flag !== undefined && flag !== "") return assertValidTimeZone(flag, "--tz");
  const fromEnv = env["HISAABO_TZ"];
  if (fromEnv !== undefined && fromEnv !== "") return assertValidTimeZone(fromEnv, "HISAABO_TZ");
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

let activeTimeZone: string | undefined;

/** Set (and validate) the active zone from the global `--tz` flag; falls back to env/system. */
export function setTimeZone(flag?: string): string {
  activeTimeZone = resolveTimeZone(flag);
  return activeTimeZone;
}

/** Active zone (lazily resolved from HISAABO_TZ / system if `setTimeZone` was not called). */
export function getTimeZone(): string {
  activeTimeZone ??= resolveTimeZone();
  return activeTimeZone;
}

interface Ymd { year: number; month: number; day: number }

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

/** Wall-clock parts of an instant in `tz`. */
function zonedParts(ms: number, tz: string) {
  const p: Record<string, number> = {};
  for (const part of dtf(tz).formatToParts(new Date(ms))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Offset (ms, east positive) of `tz` at the given instant. */
function tzOffsetMs(ms: number, tz: string): number {
  const p = zonedParts(Math.floor(ms / 1000) * 1000, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/**
 * The UTC instant at which the wall clock in `tz` reads the given local time.
 * The offset is computed for that specific date, so DST transitions are honoured.
 * Ambiguous wall times (fall-back overlap) resolve to the first occurrence; a wall
 * time skipped by a spring-forward gap resolves using the pre-transition offset
 * (i.e. the first instant after the gap).
 */
export function zonedTimeToUtcMs(
  { year, month, day }: Ymd, h: number, mi: number, s: number, ms: number, tz: string,
): number {
  const wall = Date.UTC(year, month - 1, day, h, mi, s, ms);
  const DAY = 86_400_000;
  const before = tzOffsetMs(wall - DAY, tz);
  const after = tzOffsetMs(wall + DAY, tz);
  const candidates = [...new Set([before, after])]
    .map((o) => wall - o)
    .filter((c) => tzOffsetMs(c, tz) === wall - c)
    .sort((x, y) => x - y);
  return candidates[0] ?? wall - before;
}

/** Today's calendar date in the active zone. */
function todayYmd(now: Date = new Date()): Ymd {
  const p = zonedParts(now.getTime(), getTimeZone());
  return { year: p.year, month: p.month, day: p.day };
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const ymdString = ({ year, month, day }: Ymd) => `${year}-${pad2(month)}-${pad2(day)}`;

// ── Financial year ─────────────────────────────────────────────────────────

/** FY start year for today's date in the active zone (FY starts April 1). */
function fyStartYear(now?: Date): number {
  const t = todayYmd(now);
  return t.month >= 4 ? t.year : t.year - 1;
}

/**
 * Current FY string, e.g. "2025-26". Assumes FY starts April 1.
 */
export function currentFY(now?: Date): string {
  const y = fyStartYear(now);
  return `${y}-${String(y + 1).slice(2)}`;
}

/**
 * FY start date as ISO string (April 1 of current FY).
 */
export function fyStart(now?: Date): string {
  return `${fyStartYear(now)}-04-01`;
}

/**
 * Today as ISO date string (in the active time zone).
 */
export function todayISO(now?: Date): string {
  return ymdString(todayYmd(now));
}

/**
 * First day of current month.
 */
export function monthStart(now?: Date): string {
  const t = todayYmd(now);
  return `${t.year}-${pad2(t.month)}-01`;
}

/**
 * Last day of current month.
 */
export function monthEnd(now?: Date): string {
  const t = todayYmd(now);
  const lastDay = new Date(Date.UTC(t.year, t.month, 0)).getUTCDate();
  return `${t.year}-${pad2(t.month)}-${pad2(lastDay)}`;
}

/**
 * Quarter start/end for a quarter string like "Q1", "Q2", "Q3", "Q4".
 * Q1 = Apr-Jun, Q2 = Jul-Sep, Q3 = Oct-Dec, Q4 = Jan-Mar
 */
export function quarterRange(q: string, now?: Date): { from: string; to: string; month: number; year: number } {
  const fyYear = fyStartYear(now);

  const ranges: Record<string, { from: string; to: string; month: number; year: number }> = {
    Q1: { from: `${fyYear}-04-01`, to: `${fyYear}-06-30`, month: 4, year: fyYear },
    Q2: { from: `${fyYear}-07-01`, to: `${fyYear}-09-30`, month: 7, year: fyYear },
    Q3: { from: `${fyYear}-10-01`, to: `${fyYear}-12-31`, month: 10, year: fyYear },
    Q4: { from: `${fyYear + 1}-01-01`, to: `${fyYear + 1}-03-31`, month: 1, year: fyYear + 1 },
  };

  const upper = q.toUpperCase();
  return ranges[upper] ?? ranges["Q1"]!;
}

/**
 * Widen a plain `YYYY-MM-DD` date to a full ISO (UTC) datetime for server fields
 * validated with `z.string().datetime()`. The date is read as a calendar day in
 * the active time zone (`--tz` / `HISAABO_TZ` / machine zone): "start" is that
 * day's first millisecond and "end" its last, converted to the UTC instant.
 * Anything that is not a plain date is passed through.
 */
export function toApiDateTime(date: string, edge: "start" | "end" = "start", tz: string = getTimeZone()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const ymd = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  const ms = edge === "start"
    ? zonedTimeToUtcMs(ymd, 0, 0, 0, 0, tz)
    : zonedTimeToUtcMs(ymd, 23, 59, 59, 999, tz);
  return new Date(ms).toISOString();
}
/** Start-of-day datetime for an optional `--from` date (see {@link toApiDateTime}). */
export function apiFrom(date: string | undefined): string | undefined {
  return date === undefined ? undefined : toApiDateTime(date, "start");
}

/** End-of-day datetime for an optional `--to` date (see {@link toApiDateTime}). */
export function apiTo(date: string | undefined): string | undefined {
  return date === undefined ? undefined : toApiDateTime(date, "end");
}
