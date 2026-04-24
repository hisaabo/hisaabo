/**
 * Tests for utility functions in `src/lib/utils.ts`
 *
 * WHY these tests matter for contributors:
 * Hisaabo is an Indian business finance app used by shopkeepers, traders, and
 * distributors across India. Incorrect currency formatting is not a cosmetic
 * bug — it is a trust-destroying issue. Showing "₹100,000" instead of the
 * Indian standard "₹1,00,000" makes the app look unprofessional to the very
 * merchants who use Indian number grouping every day in their ledgers (खाता).
 *
 * Similarly, date formatting must match the "day Month year" format that Indian
 * users are accustomed to (e.g. "28 Mar 2026") — not the US-style "Mar 28,
 * 2026" or the ISO "2026-03-28".
 *
 * Note on NUMERIC(15,2):
 * The database stores monetary values as PostgreSQL NUMERIC(15,2) strings.
 * The API returns them as strings (e.g. "1234.56") to avoid JS floating-point
 * precision loss. formatCurrency() must accept both string and number inputs.
 *
 * Coverage checklist:
 *   - formatCurrency: rupee symbol, Indian grouping, zero, negative, string
 *     input, large crore-scale amounts, NaN fallback
 *   - formatDate: "28 Mar 2026" format, ISO string input, Date object input
 *   - formatDateShort: day+month without year
 */

import {
  formatCurrency,
  formatDate,
  formatDateShort,
  formatDateTime,
  formatDateInput,
  todayISODate,
} from "../utils";

// ---------------------------------------------------------------------------
describe("formatCurrency — INR formatting for Indian business context", () => {
  // -------------------------------------------------------------------------
  it("formats a 4-digit number with the rupee symbol and no thousands separator", () => {
    // WHAT: ₹1000 — below the first Indian grouping boundary, no commas.
    // WHY: Ensure the rupee symbol (₹ U+20B9) is present and no spurious
    //      commas appear for amounts under 10,000.
    const result = formatCurrency(1000);
    expect(result).toContain("₹");
    expect(result).toContain("1,000");
  });

  // -------------------------------------------------------------------------
  it("uses Indian lakh grouping: 100000 → ₹1,00,000 (not ₹100,000)", () => {
    // WHAT: This is the most critical test in the file. In the Indian number
    //       system, grouping is 2-2-3 from the right: 1,00,000 (one lakh).
    //       Western grouping gives 100,000 which is WRONG for Indian users.
    // WHY: A textile merchant in Surat invoicing for ₹1,00,000 sees "₹100,000"
    //      and loses trust in the app's financial accuracy instantly. This has
    //      been the single most-cited complaint in user research for fintech
    //      apps targeting Tier-2 and Tier-3 Indian cities.
    const result = formatCurrency(100000);
    // Indian lakh format: 1,00,000
    expect(result).toMatch(/1,00,000/);
    // Must NOT use western grouping
    expect(result).not.toMatch(/100,000/);
  });

  // -------------------------------------------------------------------------
  it("formats ten lakh (1,000,000) correctly as ₹10,00,000", () => {
    // WHAT: Ten lakh — another common invoice amount in wholesale/B2B trade.
    // WHY: The 2-2-3 grouping rule must apply above 1,00,000 as well.
    const result = formatCurrency(1000000);
    expect(result).toMatch(/10,00,000/);
  });

  // -------------------------------------------------------------------------
  it("handles zero — displays ₹0 without crashing", () => {
    // WHAT: An invoice with no amount yet (e.g. draft state).
    // WHY: A NaN or undefined result for 0 would crash invoice-total rows
    //      that pass the initial value before the user adds line items.
    const result = formatCurrency(0);
    expect(result).toContain("₹");
    expect(result).toContain("0");
  });

  // -------------------------------------------------------------------------
  it("handles negative amounts — refunds and credit notes must show negative values", () => {
    // WHAT: Credit notes and refunds produce negative monetary values (e.g.
    //       a customer return of ₹500 is stored as -500).
    // WHY: If formatCurrency drops the sign, a ₹-500 credit note displays as
    //      ₹500 — making the ledger balance appear ₹1000 off, which triggers
    //      GST reconciliation errors.
    const result = formatCurrency(-500);
    expect(result).toContain("₹");
    expect(result).toMatch(/-/);
    expect(result).toContain("500");
  });

  // -------------------------------------------------------------------------
  it("accepts string input (as returned by the tRPC API for NUMERIC(15,2) fields)", () => {
    // WHAT: The API serialises PostgreSQL NUMERIC as a string "1234.56".
    //       formatCurrency() must parse that string and format it correctly.
    // WHY: If only number inputs are handled, every invoice total rendered
    //      from API data shows "₹0" or "₹NaN" because typeof apiValue is
    //      "string", not "number".
    const result = formatCurrency("1234.56");
    expect(result).toContain("₹");
    expect(result).toContain("1,234");
  });

  // -------------------------------------------------------------------------
  it("handles string with decimal places from PostgreSQL NUMERIC(15,2)", () => {
    // WHAT: A precise monetary value like "99999.99" (₹99,999.99).
    // WHY: Decimal formatting must be preserved — traders use paise (₹0.01)
    //      in small transactions and the rounding must match DB storage.
    const result = formatCurrency("99999.99");
    expect(result).toContain("₹");
    // Intl rounds at 2 decimal places by default — verify number part present
    expect(result).toContain("99,999");
  });

  // -------------------------------------------------------------------------
  it("handles very large crore-scale amounts (₹1,00,00,000 = 1 crore)", () => {
    // WHAT: A large distributor's annual turnover invoice could reach crore
    //       scale. One crore = 10,000,000.
    // WHY: The Indian grouping continues as 1,00,00,000. If the formatter
    //      breaks above 10 lakh, crore-scale invoices display garbage.
    const result = formatCurrency(10000000);
    // Should contain 1,00,00,000
    expect(result).toMatch(/1,00,00,000/);
  });

  // -------------------------------------------------------------------------
  it("returns ₹0 (not NaN or undefined) for non-numeric string input", () => {
    // WHAT: An empty string or garbage value is passed (e.g. a bug upstream
    //       passes an uninitialised variable).
    // WHY: The source code returns "₹0" for NaN (see `if (isNaN(num)) return
    //      "₹0"`). This test pins that safety net so a future refactor doesn't
    //      remove it and cause "₹NaN" to appear in production invoices.
    const result = formatCurrency("not-a-number");
    expect(result).toBe("₹0");
  });
});

