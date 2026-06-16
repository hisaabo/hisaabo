/**
 * Indian Currency Formatter & Number-to-Words Converter
 *
 * Implements the Indian numbering system (lakhs and crores) with:
 * - Proper comma placement: ₹1,23,45,678.90
 * - Number to words: "One Crore Twenty-Three Lakh Forty-Five Thousand..."
 * - Both Hindi and English word outputs
 * - Handles up to 99,99,99,99,999 (999 crores)
 *
 * This is critical for invoice PDFs — Indian GST law requires amount
 * in words on all tax invoices (Rule 46(m) of CGST Rules).
 */

import { money } from "./money.js";

// ═══════════════════════════════════════════════════════════════════
// CURRENCY FORMATTING
// ═══════════════════════════════════════════════════════════════════

/**
 * Format a number in Indian comma style: 1,23,456.78
 * Indian system: last 3 digits, then groups of 2
 */
export function formatIndianCurrency(amount: string | number, options?: {
  symbol?: string;
  showPaise?: boolean;
  showSign?: boolean;
}): string {
  const { symbol = "₹", showPaise = true, showSign = false } = options || {};

  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return `${symbol}0.00`;

  const isNegative = num < 0;
  const abs = Math.abs(num);
  const [integerPart, decimalPart] = abs.toFixed(2).split(".");

  // Indian grouping: last 3, then groups of 2
  const formatted = formatIndianGrouping(integerPart);

  let result = showPaise ? `${formatted}.${decimalPart}` : formatted;

  if (isNegative) {
    result = showSign ? `-${symbol}${result}` : `(${symbol}${result})`;
  } else {
    result = `${symbol}${result}`;
  }

  return result;
}

/**
 * Apply Indian-style comma grouping to an integer string.
 * "1234567" → "12,34,567"
 */
function formatIndianGrouping(intStr: string): string {
  if (intStr.length <= 3) return intStr;

  // Last 3 digits are one group
  const lastThree = intStr.slice(-3);
  const remaining = intStr.slice(0, -3);

  // Remaining digits in groups of 2
  const groups: string[] = [];
  let i = remaining.length;
  while (i > 0) {
    const start = Math.max(0, i - 2);
    groups.unshift(remaining.slice(start, i));
    i = start;
  }

  return groups.join(",") + "," + lastThree;
}

/**
 * Compact Indian format: ₹12.5L, ₹3.2Cr, ₹450
 * Used for dashboards and summaries.
 */
export function formatCompactIndian(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "₹0";

  const abs = Math.abs(num);
  const sign = num < 0 ? "-" : "";

  if (abs >= 10000000) {
    return `${sign}₹${(abs / 10000000).toFixed(2).replace(/\.?0+$/, "")}Cr`;
  } else if (abs >= 100000) {
    return `${sign}₹${(abs / 100000).toFixed(2).replace(/\.?0+$/, "")}L`;
  } else if (abs >= 1000) {
    return `${sign}₹${(abs / 1000).toFixed(1).replace(/\.?0+$/, "")}K`;
  } else {
    return `${sign}₹${abs.toFixed(0)}`;
  }
}

// ═══════════════════════════════════════════════════════════════════
// NUMBER TO WORDS (ENGLISH)
// ═══════════════════════════════════════════════════════════════════

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];

const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

function twoDigitWords(n: number): string {
  if (n === 0) return "";
  if (n < 20) return ONES[n];
  const ten = Math.floor(n / 10);
  const one = n % 10;
  return TENS[ten] + (one > 0 ? "-" + ONES[one] : "");
}

function threeDigitWords(n: number): string {
  if (n === 0) return "";
  const hundred = Math.floor(n / 100);
  const remainder = n % 100;
  let result = "";
  if (hundred > 0) {
    result = ONES[hundred] + " Hundred";
    if (remainder > 0) result += " and ";
  }
  if (remainder > 0) {
    result += twoDigitWords(remainder);
  }
  return result;
}

/**
 * Convert a number to words in Indian English format.
 * Handles up to 99,99,99,99,999 (999+ crores).
 *
 * Example: 1234567.89 → "Twelve Lakh Thirty-Four Thousand Five Hundred and Sixty-Seven Rupees and Eighty-Nine Paise Only"
 */
