/**
 * hsn-check.ts — the one rule for "does this line carry a usable HSN / SAC code?", shared by the
 * e-invoice (IRP) and e-way bill (NIC) payloads. A line goes out with a real code or the
 * document is refused, per line, before anything is sent.
 *
 * HSN comes from the live item: invoice lines carry no HSN snapshot until 0.11.0.
 */

import { validateHsnForTurnover } from "./hsn-data.js";

export interface HsnLine {
  itemName: string;
  itemHsn?: string | null | undefined;
}

/**
 * The HSN / SAC code of one line, or the reason it cannot be sent.
 *   - missing: `line N 'Name' has no HSN code; add it on the item`
 *   - 4 to 8 digits (spaces, dots and hyphens are dropped: "7306.90" is sent as "730690")
 *   - the digit minimum of the business's annual turnover: 4 digits up to and including
 *     ₹5,00,00,000, 6 above (validateHsnForTurnover, exact in paise)
 */
export function resolveHsn(
  line: HsnLine,
  idx: number,
  annualTurnover: string | null | undefined,
): { code: string } | { problem: string } {
  const label = `line ${idx + 1} '${line.itemName}'`;
  const code = (line.itemHsn ?? "").replace(/[\s.-]/g, "");
  if (!code) return { problem: `${label} has no HSN code; add it on the item` };
  if (!/^\d{4,8}$/.test(code)) {
    return { problem: `${label} has HSN code '${code}', which is not 4 to 8 digits; correct it on the item` };
  }
  // TODO(0.11.0): `annualTurnover` has no input in the app yet, so it is unknown for almost every
  // business and only the 4-digit minimum applies. When 0.11.0 captures turnover, an unknown
  // turnover should prompt for it here instead of assuming the lower band.
  const check = validateHsnForTurnover(code, annualTurnover?.trim() ? annualTurnover : "0");
  if (!check.valid) return { problem: `${label} has HSN code '${code}': ${check.message}` };
  return { code };
}

/** The HSN of every line, in order, or the list of problems (one per offending line). */
export function resolveLineHsns(
  lines: HsnLine[],
  annualTurnover: string | null | undefined,
): { codes: string[]; problems: string[] } {
  const results = lines.map((li, idx) => resolveHsn(li, idx, annualTurnover));
  return {
    codes: results.map((r) => ("code" in r ? r.code : "")),
    problems: results.flatMap((r) => ("problem" in r ? [r.problem] : [])),
  };
}
