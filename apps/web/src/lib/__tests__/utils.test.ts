/**
 * Tests for pure utility functions in apps/web/src/lib/utils.ts
 *
 * WHY THIS FILE EXISTS:
 * utils.ts exports small, composable functions used throughout the Hisaabo
 * web app — from building Tailwind class strings to generating CSV exports
 * for business owners. Regressions in these helpers can corrupt user-facing
 * data silently. This file pins the exact contract of every exported function
 * that is NOT already covered by accessibility.test.tsx.
 *
 * ALREADY TESTED ELSEWHERE (do not duplicate):
 *   formatCurrency, formatDate, getInitials, getStatusColor
 *   — see apps/web/src/__tests__/accessibility.test.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cn,
  formatDateInput,
  formatDateShort,
  formatMonthYearShort,
  getDocumentTypeLabel,
  getDocumentTypeColor,
  downloadCSV,
  toISOString,
  toISOStringEndOfDay,
  todayISODate,
} from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// cn() — Tailwind class name merger
// ─────────────────────────────────────────────────────────────────────────────
describe("cn() — Tailwind className merger", () => {
  /**
   * cn() is used everywhere a component conditionally toggles classes.
   * It must faithfully join truthy strings and silently discard falsy values
   * so callers can write cn("base", isActive && "active") without guards.
   */

  it("joins two class strings with a single space", () => {
    expect(cn("px-4", "py-2")).toBe("px-4 py-2");
  });

  it("joins more than two class strings", () => {
    expect(cn("flex", "items-center", "gap-4", "text-sm")).toBe(
      "flex items-center gap-4 text-sm"
    );
  });

  it("returns an empty string when called with no arguments", () => {
    expect(cn()).toBe("");
  });

  it("returns an empty string when every argument is falsy", () => {
    expect(cn(false, null, undefined)).toBe("");
  });

  it("filters out false so conditional expressions work inline", () => {
    const isActive = false;
    expect(cn("base", isActive && "active")).toBe("base");
  });

  it("includes the conditional class when the condition is true", () => {
    const isActive = true;
    expect(cn("base", isActive && "active")).toBe("base active");
  });

  it("filters out null values", () => {
    expect(cn("text-lg", null, "font-bold")).toBe("text-lg font-bold");
  });

  it("filters out undefined values", () => {
    expect(cn("rounded", undefined, "shadow")).toBe("rounded shadow");
  });

  it("handles a single non-empty string", () => {
    expect(cn("w-full")).toBe("w-full");
  });

  it("handles a mix of falsy and truthy values in arbitrary order", () => {
    // Realistic Hisaabo usage: status badge conditional classes
    const isPaid = true;
    const isOverdue = false;
    expect(
      cn(
        "inline-flex items-center rounded-full px-2 py-1 text-xs",
        isPaid && "bg-emerald-50 text-emerald-700",
        isOverdue && "bg-red-50 text-red-700"
      )
    ).toBe(
      "inline-flex items-center rounded-full px-2 py-1 text-xs bg-emerald-50 text-emerald-700"
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatDateInput() — ISO string → YYYY-MM-DD for <input type="date">
// ─────────────────────────────────────────────────────────────────────────────
describe("formatDateInput() — converts dates to YYYY-MM-DD for HTML date inputs", () => {
  /**
   * Invoice date and due-date fields are <input type="date"> elements that
   * require exactly YYYY-MM-DD format. formatDateInput() normalises both ISO
   * strings (from the API) and Date objects (from local state) into that format.
   */

  it("converts an ISO datetime string to YYYY-MM-DD", () => {
    // The API returns timestamps like "2025-03-31T00:00:00.000Z"
    expect(formatDateInput("2025-03-31T00:00:00.000Z")).toBe("2025-03-31");
  });

  it("converts a plain date-only ISO string to YYYY-MM-DD", () => {
    expect(formatDateInput("2024-01-15")).toBe("2024-01-15");
  });

  it("converts a Date object to YYYY-MM-DD", () => {
    // Use a UTC-based date to avoid timezone drift in the assertion
    const d = new Date("2025-07-04T12:00:00.000Z");
    const result = formatDateInput(d);
    // Must be exactly 10 characters and match the date pattern
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("preserves the year, month, and day for financial-year boundary dates", () => {
    // Financial year starts April 1 — a critical date in Hisaabo
    const result = formatDateInput("2025-04-01T00:00:00.000Z");
    expect(result).toBe("2025-04-01");
  });

  it("produces a string with exactly 10 characters (YYYY-MM-DD)", () => {
    expect(formatDateInput("2024-12-31T23:59:59.000Z")).toHaveLength(10);
  });

  it("returns an empty string for null/undefined so <input type='date' value=''> stays empty", () => {
    // REGRESSION: the old implementation returned `undefined` for these cases,
    // which React would render as an uncontrolled-input warning. The dayjs
    // implementation centralises on "" so every consumer gets a controlled value.
    expect(formatDateInput(null)).toBe("");
    expect(formatDateInput(undefined)).toBe("");
    expect(formatDateInput("")).toBe("");
  });

  it("returns an empty string for an invalid date string rather than 'Invalid Date'", () => {
    // Before the dayjs pass, `new Date("garbage").toISOString()` threw —
    // breaking any form that round-tripped a malformed API value.
    expect(formatDateInput("garbage-not-a-date")).toBe("");
  });

  it("accepts a Date object input (in addition to ISO strings)", () => {
    const d = new Date("2025-07-04T12:00:00.000Z");
    expect(formatDateInput(d)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatDateShort / formatMonthYearShort — compact chart axis labels
// ─────────────────────────────────────────────────────────────────────────────
describe("formatDateShort() — 'D MMM' for week-range chart labels", () => {
  it("formats a Date object as day + short month (no year)", () => {
    const result = formatDateShort(new Date(2026, 0, 15));
    expect(result).toContain("15");
    expect(result).toContain("Jan");
    expect(result).not.toContain("2026");
  });

  it("returns em-dash for nullish/invalid input", () => {
    expect(formatDateShort(null)).toBe("—");
    expect(formatDateShort("")).toBe("—");
    expect(formatDateShort("garbage")).toBe("—");
  });
});

describe("formatMonthYearShort() — 'MMM YY' for monthly chart axes", () => {
  it("formats as 'Mar 25' for March 2025", () => {
    expect(formatMonthYearShort("2025-03-15T00:00:00.000Z")).toContain("Mar");
    expect(formatMonthYearShort("2025-03-15T00:00:00.000Z")).toContain("25");
  });

  it("returns em-dash for nullish/invalid input", () => {
    expect(formatMonthYearShort(null)).toBe("—");
    expect(formatMonthYearShort("")).toBe("—");
    expect(formatMonthYearShort("garbage")).toBe("—");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// toISOString / toISOStringEndOfDay — form input → ISO for tRPC mutations
// ─────────────────────────────────────────────────────────────────────────────
describe("toISOString() — YYYY-MM-DD → ISO for z.string().datetime() inputs", () => {
  it("returns a full ISO string for a valid YYYY-MM-DD input", () => {
    const result = toISOString("2025-03-31");
    // Must be a full ISO timestamp (20 or more chars, with T and Z)
    expect(result).toBeDefined();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(result).toContain("2025-03-31");
  });

  it("accepts a Date object", () => {
    const result = toISOString(new Date("2025-03-31T12:00:00.000Z"));
    expect(result).toBe("2025-03-31T12:00:00.000Z");
  });

  it("returns undefined for null/undefined/empty so optional mutation fields stay absent", () => {
    expect(toISOString(null)).toBeUndefined();
    expect(toISOString(undefined)).toBeUndefined();
    expect(toISOString("")).toBeUndefined();
  });

  it("returns undefined for invalid input rather than 'Invalid Date' ISO", () => {
    expect(toISOString("garbage")).toBeUndefined();
    expect(toISOString(new Date(NaN))).toBeUndefined();
  });
});

describe("toISOStringEndOfDay() — upper-bound range filters include the whole day", () => {
  it("pushes to 23:59:59.999 before serialising", () => {
    const result = toISOStringEndOfDay("2025-03-31");
    expect(result).toBeDefined();
    // dayjs endOf("day") → 23:59:59.999 in local tz, then .toISOString()
    // Exact time depends on tz but must end with ":59.999Z" after conversion to UTC.
    expect(result).toMatch(/\.999Z$/);
  });

  it("returns undefined for null/undefined/empty/invalid", () => {
    expect(toISOStringEndOfDay(null)).toBeUndefined();
    expect(toISOStringEndOfDay("")).toBeUndefined();
    expect(toISOStringEndOfDay("garbage")).toBeUndefined();
  });
});

describe("todayISODate() — centralised today in YYYY-MM-DD", () => {
  it("returns a string in YYYY-MM-DD format", () => {
    expect(todayISODate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns exactly 10 characters", () => {
    expect(todayISODate()).toHaveLength(10);
  });

  it("two calls on the same tick return the same value", () => {
    const a = todayISODate();
    const b = todayISODate();
    expect(a).toBe(b);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getDocumentTypeLabel() — human-readable label for document type codes
// ─────────────────────────────────────────────────────────────────────────────
describe("getDocumentTypeLabel() — returns a human-readable label for each document type", () => {
  /**
   * Document type codes are stored as snake_case strings in the database and
   * must be displayed as readable titles in the UI (headings, badges, PDF
   * headers). A wrong label on a tax document can cause compliance issues for
   * the business owner.
   */

  it("labels 'invoice' as 'Invoice'", () => {
    expect(getDocumentTypeLabel("invoice")).toBe("Invoice");
  });

  it("labels 'quotation' as 'Quotation'", () => {
    expect(getDocumentTypeLabel("quotation")).toBe("Quotation");
  });

  it("labels 'credit_note' as 'Credit Note' (two words, not snake_case)", () => {
    expect(getDocumentTypeLabel("credit_note")).toBe("Credit Note");
  });

  it("labels 'debit_note' as 'Debit Note'", () => {
    expect(getDocumentTypeLabel("debit_note")).toBe("Debit Note");
  });

  it("labels 'delivery_challan' as 'Delivery Challan'", () => {
    expect(getDocumentTypeLabel("delivery_challan")).toBe("Delivery Challan");
  });

  it("labels 'proforma' as 'Proforma Invoice' (expanded form used on official documents)", () => {
    expect(getDocumentTypeLabel("proforma")).toBe("Proforma Invoice");
  });

  it("labels 'sales_return' as 'Sales Return'", () => {
    expect(getDocumentTypeLabel("sales_return")).toBe("Sales Return");
  });

  it("labels 'purchase_return' as 'Purchase Return'", () => {
    expect(getDocumentTypeLabel("purchase_return")).toBe("Purchase Return");
  });

  it("returns the raw string unchanged for an unknown document type (graceful fallback)", () => {
    // Future document types added to the DB should not crash — they fall back to
    // displaying the raw code rather than throwing or returning undefined.
    expect(getDocumentTypeLabel("unknown_type")).toBe("unknown_type");
    expect(getDocumentTypeLabel("custom_doc")).toBe("custom_doc");
  });

  it("returns an empty string unchanged for an empty-string input", () => {
    expect(getDocumentTypeLabel("")).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getDocumentTypeColor() — Tailwind color classes for document type badges
// ─────────────────────────────────────────────────────────────────────────────
describe("getDocumentTypeColor() — returns Tailwind color classes for document type badges", () => {
  /**
   * The document list uses colour-coded badges so users can scan many documents
   * quickly. Each document type has a distinct colour. The function must return
   * dark-mode variants too (dark:bg-* dark:text-*) for the mandatory theme toggle.
   */

  it("returns blue classes for 'invoice'", () => {
    const result = getDocumentTypeColor("invoice");
    expect(result).toContain("blue");
  });

  it("returns purple classes for 'quotation'", () => {
    const result = getDocumentTypeColor("quotation");
    expect(result).toContain("purple");
  });

  it("returns amber classes for 'credit_note'", () => {
    const result = getDocumentTypeColor("credit_note");
    expect(result).toContain("amber");
  });

  it("returns orange classes for 'debit_note'", () => {
    const result = getDocumentTypeColor("debit_note");
    expect(result).toContain("orange");
  });

  it("returns teal classes for 'delivery_challan'", () => {
    const result = getDocumentTypeColor("delivery_challan");
    expect(result).toContain("teal");
  });

  it("returns indigo classes for 'proforma'", () => {
    const result = getDocumentTypeColor("proforma");
    expect(result).toContain("indigo");
  });

  it("returns rose classes for 'sales_return'", () => {
    const result = getDocumentTypeColor("sales_return");
    expect(result).toContain("rose");
  });

  it("returns red classes for 'purchase_return'", () => {
    const result = getDocumentTypeColor("purchase_return");
    expect(result).toContain("red");
  });

  it("includes both light and dark-mode variants for every known type", () => {
    const types = [
      "invoice",
      "quotation",
      "credit_note",
      "debit_note",
      "delivery_challan",
      "proforma",
      "sales_return",
      "purchase_return",
    ];
    for (const type of types) {
      const result = getDocumentTypeColor(type);
      expect(result, `${type} should have dark: variant`).toContain("dark:");
    }
  });

  it("returns a fallback class string for an unknown document type", () => {
    const result = getDocumentTypeColor("unknown_type");
    // Should return something non-empty rather than throw or return undefined
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// downloadCSV() — exports tabular data as a BOM-prefixed CSV file
// ─────────────────────────────────────────────────────────────────────────────
describe("downloadCSV() — generates and triggers download of a BOM-prefixed CSV", () => {
  /**
   * Business owners export party lists, item lists, and invoice summaries to
   * Excel. The BOM prefix (\uFEFF) is mandatory — without it, Excel on Windows
   * misreads UTF-8 characters like ₹ and Indian names. Quote-wrapping and
   * double-quote escaping follow RFC 4180 so the file opens correctly in any
   * spreadsheet application.
   *
   * APPROACH: We capture the Blob constructor arguments using a wrapper that
   * delegates to the real Blob so that URL.createObjectURL receives a valid
   * object. We inspect the captured content string after the call, which avoids
   * both the recursive-spy stack overflow and the undefined-parts issue that
   * appear when asserting inside the mock body.
   */

  // OriginalBlob is captured once at module scope so the wrapper can always
  // call through to the real constructor without triggering the spy.
  const OriginalBlob = globalThis.Blob;

  let mockAnchor: {
    href: string;
    download: string;
    click: ReturnType<typeof vi.fn>;
  };

  /** Installs the Blob spy and returns a getter for the last captured content. */
  function installBlobSpy(): () => { content: string; type: string } {
    let lastContent = "";
    let lastType = "";
    vi.spyOn(globalThis, "Blob").mockImplementation(
      (parts?: BlobPart[], options?: BlobPropertyBag) => {
        // parts[0] is the full CSV string ("\uFEFF" + csv)
        lastContent = (parts?.[0] as string) ?? "";
        lastType = options?.type ?? "";
        return new OriginalBlob(parts ?? [], options);
      }
    );
    return () => ({ content: lastContent, type: lastType });
  }

  beforeEach(() => {
    mockAnchor = { href: "", download: "", click: vi.fn() };

    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "a") return mockAnchor as unknown as HTMLElement;
      // Fall through to real createElement for other tags
      return document.createElement(tag);
    });

    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn(() => "blob:mock-url"),
        revokeObjectURL: vi.fn(),
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets the download attribute to '<filename>.csv'", () => {
    downloadCSV("hisaabo-parties", ["Name", "GSTIN"], [["Sharma Traders", "27AABCS1234A1Z5"]]);
    expect(mockAnchor.download).toBe("hisaabo-parties.csv");
  });

  it("calls element.click() to trigger the browser download dialog", () => {
    downloadCSV("test-export", ["Col"], [["value"]]);
    expect(mockAnchor.click).toHaveBeenCalledTimes(1);
  });

  it("calls URL.createObjectURL to create a downloadable blob URL", () => {
    downloadCSV("invoices", ["Invoice #", "Amount"], [["INV-0001", "10000.00"]]);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("calls URL.revokeObjectURL after clicking to free memory", () => {
    downloadCSV("invoices", ["Invoice #"], [["INV-0001"]]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("creates a Blob with the UTF-8 BOM prefix so Excel opens Indian text correctly", () => {
    const getCapture = installBlobSpy();
    downloadCSV("items", ["Item", "Rate"], [["Cement Bag", "350"]]);
    const { content } = getCapture();
    expect(content).toMatch(/^\uFEFF/);
  });

  it("wraps every data cell in double quotes per RFC 4180", () => {
    const getCapture = installBlobSpy();
    downloadCSV("parties", ["Name", "GSTIN"], [["Sharma Traders", "27AABCS1234A1Z5"]]);
    const { content } = getCapture();
    expect(content).toContain('"Sharma Traders"');
    expect(content).toContain('"27AABCS1234A1Z5"');
  });

  it("escapes double quotes inside cell values by doubling them (RFC 4180)", () => {
    // Cell value: say "hello"  →  CSV cell: "say ""hello"""
    const getCapture = installBlobSpy();
    downloadCSV("test", ["Note"], [[`say "hello"`]]);
    const { content } = getCapture();
    expect(content).toContain('say ""hello""');
  });

  it("includes the header row as the first line (no quotes on headers per implementation)", () => {
    const getCapture = installBlobSpy();
    downloadCSV(
      "parties",
      ["Party Name", "GSTIN", "State"],
      [["Sharma Traders", "27AABCS1234A1Z5", "Maharashtra"]]
    );
    const { content } = getCapture();
    const lines = content.replace("\uFEFF", "").split("\n");
    expect(lines[0]).toBe("Party Name,GSTIN,State");
  });

  it("handles numeric cell values by converting them to strings before wrapping", () => {
    const getCapture = installBlobSpy();
    downloadCSV("invoices", ["Invoice #", "Amount"], [["INV-0042", 75000]]);
    const { content } = getCapture();
    expect(content).toContain('"75000"');
  });

  it("handles an empty rows array — produces only the header line", () => {
    const getCapture = installBlobSpy();
    downloadCSV("empty-export", ["Name", "Amount"], []);
    const { content } = getCapture();
    const lines = content.replace("\uFEFF", "").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("Name,Amount");
  });

  it("sets the Blob MIME type to text/csv with utf-8 charset", () => {
    const getCapture = installBlobSpy();
    downloadCSV("mime-test", ["Col"], [["val"]]);
    const { type } = getCapture();
    expect(type).toMatch(/text\/csv/i);
    expect(type).toMatch(/utf-8/i);
  });
});