export function numberToWordsIndian(amount: string | number, options?: {
  currency?: string;
  subUnit?: string;
  suffix?: string;
}): string {
  const { currency = "Rupees", subUnit = "Paise", suffix = "Only" } = options || {};

  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num) || num === 0) return `Zero ${currency} ${suffix}`;

  const isNegative = num < 0;
  const abs = Math.abs(num);
  const rupees = Math.floor(abs);
  const paise = Math.round((abs - rupees) * 100);

  if (rupees === 0 && paise === 0) return `Zero ${currency} ${suffix}`;

  // Break into Indian denominational groups
  let remaining = rupees;
  const crores = Math.floor(remaining / 10000000);
  remaining %= 10000000;
  const lakhs = Math.floor(remaining / 100000);
  remaining %= 100000;
  const thousands = Math.floor(remaining / 1000);
  remaining %= 1000;
  const hundreds = remaining;

  const parts: string[] = [];

  if (crores > 0) {
    if (crores > 99) {
      // Handle hundreds of crores
      const croreHundreds = Math.floor(crores / 100);
      const croreRemainder = crores % 100;
      let croreStr = "";
      if (croreHundreds > 0) {
        croreStr = ONES[croreHundreds] + " Hundred";
        if (croreRemainder > 0) croreStr += " and " + twoDigitWords(croreRemainder);
      } else {
        croreStr = twoDigitWords(croreRemainder);
      }
      parts.push(croreStr + " Crore");
    } else {
      parts.push(twoDigitWords(crores) + " Crore");
    }
  }

  if (lakhs > 0) {
    parts.push(twoDigitWords(lakhs) + " Lakh");
  }

  if (thousands > 0) {
    parts.push(twoDigitWords(thousands) + " Thousand");
  }

  if (hundreds > 0) {
    parts.push(threeDigitWords(hundreds));
  }

  let result = parts.join(" ");
  if (isNegative) result = "Minus " + result;

  // Add currency
  result += " " + currency;

  // Add paise
  if (paise > 0) {
    result += " and " + twoDigitWords(paise) + " " + subUnit;
  }

  result += " " + suffix;

  return result;
}

// ═══════════════════════════════════════════════════════════════════
// NUMBER TO WORDS (HINDI)
// ═══════════════════════════════════════════════════════════════════

const HINDI_ONES = [
  "", "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ",
  "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह",
  "सत्रह", "अट्ठारह", "उन्नीस", "बीस",
  "इक्कीस", "बाईस", "तेईस", "चौबीस", "पच्चीस", "छब्बीस", "सत्ताईस", "अट्ठाईस", "उनतीस", "तीस",
  "इकतीस", "बत्तीस", "तैंतीस", "चौंतीस", "पैंतीस", "छत्तीस", "सैंतीस", "अड़तीस", "उनतालीस", "चालीस",
  "इकतालीस", "बयालीस", "तैंतालीस", "चवालीस", "पैंतालीस", "छियालीस", "सैंतालीस", "अड़तालीस", "उनचास", "पचास",
  "इक्यावन", "बावन", "तिरपन", "चौवन", "पचपन", "छप्पन", "सत्तावन", "अट्ठावन", "उनसठ", "साठ",
  "इकसठ", "बासठ", "तिरसठ", "चौंसठ", "पैंसठ", "छियासठ", "सड़सठ", "अड़सठ", "उनहत्तर", "सत्तर",
  "इकहत्तर", "बहत्तर", "तिहत्तर", "चौहत्तर", "पचहत्तर", "छिहत्तर", "सतहत्तर", "अठहत्तर", "उनासी", "अस्सी",
  "इक्यासी", "बयासी", "तिरासी", "चौरासी", "पचासी", "छियासी", "सतासी", "अट्ठासी", "नवासी", "नब्बे",
  "इक्यानवे", "बानवे", "तिरानवे", "चौरानवे", "पचानवे", "छियानवे", "सत्तानवे", "अट्ठानवे", "निन्यानवे",
];

export function numberToWordsHindi(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num) || num === 0) return "शून्य रुपये मात्र";

  const abs = Math.abs(num);
  const rupees = Math.floor(abs);
  const paise = Math.round((abs - rupees) * 100);

  let remaining = rupees;
  const crores = Math.floor(remaining / 10000000);
  remaining %= 10000000;
  const lakhs = Math.floor(remaining / 100000);
  remaining %= 100000;
  const thousands = Math.floor(remaining / 1000);
  remaining %= 1000;
  const hundreds = Math.floor(remaining / 100);
  const lastTwo = remaining % 100;

  const parts: string[] = [];

  if (crores > 0) {
    parts.push(HINDI_ONES[crores] + " करोड़");
  }
  if (lakhs > 0) {
    parts.push(HINDI_ONES[lakhs] + " लाख");
  }
  if (thousands > 0) {
    parts.push(HINDI_ONES[thousands] + " हज़ार");
  }
  if (hundreds > 0) {
    parts.push(HINDI_ONES[hundreds] + " सौ");
  }
  if (lastTwo > 0) {
    parts.push(HINDI_ONES[lastTwo]);
  }

  let result = parts.join(" ") + " रुपये";

  if (paise > 0) {
    result += " और " + HINDI_ONES[paise] + " पैसे";
  }

  result += " मात्र";
  return result;
}