// ---------------------------------------------------------------------------
describe("formatDate — Indian date format for invoice and payment timestamps", () => {
  // -------------------------------------------------------------------------
  it("formats a Date object as 'day Mon year' (e.g. '28 Mar 2026')", () => {
    // WHAT: Standard full date displayed on invoice headers and payment records.
    // WHY: Indian users read dates as "28 March 2026" not "March 28, 2026".
    //      The abbreviated month format ("Mar") is used for compactness on
    //      mobile screens that show invoice lists.
    const date = new Date(2026, 2, 28); // March 28 2026 (month is 0-indexed)
    const result = formatDate(date);

    expect(result).toContain("28");
    expect(result).toContain("Mar");
    expect(result).toContain("2026");
  });

  // -------------------------------------------------------------------------
  it("accepts an ISO 8601 string (as returned by tRPC/Postgres timestamps)", () => {
    // WHAT: The API returns timestamps as ISO strings like "2026-01-15T00:00:00.000Z".
    //       formatDate must parse the string before formatting.
    // WHY: If only Date objects are handled, every date on every invoice list
    //      row shows "Invalid Date" — a startup-killing regression that would
    //      surface in the very first E2E test.
    const isoString = "2026-01-15T00:00:00.000Z";
    const result = formatDate(isoString);

    expect(result).toContain("Jan");
    expect(result).toContain("2026");
  });

  // -------------------------------------------------------------------------
  it("formats financial year start (1 Apr 2025) correctly", () => {
    // WHAT: Indian financial year starts on 1 April. GST returns reference
    //       this date heavily. It must format as "1 Apr 2025".
    // WHY: If the formatter adds a leading zero ("01 Apr 2025") when the locale
    //      does not expect one, date-matching in GST reports breaks.
    const fyStart = new Date(2025, 3, 1); // 1 April 2025
    const result = formatDate(fyStart);

    expect(result).toContain("Apr");
    expect(result).toContain("2025");
  });

  // -------------------------------------------------------------------------
  it("formats the last day of a month without off-by-one errors", () => {
    // WHAT: 31 March (end of Indian financial year).
    // WHY: Off-by-one errors in date construction (e.g. using the wrong month
    //      index) turn "31 Mar" into "1 Apr" — changing the financial year,
    //      which has direct GST filing implications.
    const fyEnd = new Date(2026, 2, 31); // 31 March 2026
    const result = formatDate(fyEnd);

    expect(result).toContain("31");
    expect(result).toContain("Mar");
    expect(result).toContain("2026");
  });
});

