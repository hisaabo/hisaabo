/**
 * gst-state.ts — ONE place that decides which state a party or a business is in, and so whether a
 * supply is intra-state (CGST + SGST) or inter-state (IGST).
 *
 * The GST returns, the ledger, the invoice PDF, the e-invoice (IRP), the e-way bill, the ITC entries and
 * the composition-scheme check all call `isIntraStateSupply` / `resolveState`, so one invoice is never
 * CGST + SGST in one place and IGST in another.
 *
 * THE RULE (`resolveState`), most reliable first:
 *   1. the first two digits of the GSTIN, when they are a valid state code. They are the registered
 *      state: the IRP and the portal check them, and a stored `state_code` that disagrees is wrong data;
 *   2. the stored `state_code`, when it is a valid code;
 *   3. the state name (`state`), by the table below.
 * Legacy codes are mapped to their current ones before comparing: 28 (Andhra Pradesh before 2014's
 * division, still on many older GSTINs and records) is 37; 25 (Daman & Diu, merged in 2020) is 26.
 * A stored code that is not in the table ("00", "50") is ignored (and reported), never compared.
 * 96 is "other country" (an export), 97 "other territory".
 *
 * Both sides resolved: same code is intra-state, different is inter-state. A side that cannot be
 * resolved: names are compared as text when both exist; otherwise the supply is treated as intra-state,
 * the supplier's own state, which is the place of supply the GST law defaults to when the recipient's
 * location is not on record (an unregistered walk-in customer with no address). A registered recipient
 * always resolves through the GSTIN.
 */

/** Current state / UT codes with their names. 96 and 97 are special (foreign country, other territory). */
export const GST_STATE_NAMES: Readonly<Record<string, string>> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "96": "Other Country",
  "97": "Other Territory",
};

/** The GST code of "other country": the buyer of an export. */
export const FOREIGN_STATE_CODE = "96";

/** Codes still found on older GSTINs and records, and the current code they stand for. */
const LEGACY_STATE_CODES: Readonly<Record<string, string>> = {
  "28": "37", // Andhra Pradesh, before the division
  "25": "26", // Daman & Diu, merged into Dadra and Nagar Haveli and Daman and Diu
};

