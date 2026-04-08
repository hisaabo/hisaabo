import { describe, it, expect } from "vitest";

describe("Tally XML export", () => {
  it("produces valid XML envelope structure", async () => {
    const { generateTallyXml } = await import("../lib/tally-xml-export.js");
    const xml = generateTallyXml([], [], { name: "Test Business" });
    expect(xml).toContain("<ENVELOPE>");
    expect(xml).toContain("<TALLYREQUEST>Import Data</TALLYREQUEST>");
    expect(xml).toContain("</ENVELOPE>");
  });

  it("creates ledger masters from Chart of Accounts", async () => {
    const { generateTallyXml } = await import("../lib/tally-xml-export.js");
    const accounts = [
      { code: "1000", name: "Cash in Hand", accountType: "asset" as const },
      { code: "4000", name: "Sales", accountType: "income" as const },
    ];
    const xml = generateTallyXml([], accounts, { name: "Test Business" });
    expect(xml).toContain('LEDGER NAME="Cash in Hand"');
    expect(xml).toContain('LEDGER NAME="Sales"');
    expect(xml).toContain("<PARENT>Current Assets</PARENT>");
    expect(xml).toContain("<PARENT>Sales Accounts</PARENT>");
  });

  it("creates sale voucher with correct amount signs", async () => {
    const { generateTallyXml } = await import("../lib/tally-xml-export.js");
    const entries = [{
      date: new Date("2025-08-15"),
      narration: "Sale Invoice INV-00001",
      sourceType: "invoice" as const,
      sourceId: "test-id",
      sourceNumber: "INV-00001",
      lines: [
        { accountId: "1", accountCode: "1100", accountName: "Accounts Receivable", debit: "11800.00", credit: "0.00" },
        { accountId: "2", accountCode: "4000", accountName: "Sales", debit: "0.00", credit: "10000.00" },
        { accountId: "3", accountCode: "2100", accountName: "Output CGST Payable", debit: "0.00", credit: "900.00" },
        { accountId: "4", accountCode: "2101", accountName: "Output SGST Payable", debit: "0.00", credit: "900.00" },
      ],
    }];
    const xml = generateTallyXml(entries, [], { name: "Test" });
    // Tally convention: debit = negative amount, credit = positive
    expect(xml).toContain("<AMOUNT>-11800.00</AMOUNT>"); // debit (receivable)
    expect(xml).toContain("<AMOUNT>10000.00</AMOUNT>"); // credit (sales)
    expect(xml).toContain('VCHTYPE="Sales"');
    expect(xml).toContain("<DATE>20250815</DATE>");
  });

  it("maps source types to Tally voucher types", async () => {
    const { generateTallyXml } = await import("../lib/tally-xml-export.js");
    // Payment entry
    const entries = [{
      date: new Date("2025-08-15"),
      narration: "Payment Received PAY-001",
      sourceType: "payment" as const,
      sourceId: "p1",
      sourceNumber: "PAY-001",
      lines: [
        { accountId: "1", accountCode: "1000", accountName: "Cash in Hand", debit: "5000.00", credit: "0.00" },
        { accountId: "2", accountCode: "1100", accountName: "Accounts Receivable", debit: "0.00", credit: "5000.00" },
      ],
    }];
    const xml = generateTallyXml(entries, [], { name: "Test" });
    expect(xml).toContain('VCHTYPE="Receipt"');
  });

  it("escapes XML special characters in names", async () => {
    const { generateTallyXml } = await import("../lib/tally-xml-export.js");
    const accounts = [
      { code: "5990", name: "R&D Expenses", accountType: "expense" as const },
    ];
    const xml = generateTallyXml([], accounts, { name: "Test & Co." });
    expect(xml).toContain("R&amp;D Expenses");
    expect(xml).not.toContain("R&D Expenses"); // must be escaped
  });

  it("maps expense source type to Payment voucher type", async () => {
    const { generateTallyXml } = await import("../lib/tally-xml-export.js");
    const entries = [{
      date: new Date("2025-08-15"),
      narration: "Rent — Office",
      sourceType: "expense" as const,
      sourceId: "e1",
      sourceNumber: "e1",
      lines: [
        { accountId: "1", accountCode: "5300", accountName: "Rent", debit: "10000.00", credit: "0.00" },
        { accountId: "2", accountCode: "1000", accountName: "Cash in Hand", debit: "0.00", credit: "10000.00" },
      ],
    }];
    const xml = generateTallyXml(entries, [], { name: "Test" });
    expect(xml).toContain('VCHTYPE="Payment"');
  });

  it("maps liability account type to Current Liabilities parent", async () => {
    const { generateTallyXml } = await import("../lib/tally-xml-export.js");
    const accounts = [
      { code: "2000", name: "Accounts Payable", accountType: "liability" as const },
    ];
    const xml = generateTallyXml([], accounts, { name: "Test" });
    expect(xml).toContain("<PARENT>Current Liabilities</PARENT>");
  });

  it("maps equity account type to Capital Account parent", async () => {
    const { generateTallyXml } = await import("../lib/tally-xml-export.js");
    const accounts = [
      { code: "3000", name: "Owner Capital", accountType: "equity" as const },
    ];
    const xml = generateTallyXml([], accounts, { name: "Test" });
    expect(xml).toContain("<PARENT>Capital Account</PARENT>");
  });

  it("sets ISDEEMEDPOSITIVE correctly for debit and credit lines", async () => {
    const { generateTallyXml } = await import("../lib/tally-xml-export.js");
    const entries = [{
      date: new Date("2025-08-15"),
      narration: "Sale Invoice INV-00002",
      sourceType: "invoice" as const,
      sourceId: "test-id-2",
      sourceNumber: "INV-00002",
      lines: [
        { accountId: "1", accountCode: "1100", accountName: "Accounts Receivable", debit: "5000.00", credit: "0.00" },
        { accountId: "2", accountCode: "4000", accountName: "Sales", debit: "0.00", credit: "5000.00" },
      ],
    }];
    const xml = generateTallyXml(entries, [], { name: "Test" });
    // The debit line should have ISDEEMEDPOSITIVE Yes, credit line No
    expect(xml).toContain("<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>"); // debit line
    expect(xml).toContain("<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>");  // credit line
  });

  it("formats date as YYYYMMDD", async () => {
    const { generateTallyXml } = await import("../lib/tally-xml-export.js");
    const entries = [{
      date: new Date("2025-01-05"),
      narration: "Test",
      sourceType: "journal" as const,
      sourceId: "j1",
      sourceNumber: "JE-00001",
      lines: [
        { accountId: "1", accountCode: "1000", accountName: "Cash", debit: "100.00", credit: "0.00" },
        { accountId: "2", accountCode: "4000", accountName: "Sales", debit: "0.00", credit: "100.00" },
      ],
    }];
    const xml = generateTallyXml(entries, [], { name: "Test" });
    expect(xml).toContain("<DATE>20250105</DATE>");
  });

  it("includes VOUCHERNUMBER and NARRATION in voucher", async () => {
    const { generateTallyXml } = await import("../lib/tally-xml-export.js");
    const entries = [{
      date: new Date("2025-08-15"),
      narration: "Sale Invoice INV-00003",
      sourceType: "invoice" as const,
      sourceId: "test-id-3",
      sourceNumber: "INV-00003",
      lines: [
        { accountId: "1", accountCode: "1100", accountName: "Accounts Receivable", debit: "5000.00", credit: "0.00" },
        { accountId: "2", accountCode: "4000", accountName: "Sales", debit: "0.00", credit: "5000.00" },
      ],
    }];
    const xml = generateTallyXml(entries, [], { name: "Test" });
    expect(xml).toContain("<VOUCHERNUMBER>INV-00003</VOUCHERNUMBER>");
    expect(xml).toContain("<NARRATION>Sale Invoice INV-00003</NARRATION>");
  });
});
