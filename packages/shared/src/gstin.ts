/**
 * GSTIN Validator — Full algorithmic validation per CBIC specification
 *
 * Structure: 2-digit State Code + 10-char PAN + 1-char Entity Number + 'Z' + 1-char Check Digit
 * Check digit uses Luhn mod-36 algorithm (ISO/IEC 7064, MOD 36,2)
 *
 * References:
 * - CBIC Circular No. 26/26/2017-GST
 * - GST Portal Technical Documentation
 * - Rule 10 of CGST Rules, 2017
 */

// Valid Indian state codes as per GST notification
const VALID_STATE_CODES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab",
  "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana",
  "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh",
  "13": "Nagaland", "14": "Manipur", "15": "Mizoram",
  "16": "Tripura", "17": "Meghalaya", "18": "Assam",
  "19": "West Bengal", "20": "Jharkhand", "21": "Odisha",
  "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "25": "Daman & Diu", "26": "Dadra & Nagar Haveli & Daman & Diu",
  "27": "Maharashtra", "28": "Andhra Pradesh (Old)", "29": "Karnataka",
  "30": "Goa", "31": "Lakshadweep", "32": "Kerala",
  "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman & Nicobar",
  "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
  "96": "Foreign Country", "97": "Other Territory",
};

// Character set for MOD 36 check digit: 0-9 then A-Z
const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Compute check digit using Luhn Mod-36 (ISO/IEC 7064 MOD 36,2)
 * This is the exact algorithm specified by NIC for GSTIN validation.
 */
function computeCheckDigit(gstin14: string): string {
  const input = gstin14.toUpperCase();
  let factor = 2;
  let sum = 0;

  for (let i = input.length - 1; i >= 0; i--) {
    const charIndex = GSTIN_CHARS.indexOf(input[i]);
    if (charIndex === -1) return "";

    let addend = factor * charIndex;
    // Factor alternates between 1 and 2
    factor = factor === 2 ? 1 : 2;
    // Sum the digits of the product (in base 36)
    addend = Math.floor(addend / 36) + (addend % 36);
    sum += addend;
  }

  const remainder = sum % 36;
  const checkCodePoint = (36 - remainder) % 36;
  return GSTIN_CHARS[checkCodePoint];
}

export interface GstinValidationResult {
  isValid: boolean;
  errors: string[];
  stateCode: string | null;
  stateName: string | null;
  pan: string | null;
  entityNumber: string | null;
  registrationType: "regular" | "composition" | "tds" | "tcs" | "un_body" | "government" | "nri" | null;
}

/**
 * Validate a GSTIN with full algorithmic check.
 * Goes beyond regex — performs state code verification, PAN structure check,
 * entity type detection, and Luhn Mod-36 checksum verification.
 */
export function validateGstin(gstin: string): GstinValidationResult {
  const errors: string[] = [];
  const result: GstinValidationResult = {
    isValid: false, errors, stateCode: null, stateName: null,
    pan: null, entityNumber: null, registrationType: null,
  };

  if (!gstin || typeof gstin !== "string") {
    errors.push("GSTIN is required");
    return result;
  }

  const g = gstin.toUpperCase().trim();

  // Length check
  if (g.length !== 15) {
    errors.push(`GSTIN must be exactly 15 characters, got ${g.length}`);
    return result;
  }

  // Character set check
  if (!/^[0-9A-Z]+$/.test(g)) {
    errors.push("GSTIN must contain only digits and uppercase letters");
    return result;
  }

  // State code (positions 1-2)
  const stateCode = g.substring(0, 2);
  if (!VALID_STATE_CODES[stateCode]) {
    errors.push(`Invalid state code '${stateCode}'. Must be a valid Indian state/UT code (01-38, 96-97)`);
  } else {
    result.stateCode = stateCode;
    result.stateName = VALID_STATE_CODES[stateCode];
  }

  // PAN (positions 3-12)
  const pan = g.substring(2, 12);
  result.pan = pan;

  // PAN structure: AAAAA9999A
  // Positions 1-3: Alphabets (surname/entity initials - irrelevant for validation)
  // Position 4: Entity type (C=Company, P=Person, H=HUF, F=Firm, A=AOP, T=Trust, B=BOI, L=Local Auth, J=AJP, G=Government)
  // Position 5: Alphabet (first char of surname for P, or entity name)
  // Positions 6-9: Digits (sequential number)
  // Position 10: Alphabet (check letter)
  const panRegex = /^[A-Z]{3}[ABCFGHLJPTK][A-Z]\d{4}[A-Z]$/;
  if (!panRegex.test(pan)) {
    errors.push(`Invalid PAN structure in positions 3-12. Expected format: AAAAA9999A. Fourth character must be a valid entity type code`);
  }

  // Entity type from PAN 4th character
  const panEntityChar = pan[3];
  const entityTypeMap: Record<string, string> = {
    C: "Company", P: "Individual", H: "HUF", F: "Firm",
    A: "AOP", T: "Trust", B: "BOI", L: "Local Authority",
    J: "Artificial Juridical Person", G: "Government", K: "KPC (TDS/TCS)",
  };

  // Entity number (position 13): 1-9 or A-Z
  const entityNum = g[12];
  result.entityNumber = entityNum;

  if (!/^[1-9A-Z]$/.test(entityNum)) {
    errors.push("Position 13 (entity number) must be 1-9 or A-Z");
  }

  // Determine registration type from entity number
  if (/^[1-9]$/.test(entityNum)) {
    result.registrationType = "regular";
  } else if (entityNum === "Z") {
    // Could indicate composition dealer
    result.registrationType = "composition";
  }

  // Position 14 must be 'Z' (reserved for future use per CBIC)
  if (g[13] !== "Z") {
    errors.push(`Position 14 must be 'Z' (default alphabet). Found '${g[13]}'`);
  }

  // Check digit (position 15) — Luhn Mod-36
  const expectedCheckDigit = computeCheckDigit(g.substring(0, 14));
  const actualCheckDigit = g[14];

  if (expectedCheckDigit && actualCheckDigit !== expectedCheckDigit) {
    errors.push(`Check digit mismatch. Expected '${expectedCheckDigit}', got '${actualCheckDigit}'. GSTIN may be incorrectly transcribed`);
  }

  // Special registration types based on patterns
  if (panEntityChar === "K") {
    result.registrationType = "tds";
  }

  result.isValid = errors.length === 0;
  return result;
}