/** Name variants (lower-case, "and" for "&") that are not the current official name. */
const NAME_ALIASES: Readonly<Record<string, string>> = {
  "orissa": "21",
  "uttaranchal": "05",
  "pondicherry": "34",
  "andhra pradesh new": "37",
  "daman and diu": "26",
  "dadra and nagar haveli": "26",
  "jammu kashmir": "01",
  "delhi nct": "07",
  "nct of delhi": "07",
  "new delhi": "07",
  "andaman nicobar islands": "35",
  "other country": "96",
  "foreign": "96",
  "other territory": "97",
};

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[().,/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NAME_TO_CODE: ReadonlyMap<string, string> = new Map([
  ...Object.entries(GST_STATE_NAMES).map(([code, name]) => [normaliseName(name), code] as const),
  ...Object.entries(NAME_ALIASES),
]);

/** Is this a code in the GST state table (current or legacy)? "00", "50", "99" and non-digits are not. */
export function isValidStateCode(code: string | null | undefined): boolean {
  if (typeof code !== "string") return false;
  const c = code.trim();
  return c in GST_STATE_NAMES || c in LEGACY_STATE_CODES;
}

/** The current 2-digit code for a valid code (28 -> 37, 25 -> 26); null for anything not in the table. */
export function canonicalStateCode(code: string | null | undefined): string | null {
  if (typeof code !== "string") return null;
  const c = code.trim();
  if (c in LEGACY_STATE_CODES) return LEGACY_STATE_CODES[c]!;
  return c in GST_STATE_NAMES ? c : null;
}

/** The state code a state name stands for ("Orissa" -> 21, "Andhra Pradesh" -> 37), or null. */
export function stateCodeOfName(name: string | null | undefined): string | null {
  if (typeof name !== "string" || name.trim() === "") return null;
  return NAME_TO_CODE.get(normaliseName(name)) ?? null;
}

/** The state code in the first two digits of a GSTIN, canonical, when it is a valid code; null otherwise ("URP", garbage). */
export function stateCodeOfGstin(gstin: string | null | undefined): string | null {
  if (typeof gstin !== "string") return null;
  const g = gstin.trim().toUpperCase();
  if (!/^\d{2}/.test(g)) return null;
  return canonicalStateCode(g.slice(0, 2));
}

export interface StateInput {
  gstin?: string | null;
  stateCode?: string | null;
  state?: string | null;
}

export interface ResolvedState {
  /** The canonical 2-digit code (legacy 28 -> 37), the one to COMPARE; null when nothing on the record names a state. */
  code: string | null;
  /**
   * The code as the record itself carries it (a GSTIN starting 28 stays "28"): the one to SEND to the IRP / NIC,
   * which check it against the GSTIN. Equal to `code` except for a legacy code.
   */
  rawCode: string | null;
  /** Where `code` came from. */
  source: "gstin" | "stateCode" | "stateName" | null;
  /** The code is 96 (other country): an export. */
  foreign: boolean;
  /** A stored state code that disagrees with the GSTIN (both valid, after mapping legacy codes). The GSTIN wins. */
  conflict: { gstinCode: string; storedCode: string } | null;
  /** A stored state code that is not in the table ("00", "50"): ignored. */
  invalidStoredCode: string | null;
}

/** Which state this record is in; see the rule at the top of the file. */
export function resolveState(input: StateInput | null | undefined): ResolvedState {
  const stored = input?.stateCode?.trim() || null;
  const storedCanonical = canonicalStateCode(stored);
  const invalidStoredCode = stored && storedCanonical === null ? stored : null;
  const gstinCode = stateCodeOfGstin(input?.gstin);

  let code: string | null = null;
  let rawCode: string | null = null;
  let source: ResolvedState["source"] = null;
  if (gstinCode) {
    code = gstinCode;
    rawCode = input!.gstin!.trim().slice(0, 2);
    source = "gstin";
  } else if (storedCanonical) {
    code = storedCanonical;
    rawCode = stored;
    source = "stateCode";
  } else {
    const byName = stateCodeOfName(input?.state);
    if (byName) {
      code = byName;
      rawCode = byName;
      source = "stateName";
    }
  }
  return {
    code,
    rawCode,
    source,
    foreign: code === FOREIGN_STATE_CODE,
    conflict: gstinCode && storedCanonical && gstinCode !== storedCanonical ? { gstinCode, storedCode: stored! } : null,
    invalidStoredCode,
  };
}

/**
 * "intra" (CGST + SGST), "inter" (IGST) or "unknown" (a side names no state and the names cannot settle it).
 * Uses `resolveState` on both sides; see the rule at the top of the file.
 */
export function supplyKind(seller: StateInput | null | undefined, buyer: StateInput | null | undefined): "intra" | "inter" | "unknown" {
  const a = resolveState(seller);
  const b = resolveState(buyer);
  if (a.code && b.code) return a.code === b.code ? "intra" : "inter";
  const sa = seller?.state?.trim().toLowerCase();
  const sb = buyer?.state?.trim().toLowerCase();
  if (sa && sb) return sa === sb ? "intra" : "inter"; // names the table does not know: compare as text
  return "unknown";
}

/**
 * Is this supply intra-state (CGST + SGST) rather than inter-state (IGST)? THE decision the returns, the
 * ledger, the PDF, the e-invoice, the e-way bill and the ITC entries share. When it cannot be told
 * ("unknown") it is intra-state, the supplier's own state (see the top of the file).
 */
export function isIntraStateSupply(seller: StateInput | null | undefined, buyer: StateInput | null | undefined): boolean {
  return supplyKind(seller, buyer) !== "inter";
}
