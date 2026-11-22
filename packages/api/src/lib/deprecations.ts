/**
 * Rate-limited deprecation warnings.
 *
 * Password sign-in (auth.register / auth.login) is deprecated in 0.10.0 and
 * removed in 0.11.0. party.tallyExport (a CSV that Tally cannot import) is
 * deprecated in 0.10.1 in favour of reports.tallyExport (Tally Prime XML). The
 * WARN gives self-hosters a signal in their logs that something still calls
 * one of them (an old client, a script) before it is removed. At most one line
 * per procedure per hour per process, carrying the number of calls it stands
 * for; never any request data (no email, no IP). Not a `sec` event, so fail2ban
 * never matches it.
 */
import { logger } from "./logger.js";

export const PASSWORD_SIGN_IN_REMOVAL_VERSION = "0.11.0";
export const DEPRECATION_LOG_INTERVAL_MS = 60 * 60 * 1000;

const state = new Map<string, { lastLoggedAt: number; suppressed: number }>();

/**
 * Log `message` with `fields` unless this procedure already logged within the
 * last DEPRECATION_LOG_INTERVAL_MS; suppressed calls are counted and reported
 * on the next line.
 */
function warnRateLimited(
  procedure: string,
  fields: Record<string, unknown>,
  message: string,
  now: number,
): void {
  const prev = state.get(procedure);
  if (prev && now - prev.lastLoggedAt < DEPRECATION_LOG_INTERVAL_MS) {
    prev.suppressed++;
    return;
  }
  state.set(procedure, { lastLoggedAt: now, suppressed: 0 });
  logger.warn(
    {
      deprecated: true,
      procedure,
      ...fields,
      callsSinceLastWarning: prev ? prev.suppressed + 1 : 1,
    },
    message,
  );
}

export type PasswordSignInProcedure = "auth.login" | "auth.register";

export function warnPasswordSignInDeprecated(procedure: PasswordSignInProcedure, now: number = Date.now()): void {
  warnRateLimited(
    procedure,
    { removedIn: PASSWORD_SIGN_IN_REMOVAL_VERSION },
    `password sign-in is deprecated and will be removed in ${PASSWORD_SIGN_IN_REMOVAL_VERSION} (${procedure}); use magic-link sign-in`,
    now,
  );
}

/**
 * party.tallyExport returns a CSV; Tally imports XML. No removal version is set
 * yet, so the message says "a future release".
 */
export function warnTallyCsvExportDeprecated(now: number = Date.now()): void {
  warnRateLimited(
    "party.tallyExport",
    { replacement: "reports.tallyExport" },
    "party.tallyExport is deprecated and will be removed in a future release; Tally imports XML, not this CSV: use reports.tallyExport",
    now,
  );
}

/** Test hook: forget what has been logged. */
export function resetDeprecationWarnings(): void {
  state.clear();
}