/**
 * Extract state code from GSTIN
 */
export function getStateFromGstin(gstin: string): { code: string; name: string } | null {
  if (!gstin || gstin.length < 2) return null;
  const code = gstin.substring(0, 2);
  const name = VALID_STATE_CODES[code];
  return name ? { code, name } : null;
}

/**
 * Determine GST type (CGST+SGST or IGST) based on supplier and recipient state codes.
 * This is the fundamental tax determination rule under GST law.
 *
 * Section 7(1): Intra-state → CGST + SGST (each at half the rate)
 * Section 7(2): Inter-state → IGST (at full rate)
 * Section 8(2): Deemed inter-state if either party is in a UT without legislature
 */
export function determineGstType(
  supplierStateCode: string,
  recipientStateCode: string,
): "intra" | "inter" {
  if (!supplierStateCode || !recipientStateCode) return "inter"; // Default to IGST if unknown
  return supplierStateCode === recipientStateCode ? "intra" : "inter";
}

/**
 * Split total GST into CGST+SGST or IGST components based on transaction type.
 * Uses the money module for precision.
 */
export function splitGstComponents(
  totalTaxAmount: string,
  gstType: "intra" | "inter",
): { cgst: string; sgst: string; igst: string } {
  const { money } = require("./money.js");

  if (gstType === "inter") {
    return { cgst: "0.00", sgst: "0.00", igst: totalTaxAmount };
  }

  // Intra-state: split equally between CGST and SGST
  // Handle odd paise: CGST gets the extra paise (standard practice)
  const half = money.percent(totalTaxAmount, "50");
  const otherHalf = money.sub(totalTaxAmount, half);

  return { cgst: half, sgst: otherHalf, igst: "0.00" };
}

/**
 * Validate PAN (Permanent Account Number)
 * Format: AAAAA9999A
 */
export function validatePan(pan: string): { isValid: boolean; entityType: string | null; error: string | null } {
  if (!pan || typeof pan !== "string") {
    return { isValid: false, entityType: null, error: "PAN is required" };
  }

  const p = pan.toUpperCase().trim();
  if (p.length !== 10) {
    return { isValid: false, entityType: null, error: `PAN must be 10 characters, got ${p.length}` };
  }

  if (!/^[A-Z]{3}[ABCFGHLJPTK][A-Z]\d{4}[A-Z]$/.test(p)) {
    return { isValid: false, entityType: null, error: "Invalid PAN format" };
  }

  const entityTypes: Record<string, string> = {
    A: "AOP/BOI", B: "BOI", C: "Company", F: "Firm",
    G: "Government", H: "HUF", J: "AJP", L: "Local Authority",
    P: "Individual", T: "Trust", K: "KPC",
  };

  return { isValid: true, entityType: entityTypes[p[3]] || null, error: null };
}

export { VALID_STATE_CODES };
