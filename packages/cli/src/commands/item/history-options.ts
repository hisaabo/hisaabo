export const HISTORY_PERIODS = ["6m", "1y", "all"] as const;
export type HistoryPeriod = (typeof HISTORY_PERIODS)[number];

/** Validate a `--period` flag (undefined keeps the API default, "all"). Throws on bad input. */
export function parsePeriod(value: string | undefined): HistoryPeriod | undefined {
  if (value === undefined) return undefined;
  if ((HISTORY_PERIODS as readonly string[]).includes(value)) return value as HistoryPeriod;
  throw new Error(`Invalid --period "${value}". Use one of: ${HISTORY_PERIODS.join(", ")}`);
}
