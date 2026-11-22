/**
 * Per-session write budget for browser-agent writes.
 *
 * Every write is confirmed by the user, which is the real safeguard. This is the
 * backstop for the case where that stops working: a user who has clicked Allow
 * twenty times in a row is no longer reading the dialog. After
 * WRITE_BUDGET approved writes the agent gets a clear "ask the user" error
 * until agent access is switched off and on again in Settings (which is a
 * deliberate, separate act), or the page is reloaded.
 *
 * There is intentionally no "always allow": a budget the agent or a habit can
 * silently raise would defeat its purpose.
 *
 * In memory only, so a reload starts a new session. A write counts when the user
 * approves it, whether or not the API then accepts it: a loop of rejected
 * writes must not be free either.
 */

export const WRITE_BUDGET = 20;

let used = 0;

export function writesUsed(): number {
  return used;
}

export function writesRemaining(): number {
  return Math.max(0, WRITE_BUDGET - used);
}

export function isWriteBudgetExhausted(): boolean {
  return used >= WRITE_BUDGET;
}

/** Spend one write. False (and nothing spent) when the budget is already gone. */
export function consumeWrite(): boolean {
  if (isWriteBudgetExhausted()) return false;
  used += 1;
  return true;
}

/** Start a fresh session. Called when the user turns agent access on, and by tests. */
export function resetWriteBudget(): void {
  used = 0;
}

export function writeBudgetExhaustedMessage(): string {
  return `The AI agent has used its ${WRITE_BUDGET} writes for this session. Nothing was changed. Tell the user; they can allow more by turning "Browser AI agents" off and on again in Settings → Account (or reloading the page).`;
}
