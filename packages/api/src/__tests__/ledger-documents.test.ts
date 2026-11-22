/**
 * Pure tests for lib/ledger-documents.ts: how one document turns into journal
 * lines. No database. The expectations are hand-computed.
 */
import { describe, it, expect } from "vitest";
import { money } from "@hisaabo/shared";
import { DEFAULT_ACCOUNTS } from "../lib/coa-seed.js";
import {
  buildDocumentLines,
  classifyLedgerDocument,
  ledgerDocumentLabel,
  splitDocumentAdjustments,
  type CoaMap,
  type LedgerDocument,
} from "../lib/ledger-documents.js";

function seededCoa(opts: { without?: string[]; userCreated?: string[] } = {}) {
  const coa: CoaMap = new Map();
  const systemCodes = new Set<string>();
  for (const a of DEFAULT_ACCOUNTS) {
    if (opts.without?.includes(a.code)) continue;
    const user = opts.userCreated?.includes(a.code) ?? false;
    coa.set(a.code, { id: `id-${a.code}`, code: a.code, name: user ? `My ${a.name}` : a.name });
    if (!user) systemCodes.add(a.code);
  }
  return { coa, systemCodes };
}

/** Lines as [code, debit, credit], zero sides rendered as "0.00". */
function rows(lines: ReturnType<typeof buildDocumentLines>) {
  return (lines ?? []).map((l) => [l.accountCode, l.debit, l.credit]);
}

function balanced(lines: ReturnType<typeof buildDocumentLines>) {
  const dr = money.sum((lines ?? []).map((l) => l.debit));
  const cr = money.sum((lines ?? []).map((l) => l.credit));
  return { dr, cr };
}

const BASE = { subtotal: "1000.00", taxAmount: "180.00" } as const;

function doc(over: Partial<LedgerDocument> & { documentType: string; type: string }): LedgerDocument {
  return {
    subtotal: BASE.subtotal,
    taxAmount: BASE.taxAmount,
    totalAmount: "1180.00",
    discountAmount: "0.00",
    additionalCharges: "0.00",
    roundOff: "0.00",
    ...over,
  };
}

describe("classifyLedgerDocument", () => {
  it.each([
    ["invoice", "sale", { side: "sale", kind: "invoice" }],
    ["invoice", "purchase", { side: "purchase", kind: "invoice" }],
    ["credit_note", "sale", { side: "sale", kind: "reversal" }],
    ["sales_return", "sale", { side: "sale", kind: "reversal" }],
    // raised from a PURCHASE invoice (the apps copy its type): reverses the purchase
    ["credit_note", "purchase", { side: "purchase", kind: "reversal" }],
    ["sales_return", "purchase", { side: "purchase", kind: "reversal" }],
    ["debit_note", "sale", { side: "sale", kind: "addition" }],
    ["debit_note", "purchase", { side: "purchase", kind: "reversal" }],
    ["purchase_return", "purchase", { side: "purchase", kind: "reversal" }],
    ["purchase_return", "sale", { side: "sale", kind: "reversal" }],
  ])("%s on a %s document", (documentType, type, expected) => {
    expect(classifyLedgerDocument(documentType, type)).toEqual(expected);
  });

  it.each(["quotation", "proforma", "delivery_challan", "something_else"])("%s never posts", (documentType) => {
    expect(classifyLedgerDocument(documentType, "sale")).toBeNull();
    expect(classifyLedgerDocument(documentType, "purchase")).toBeNull();
  });

  it("labels narrations", () => {
    expect(ledgerDocumentLabel("invoice", "sale")).toBe("Sale Invoice");
    expect(ledgerDocumentLabel("invoice", "purchase")).toBe("Purchase Invoice");
    expect(ledgerDocumentLabel("credit_note", "sale")).toBe("Credit Note");
    expect(ledgerDocumentLabel("sales_return", "sale")).toBe("Sales Return");
    expect(ledgerDocumentLabel("debit_note", "purchase")).toBe("Debit Note");
    expect(ledgerDocumentLabel("purchase_return", "purchase")).toBe("Purchase Return");
  });
});

