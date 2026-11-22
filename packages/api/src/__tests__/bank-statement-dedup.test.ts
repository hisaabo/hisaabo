/**
 * Pure unit tests for lib/bank-statement-dedup.ts (no database).
 * The end-to-end behaviour through bankRecon.confirmMapping is covered in
 * integration/bank-statement-dedup.test.ts.
 */

import { describe, it, expect } from "vitest";
import {
  dedupKey,
  dedupWindow,
  normalizeNarration,
  splitDuplicateLines,
  statementDay,
  type DedupLine,
} from "../lib/bank-statement-dedup.js";

const utcDay = (y: number, m: number, d: number, hour = 0, min = 0) =>
  new Date(Date.UTC(y, m - 1, d, hour, min));

function line(over: Partial<DedupLine> = {}): DedupLine {
  return {
    transactionDate: utcDay(2026, 4, 1),
    debit: "100.00",
    credit: "0.00",
    referenceNumber: "REF1",
    narration: "Some narration",
    ...over,
  };
}

describe("statementDay", () => {
  it("maps UTC midnight and server-local midnight of the same day to the same day number", () => {
    const utcMidnight = utcDay(2026, 4, 1);
    const istMidnight = utcDay(2026, 3, 31, 18, 30); // 00:00 on 1 Apr in UTC+5:30
    const estMidnight = utcDay(2026, 4, 1, 5, 0); //  00:00 on 1 Apr in UTC-5
    expect(statementDay(istMidnight)).toBe(statementDay(utcMidnight));
    expect(statementDay(estMidnight)).toBe(statementDay(utcMidnight));
  });

  it("keeps adjacent days apart", () => {
    expect(statementDay(utcDay(2026, 4, 2))).toBe(statementDay(utcDay(2026, 4, 1)) + 1);
    expect(statementDay(utcDay(2026, 4, 1, 18, 30))).not.toBe(statementDay(utcDay(2026, 3, 31, 18, 30)));
  });
});

describe("normalizeNarration", () => {
  it("lower-cases, collapses whitespace and trims", () => {
    expect(normalizeNarration("  POS   Purchase\tStarbucks ")).toBe("pos purchase starbucks");
    expect(normalizeNarration(null)).toBe("");
  });
});

describe("dedupKey", () => {
  it("treats numerically equal amounts as equal", () => {
    expect(dedupKey(line({ debit: "100" }))).toBe(dedupKey(line({ debit: "100.00" })));
    expect(dedupKey(line({ debit: "100.01" }))).not.toBe(dedupKey(line({ debit: "100.00" })));
  });

  it("treats null/empty amounts as zero", () => {
    expect(dedupKey(line({ credit: null }))).toBe(dedupKey(line({ credit: "" })));
    expect(dedupKey(line({ credit: null }))).toBe(dedupKey(line({ credit: "0.00" })));
  });

  it("uses the reference (case-insensitive) and ignores narration when a reference exists", () => {
    expect(dedupKey(line({ referenceNumber: " ref1 ", narration: "a" })))
      .toBe(dedupKey(line({ referenceNumber: "REF1", narration: "b" })));
    expect(dedupKey(line({ referenceNumber: "REF2" }))).not.toBe(dedupKey(line()));
  });

  it("falls back to normalized narration when the reference is empty", () => {
    const a = dedupKey(line({ referenceNumber: null, narration: "POS  Tea" }));
    expect(a).toBe(dedupKey(line({ referenceNumber: "", narration: "pos tea" })));
    expect(a).not.toBe(dedupKey(line({ referenceNumber: null, narration: "pos coffee" })));
  });

  it("does not equate a reference with an identical narration", () => {
    expect(dedupKey(line({ referenceNumber: "ABC", narration: "x" })))
      .not.toBe(dedupKey(line({ referenceNumber: null, narration: "abc" })));
  });
});

describe("splitDuplicateLines", () => {
  it("returns everything as fresh when nothing exists", () => {
    const incoming = [line(), line({ referenceNumber: "REF2" })];
    const { fresh, duplicates } = splitDuplicateLines(incoming, []);
    expect(fresh).toEqual(incoming);
    expect(duplicates).toEqual([]);
  });

  it("splits duplicates from fresh lines and preserves order", () => {
    const a = line({ referenceNumber: "A" });
    const b = line({ referenceNumber: "B" });
    const c = line({ referenceNumber: "C" });
    const { fresh, duplicates } = splitDuplicateLines([a, b, c], [line({ referenceNumber: "B" })]);
    expect(fresh).toEqual([a, c]);
    expect(duplicates.map((d) => d.line)).toEqual([b]);
  });

  it("pairs each duplicate with the existing line it matched (carrying the existing line's extra fields)", () => {
    type Existing = DedupLine & { importId: string };
    const existing: Existing[] = [
      { ...line({ referenceNumber: "A" }), importId: "imp-A" },
      { ...line({ referenceNumber: "B" }), importId: "imp-B" },
    ];
    const { duplicates } = splitDuplicateLines([line({ referenceNumber: "B" })], existing);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]!.existing.importId).toBe("imp-B");
  });

  it("hands out equal existing lines in the order given, one per incoming line", () => {
    type Existing = DedupLine & { importId: string };
    const swipe = (importId: string): Existing => ({
      ...line({ referenceNumber: null, narration: "Tea Stall" }),
      importId,
    });
    const incoming = [
      line({ referenceNumber: null, narration: "Tea Stall" }),
      line({ referenceNumber: null, narration: "Tea Stall" }),
      line({ referenceNumber: null, narration: "Tea Stall" }),
    ];
    const { duplicates, fresh } = splitDuplicateLines(incoming, [swipe("first"), swipe("second")]);
    expect(duplicates.map((d) => d.existing.importId)).toEqual(["first", "second"]);
    expect(fresh).toHaveLength(1);
  });

  it("consumes existing lines one-for-one (multiset)", () => {
    const swipe = () => line({ referenceNumber: null, narration: "Tea Stall" });
    const incoming = [swipe(), swipe(), swipe()];
    const { fresh, duplicates } = splitDuplicateLines(incoming, [swipe(), swipe()]);
    expect(duplicates).toHaveLength(2);
    expect(fresh).toHaveLength(1);
  });

  it("never compares incoming lines with each other", () => {
    const swipe = () => line({ referenceNumber: null, narration: "Tea Stall" });
    const { fresh, duplicates } = splitDuplicateLines([swipe(), swipe()], []);
    expect(fresh).toHaveLength(2);
    expect(duplicates).toHaveLength(0);
  });

  it("is date-sensitive", () => {
    const { fresh } = splitDuplicateLines(
      [line({ transactionDate: utcDay(2026, 4, 2) })],
      [line({ transactionDate: utcDay(2026, 4, 1) })],
    );
    expect(fresh).toHaveLength(1);
  });
});

describe("dedupWindow", () => {
  it("is null for no lines", () => {
    expect(dedupWindow([])).toBeNull();
  });

  it("spans the statement dates widened by one day each side", () => {
    const w = dedupWindow([
      line({ transactionDate: utcDay(2026, 4, 10) }),
      line({ transactionDate: utcDay(2026, 4, 3) }),
      line({ transactionDate: utcDay(2026, 4, 20) }),
    ])!;
    expect(w.from).toEqual(utcDay(2026, 4, 2));
    expect(w.to).toEqual(utcDay(2026, 4, 21));
  });
});