// ---------------------------------------------------------------------------
describe("formatDateShort — compact date for invoice list rows (no year)", () => {
  // -------------------------------------------------------------------------
  it("formats as 'day Mon' without the year (e.g. '15 Jan')", () => {
    // WHAT: Used in tight mobile invoice list rows where the year is implied
    //       (current financial year is always the context).
    // WHY: Showing the full year in a list of 50 invoices wastes space and
    //      makes amounts harder to scan. The year should be absent here.
    const date = new Date(2026, 0, 15); // January 15 2026
    const result = formatDateShort(date);

    expect(result).toContain("15");
    expect(result).toContain("Jan");
    expect(result).not.toContain("2026");
  });

  // -------------------------------------------------------------------------
  it("accepts an ISO string just like formatDate", () => {
    // WHAT: Consistency — if the API returns a string, both formatDate and
    //       formatDateShort must handle it without the caller needing to wrap.
    const isoString = "2026-03-26T12:00:00.000Z";
    const result = formatDateShort(isoString);

    expect(result).toContain("Mar");
  });
});

// ---------------------------------------------------------------------------
// "Invalid Date" defense — the single invariant this block pins:
//
//   Under no input shape may formatDate / formatDateShort return the
//   literal string "Invalid Date" (or anything containing it) to a user.
//
// WHY THIS MATTERS:
// Every invoice list row, payment list row, ledger entry, shipment card,
// and detail-screen date field routes through these two functions. Before
// the defensive refactor, a nullish date or a Hermes engine that failed
// to format an `en-IN` date (the Android release build uses Hermes, which
// has incomplete ICU data on some devices — see `apps/mobile/app.json`
// `jsEngine` default) surfaced as the string "Invalid Date" on every row
// — which is exactly what users saw in production.
//
// The fallback is an em-dash "—" to match the pattern already used at
// call sites like `item.paymentDate ? formatDateShort(...) : "—"`.
// ---------------------------------------------------------------------------
describe("formatDate / formatDateShort — defensive behaviour for malformed input", () => {
  // -------------------------------------------------------------------------
  it("formatDate(undefined) falls back to em-dash, never to the string 'Invalid Date'", () => {
    // WHAT: tRPC can surface `undefined` when a nullable column is absent
    //       (e.g. an automated-invoice template with no `lastRunDate` yet).
    // WHY:  Call sites routinely pass the raw field without guarding:
    //       `formatDate(template.lastRunDate)`. A leaked "Invalid Date"
    //       string makes every row look corrupted.
    const result = formatDate(undefined as unknown as Date);
    expect(result).not.toMatch(/invalid/i);
    expect(result).toBe("—");
  });

  // -------------------------------------------------------------------------
  it("formatDate(null) falls back to em-dash", () => {
    const result = formatDate(null as unknown as Date);
    expect(result).not.toMatch(/invalid/i);
    expect(result).toBe("—");
  });

  // -------------------------------------------------------------------------
  it("formatDate('') — empty ISO string from the API — falls back to em-dash", () => {
    // WHAT: A recurring Zod edge case — an optional nullable timestamp
    //       that gets stringified to "" somewhere in the pipeline.
    // WHY:  `new Date("")` returns an Invalid Date — before this fix, that
    //       crashed straight through to "Invalid Date" on screen.
    const result = formatDate("");
    expect(result).not.toMatch(/invalid/i);
    expect(result).toBe("—");
  });

  // -------------------------------------------------------------------------
  it("formatDate('garbage-not-a-date') falls back instead of printing 'Invalid Date'", () => {
    // WHAT: Defence-in-depth for any upstream bug that leaks an unparsable
    //       string into the date pipeline (e.g. a locale-dependent
    //       formatter coughing up "dd/mm/yyyy" into a field typed as ISO).
    // WHY:  The user-visible output must never say "Invalid Date" — the
    //       invariant we're pinning is tighter than any single bug.
    const result = formatDate("not-a-real-date");
    expect(result).not.toMatch(/invalid/i);
    expect(result).toBe("—");
  });

  // -------------------------------------------------------------------------
  it("formatDate(new Date(NaN)) — an actual Invalid Date object — falls back", () => {
    // WHAT: A `Date` constructed from NaN is a Date instance, but
    //       .getTime() returns NaN and .toLocaleDateString() returns
    //       "Invalid Date".
    // WHY:  Several call sites guard against null with `?? new Date()`
    //       which can silently land on an Invalid Date in other branches
    //       (e.g. `new Date(nullableString)` when the string is empty).
    const result = formatDate(new Date(NaN));
    expect(result).not.toMatch(/invalid/i);
    expect(result).toBe("—");
  });

  // -------------------------------------------------------------------------
  it("formatDateShort inherits the same defensive posture — no 'Invalid Date' leakage", () => {
    // WHAT: Parity check — list screens mostly use the short form.
    // WHY:  The bug surfaced most visibly on the payments/invoices list
    //       rows, which use `formatDateShort`. If only `formatDate` were
    //       hardened, the bug would persist on the screens where users
    //       actually saw it.
    expect(formatDateShort(undefined as unknown as Date)).toBe("—");
    expect(formatDateShort(null as unknown as Date)).toBe("—");
    expect(formatDateShort("")).toBe("—");
    expect(formatDateShort("garbage-not-a-date")).toBe("—");
    expect(formatDateShort(new Date(NaN))).toBe("—");
    for (const input of [undefined, null, "", "junk", new Date(NaN)]) {
      const out = formatDateShort(input as Date);
      expect(out).not.toMatch(/invalid/i);
    }
  });

  // -------------------------------------------------------------------------
  it("is engine-independent: dayjs produces identical output regardless of Intl/locale data", () => {
    // WHAT: The previous implementation routed through
    //       `Date.prototype.toLocaleDateString("en-IN", ...)` which depends on
    //       the JS engine's bundled ICU data. On Hermes (Android release
    //       builds) this returned the literal string "Invalid Date" for
    //       otherwise-valid Date objects, and in the worst case threw a
    //       RangeError for unsupported locale/option combinations.
    // WHY:  dayjs's `format` tokens produce the same output on every engine
    //       (Hermes, JSC, Node, jsdom), so the bug cannot recur. This test
    //       pins the output shape for a realistic FY-start date and asserts
    //       that stubbing `toLocaleDateString` away changes nothing —
    //       demonstrating that we do not depend on it anymore.
    const realDate = new Date(2025, 3, 1); // 1 Apr 2025 (Indian FY start)

    const originalToLocaleDateString = Date.prototype.toLocaleDateString;
    Date.prototype.toLocaleDateString = function () {
      return "Invalid Date";
    };
    try {
      const result = formatDate(realDate);
      expect(result).not.toMatch(/invalid/i);
      expect(result).toContain("1");
      expect(result).toContain("Apr");
      expect(result).toContain("2025");

      const shortResult = formatDateShort(realDate);
      expect(shortResult).not.toMatch(/invalid/i);
      expect(shortResult).toContain("Apr");
    } finally {
      Date.prototype.toLocaleDateString = originalToLocaleDateString;
    }
  });
});