describe("splitDocumentAdjustments", () => {
  it("returns the stored columns when they explain total - subtotal - tax", () => {
    // 1000 + 180 - 50 + 25 - 0.55 = 1154.45
    expect(
      splitDocumentAdjustments({
        subtotal: "1000.00",
        taxAmount: "180.00",
        totalAmount: "1154.45",
        discountAmount: "50.00",
        additionalCharges: "25.00",
        roundOff: "-0.55",
      }),
    ).toEqual({ discount: "50.00", charges: "25.00", roundOff: "-0.55" });
  });

  it("is all zero for a plain document", () => {
    expect(splitDocumentAdjustments({ ...BASE, totalAmount: "1180.00" })).toEqual({
      discount: "0.00",
      charges: "0.00",
      roundOff: "0.00",
    });
  });

  it("puts the WHOLE difference in round-off when the columns do not explain the total", () => {
    // additional_charges 25.00 was stored but never reached the total (legacy input path).
    expect(
      splitDocumentAdjustments({
        ...BASE,
        totalAmount: "1180.00",
        additionalCharges: "25.00",
      }),
    ).toEqual({ discount: "0.00", charges: "0.00", roundOff: "0.00" });

    // an import whose total differs by 3.00 from what its columns say
    expect(
      splitDocumentAdjustments({
        ...BASE,
        totalAmount: "1183.00",
        discountAmount: "10.00",
      }),
    ).toEqual({ discount: "0.00", charges: "0.00", roundOff: "3.00" });
  });

  it("does not trust a negative discount or charge column", () => {
    expect(
      splitDocumentAdjustments({ ...BASE, totalAmount: "1170.00", discountAmount: "-10.00" }),
    ).toEqual({ discount: "0.00", charges: "0.00", roundOff: "-10.00" });
  });
});

describe("buildDocumentLines", () => {
  it("returns null for documents that never post", () => {
    const { coa, systemCodes } = seededCoa();
    expect(buildDocumentLines(doc({ documentType: "quotation", type: "sale" }), { coa, systemCodes, sameState: true })).toBeNull();
  });

  it("sale invoice, intra-state, no adjustments: the classic entry", () => {
    const { coa, systemCodes } = seededCoa();
    const lines = buildDocumentLines(doc({ documentType: "invoice", type: "sale" }), { coa, systemCodes, sameState: true });
    expect(rows(lines)).toEqual([
      ["1100", "1180.00", "0.00"],
      ["4000", "0.00", "1000.00"],
      ["2100", "0.00", "90.00"],
      ["2101", "0.00", "90.00"],
    ]);
  });

  it("sale invoice, inter-state: IGST in one piece", () => {
    const { coa, systemCodes } = seededCoa();
    const lines = buildDocumentLines(doc({ documentType: "invoice", type: "sale" }), { coa, systemCodes, sameState: false });
    expect(rows(lines)).toEqual([
      ["1100", "1180.00", "0.00"],
      ["4000", "0.00", "1000.00"],
      ["2102", "0.00", "180.00"],
    ]);
  });

  it("sale invoice with discount, charges and a negative round-off: 1000 + 180 - 50 + 25 - 0.55 = 1154.45", () => {
    const { coa, systemCodes } = seededCoa();
    const lines = buildDocumentLines(
      doc({
        documentType: "invoice",
        type: "sale",
        totalAmount: "1154.45",
        discountAmount: "50.00",
        additionalCharges: "25.00",
        roundOff: "-0.55",
      }),
      { coa, systemCodes, sameState: true },
    );
    expect(rows(lines)).toEqual([
      ["1100", "1154.45", "0.00"],
      ["4000", "0.00", "1000.00"],
      ["2100", "0.00", "90.00"],
      ["2101", "0.00", "90.00"],
      ["5020", "50.00", "0.00"], // Discount Allowed
      ["4020", "0.00", "25.00"], // Other Charges
      ["5030", "0.55", "0.00"], // Round Off, a cost
    ]);
    // Dr 1154.45 + 50.00 + 0.55 = 1205.00 ; Cr 1000 + 180 + 25 = 1205.00
    expect(balanced(lines)).toEqual({ dr: "1205.00", cr: "1205.00" });
  });

  it("credit note mirrors the sale: every adjustment flips side, sales go to 4010", () => {
    const { coa, systemCodes } = seededCoa();
    const lines = buildDocumentLines(
      doc({
        documentType: "credit_note",
        type: "sale",
        totalAmount: "1154.45",
        discountAmount: "50.00",
        additionalCharges: "25.00",
        roundOff: "-0.55",
      }),
      { coa, systemCodes, sameState: true },
    );
    expect(rows(lines)).toEqual([
      ["1100", "0.00", "1154.45"],
      ["4010", "1000.00", "0.00"],
      ["2100", "90.00", "0.00"],
      ["2101", "90.00", "0.00"],
      ["5020", "0.00", "50.00"],
      ["4020", "25.00", "0.00"],
      ["5030", "0.00", "0.55"],
    ]);
    expect(balanced(lines)).toEqual({ dr: "1205.00", cr: "1205.00" });
  });

  it("a credit note / sales return raised from a purchase invoice reverses the PURCHASE", () => {
    const { coa, systemCodes } = seededCoa();
    for (const documentType of ["credit_note", "sales_return"]) {
      const lines = buildDocumentLines(doc({ documentType, type: "purchase" }), { coa, systemCodes, sameState: true });
      expect(rows(lines)).toEqual([
        ["5010", "0.00", "1000.00"],
        ["1510", "0.00", "90.00"],
        ["1511", "0.00", "90.00"],
        ["2000", "1180.00", "0.00"],
      ]);
      expect(balanced(lines)).toEqual({ dr: "1180.00", cr: "1180.00" });
    }
  });

  it("sale-side debit note posts like a sale", () => {
    const { coa, systemCodes } = seededCoa();
    const lines = buildDocumentLines(doc({ documentType: "debit_note", type: "sale" }), { coa, systemCodes, sameState: true });
    expect(rows(lines)).toEqual([
      ["1100", "1180.00", "0.00"],
      ["4000", "0.00", "1000.00"],
      ["2100", "0.00", "90.00"],
      ["2101", "0.00", "90.00"],
    ]);
  });

  it("purchase invoice: discount is income (4200), charges a direct cost (5100), positive round-off a cost", () => {
    const { coa, systemCodes } = seededCoa();
    // 1000 + 180 - 50 + 25 + 0.45 = 1155.45
    const lines = buildDocumentLines(
      doc({
        documentType: "invoice",
        type: "purchase",
        totalAmount: "1155.45",
        discountAmount: "50.00",
        additionalCharges: "25.00",
        roundOff: "0.45",
      }),
      { coa, systemCodes, sameState: true },
    );
    expect(rows(lines)).toEqual([
      ["5000", "1000.00", "0.00"],
      ["1510", "90.00", "0.00"],
      ["1511", "90.00", "0.00"],
      ["2000", "0.00", "1155.45"],
      ["4200", "0.00", "50.00"],
      ["5100", "25.00", "0.00"],
      ["5030", "0.45", "0.00"],
    ]);
    // Dr 1000 + 180 + 25 + 0.45 = 1205.45 ; Cr 1155.45 + 50 = 1205.45
    expect(balanced(lines)).toEqual({ dr: "1205.45", cr: "1205.45" });
  });

  it("purchase return and purchase-side debit note mirror the purchase", () => {
    const { coa, systemCodes } = seededCoa();
    const input = {
      type: "purchase",
      totalAmount: "1155.45",
      discountAmount: "50.00",
      additionalCharges: "25.00",
      roundOff: "0.45",
    };
    const expected = [
      ["2000", "1155.45", "0.00"],
      ["5010", "0.00", "1000.00"],
      ["1510", "0.00", "90.00"],
      ["1511", "0.00", "90.00"],
      ["4200", "50.00", "0.00"],
      ["5100", "0.00", "25.00"],
      ["5030", "0.00", "0.45"],
    ];
    for (const documentType of ["purchase_return", "debit_note"]) {
      const lines = buildDocumentLines(doc({ documentType, ...input }), { coa, systemCodes, sameState: true });
      expect(rows(lines).sort()).toEqual([...expected].sort());
      expect(balanced(lines)).toEqual({ dr: "1205.45", cr: "1205.45" });
    }
  });

  it("splits odd GST paise as CGST = floor, SGST = remainder", () => {
    const { coa, systemCodes } = seededCoa();
    const lines = buildDocumentLines(
      doc({ documentType: "invoice", type: "sale", subtotal: "659.96", taxAmount: "102.59", totalAmount: "762.55" }),
      { coa, systemCodes, sameState: true },
    );
    expect(rows(lines)).toEqual([
      ["1100", "762.55", "0.00"],
      ["4000", "0.00", "659.96"],
      ["2100", "0.00", "51.29"],
      ["2101", "0.00", "51.30"],
    ]);
  });

  it("falls back to seeded accounts when the new system accounts are missing (not yet migrated)", () => {
    const { coa, systemCodes } = seededCoa({ without: ["5020", "4020", "5030"] });
    const lines = buildDocumentLines(
      doc({
        documentType: "invoice",
        type: "sale",
        totalAmount: "1154.45",
        discountAmount: "50.00",
        additionalCharges: "25.00",
        roundOff: "-0.55",
      }),
      { coa, systemCodes, sameState: true },
    );
    expect(rows(lines)).toEqual([
      ["1100", "1154.45", "0.00"],
      ["4000", "0.00", "1000.00"],
      ["2100", "0.00", "90.00"],
      ["2101", "0.00", "90.00"],
      ["5990", "50.00", "0.00"], // discount -> Miscellaneous Expenses
      ["4100", "0.00", "25.00"], // charges -> Other Income
      ["5990", "0.55", "0.00"], // round-off -> Miscellaneous Expenses
    ]);
    expect(balanced(lines)).toEqual({ dr: "1205.00", cr: "1205.00" });
  });

  it("never posts into a user-created account that happens to use a new system code", () => {
    const { coa, systemCodes } = seededCoa({ userCreated: ["5030"] });
    const lines = buildDocumentLines(
      doc({ documentType: "invoice", type: "sale", totalAmount: "1179.45", roundOff: "-0.55" }),
      { coa, systemCodes, sameState: true },
    );
    expect(lines?.some((l) => l.accountCode === "5030")).toBe(false);
    expect(lines?.some((l) => l.accountCode === "5990" && l.debit === "0.55")).toBe(true);
  });

  it("every document kind balances for every combination of adjustments", () => {
    const { coa, systemCodes } = seededCoa();
    const discounts = ["0.00", "50.00"];
    const charges = ["0.00", "25.00"];
    const roundOffs = ["0.00", "-0.55", "0.45"];
    const kinds: Array<[string, string]> = [
      ["invoice", "sale"],
      ["invoice", "purchase"],
      ["credit_note", "sale"],
      ["sales_return", "sale"],
      ["debit_note", "sale"],
      ["debit_note", "purchase"],
      ["purchase_return", "purchase"],
    ];
    for (const [documentType, type] of kinds) {
      for (const d of discounts) for (const c of charges) for (const r of roundOffs) {
        for (const sameState of [true, false]) {
          const total = money.add(money.sub(money.add("1180.00", money.add(c, r)), d), "0");
          const lines = buildDocumentLines(
            doc({ documentType, type, totalAmount: total, discountAmount: d, additionalCharges: c, roundOff: r }),
            { coa, systemCodes, sameState },
          );
          const { dr, cr } = balanced(lines);
          expect(dr, `${documentType}/${type} d=${d} c=${c} r=${r}`).toBe(cr);
        }
      }
    }
  });
});