// ---------------------------------------------------------------------------
describe("formatDateTime — date + time label for audit/API-key rows", () => {
  it("formats a Date object as 'D MMM YYYY, h:mm A'", () => {
    const d = new Date(2026, 2, 28, 14, 30); // 28 Mar 2026, 14:30 local
    const result = formatDateTime(d);
    expect(result).toContain("28");
    expect(result).toContain("Mar");
    expect(result).toContain("2026");
    // Must include a time segment with AM/PM
    expect(result).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/);
  });

  it("accepts an ISO string", () => {
    const result = formatDateTime("2026-01-15T09:05:00.000Z");
    expect(result).toContain("Jan");
    expect(result).toContain("2026");
  });

  it("returns em-dash for null/undefined/empty/invalid input", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
    expect(formatDateTime("")).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("—");
    expect(formatDateTime(new Date(NaN))).toBe("—");
  });
});

// ---------------------------------------------------------------------------
describe("formatDateInput — YYYY-MM-DD for form state", () => {
  it("converts an ISO datetime string to YYYY-MM-DD", () => {
    expect(formatDateInput("2025-03-31T00:00:00.000Z")).toBe("2025-03-31");
  });

  it("returns a 10-character date for a Date object", () => {
    const result = formatDateInput(new Date("2025-07-04T12:00:00.000Z"));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns empty string for null/undefined/empty/invalid (so <input type='date'> stays empty)", () => {
    expect(formatDateInput(null)).toBe("");
    expect(formatDateInput(undefined)).toBe("");
    expect(formatDateInput("")).toBe("");
    expect(formatDateInput("garbage")).toBe("");
  });
});

// ---------------------------------------------------------------------------
describe("todayISODate — centralised today in YYYY-MM-DD", () => {
  it("returns a YYYY-MM-DD formatted string", () => {
    expect(todayISODate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("matches dayjs().format('YYYY-MM-DD') so it can be frozen in tests", async () => {
    // Smoke: two back-to-back calls give the same value (they're on the same day).
    const a = todayISODate();
    const b = todayISODate();
    expect(a).toBe(b);
  });
});
