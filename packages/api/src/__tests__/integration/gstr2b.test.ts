/**
 * gstr2b.test.ts — Integration tests for GSTR-2B reconciliation.
 *
 * WHY THIS FILE EXISTS:
 * GSTR-2B reconciliation is the primary way Indian SMBs verify their Input Tax
 * Credit before filing GSTR-3B. An incorrect match can result in:
 *   - Over-claimed ITC → government demand + interest + penalty.
 *   - Under-claimed ITC → cash flow loss.
 *
 * We test the full lifecycle:
 *   Parser:        JSON and CSV parsing producing correct GSTR2BRecord shapes.
 *   Reconciler:    Matched, mismatched, missing-in-books, missing-in-2B.
 *   Router upload: End-to-end upload → auto-reconcile → DB persistence.
 *   Router queries: records, summary, missingInBooks, missingIn2B.
 *   Router mutations: linkInvoice, ignoreRecord.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { gstr2bRecords, invoices } from "@hisaabo/db";
import {
  createTestWorld,
  createParty,
  createInvoiceWithItems,
  type TestWorld,
  type TestParty,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { seedChartOfAccounts } from "../../lib/coa-seed.js";
import {
  parseGSTR2BJSON,
  parseGSTR2BCSV,
  reconcileWithBooks,
  type PurchaseInvoice,
} from "../../lib/gstr2b-parser.js";

// ── Fixtures ──────────────────────────────────────────────────

let world: TestWorld;
let supplierParty: TestParty;

const TEST_YEAR  = 2026;
const TEST_MONTH = 4; // April 2026
const TEST_PERIOD = `${TEST_YEAR}-${String(TEST_MONTH).padStart(2, "0")}`;

function callerForRamesh() {
  return createTestCaller({
    userId:     world.ramesh.id,
    email:      world.ramesh.email,
    name:       world.ramesh.name ?? null,
    tenantId:   world.tenant1.id,
    businessId: world.business1.id,
  });
}

beforeAll(async () => {
  world = await createTestWorld();
  const db = getTenantTestDb();

  await seedChartOfAccounts(db, world.business1.id);

  supplierParty = await createParty(db, world.business1.id, {
    name: "Mumbai Supplies Pvt Ltd",
    type: "supplier",
    gstin: "27AABCM0000R1ZM",
    city: "Mumbai",
    state: "Maharashtra",
    stateCode: "27",
    openingBalance: "0.00",
  });
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ── Sample data helpers ────────────────────────────────────────

const SAMPLE_JSON = JSON.stringify({
  gstin: "27AABCU9603R1ZM",
  ret_period: "042026",
  docdata: {
    b2b: [
      {
        ctin: "27AABCM0000R1ZM",
        trdnm: "Mumbai Supplies Pvt Ltd",
        inv: [
          {
            inum: "INV-001",
            dt: "05-04-2026",
            val: 11800,
            pos: "27",
            itcavl: "Y",
            rev: "N",
            typ: "R",
            items: [
              { num: 1, rt: 18, txval: 10000, cgst: 900, sgst: 900, igst: 0, cess: 0 },
            ],
          },
          {
            inum: "INV-002",
            dt: "10-04-2026",
            val: 5900,
            pos: "27",
            itcavl: "Y",
            rev: "N",
            typ: "R",
            items: [
              { num: 1, rt: 18, txval: 5000, cgst: 450, sgst: 450, igst: 0, cess: 0 },
            ],
          },
        ],
      },
    ],
    cdnr: [
      {
        ctin: "27AABCM0000R1ZM",
        trdnm: "Mumbai Supplies Pvt Ltd",
        nt: [
          {
            ntnum: "CN-001",
            dt: "15-04-2026",
            val: 1180,
            typ: "C",
            itcavl: "Y",
            items: [
              { num: 1, rt: 18, txval: 1000, cgst: 90, sgst: 90, igst: 0, cess: 0 },
            ],
          },
        ],
      },
    ],
  },
});

const SAMPLE_CSV = `GSTIN,Trade Name,Invoice No,Invoice Date,Invoice Value,Taxable Value,CGST,SGST,IGST,Cess,ITC Available
27AABCM0000R1ZM,Mumbai Supplies Pvt Ltd,CSV-001,01-04-2026,11800,10000,900,900,0,0,Y
27AABCM0000R1ZM,Mumbai Supplies Pvt Ltd,CSV-002,12-04-2026,5900,5000,450,450,0,0,N
`;

// ── Parser tests ───────────────────────────────────────────────

describe("parseGSTR2BJSON", () => {
  it("parses B2B invoices from portal JSON", () => {
    const records = parseGSTR2BJSON(SAMPLE_JSON);

    // 2 B2B + 1 CDNR
    expect(records).toHaveLength(3);

    const inv1 = records.find((r) => r.invoiceNumber === "INV-001");
    expect(inv1).toBeDefined();
    expect(inv1!.supplierGstin).toBe("27AABCM0000R1ZM");
    expect(inv1!.supplierName).toBe("Mumbai Supplies Pvt Ltd");
    expect(inv1!.taxableValue).toBe("10000.00");
    expect(inv1!.cgst).toBe("900.00");
    expect(inv1!.sgst).toBe("900.00");
    expect(inv1!.igst).toBe("0.00");
    expect(inv1!.itcAvailable).toBe("Y");
    expect(inv1!.sourceType).toBe("B2B");
  });

  it("parses CDNR (credit note) records", () => {
    const records = parseGSTR2BJSON(SAMPLE_JSON);
    const cn = records.find((r) => r.invoiceNumber === "CN-001");

    expect(cn).toBeDefined();
    expect(cn!.sourceType).toBe("CDNR");
    expect(cn!.taxableValue).toBe("1000.00");
    expect(cn!.cgst).toBe("90.00");
  });

  it("rejects invalid JSON", () => {
    expect(() => parseGSTR2BJSON("not json at all")).toThrow("Invalid JSON");
  });
});

describe("parseGSTR2BCSV", () => {
  it("parses CSV with comma separator", () => {
    const records = parseGSTR2BCSV(SAMPLE_CSV);
    expect(records).toHaveLength(2);

    const first = records[0];
    expect(first!.supplierGstin).toBe("27AABCM0000R1ZM");
    expect(first!.invoiceNumber).toBe("CSV-001");
    expect(first!.taxableValue).toBe("10000.00");
    expect(first!.cgst).toBe("900.00");
    expect(first!.itcAvailable).toBe("Y");
  });

  it("parses ITC Not Available flag", () => {
    const records = parseGSTR2BCSV(SAMPLE_CSV);
    expect(records[1]!.itcAvailable).toBe("N");
  });

  it("rejects CSV with missing required columns", () => {
    const bad = "Name,Date\nFoo,01-04-2026\n";
    expect(() => parseGSTR2BCSV(bad)).toThrow("CSV missing required columns");
  });
});

// ── Reconciliation engine tests ───────────────────────────────

describe("reconcileWithBooks", () => {
  const makeInv = (overrides: Partial<PurchaseInvoice> = {}): PurchaseInvoice => ({
    id: "inv-1",
    invoiceNumber: "INV-001",
    invoiceDate: new Date("2026-04-05"),
    partyGstin: "27AABCM0000R1ZM",
    subtotal: "10000.00",
    cgst: "900.00",
    sgst: "900.00",
    igst: "0.00",
    cess: "0.00",
    ...overrides,
  });

  it("marks invoice as matched when amounts agree", () => {
    const records = parseGSTR2BJSON(SAMPLE_JSON).filter((r) => r.invoiceNumber === "INV-001");
    const { results } = reconcileWithBooks(records, [makeInv()]);

    const res = results[0]!;
    expect(res.matchStatus).toBe("matched");
    expect(res.matchedInvoiceId).toBe("inv-1");
    expect(res.mismatchReasons).toHaveLength(0);
  });

  it("marks invoice as mismatched when CGST differs", () => {
    const records = parseGSTR2BJSON(SAMPLE_JSON).filter((r) => r.invoiceNumber === "INV-001");
    const inv = makeInv({ cgst: "800.00" }); // should be 900
    const { results } = reconcileWithBooks(records, [inv]);

    const res = results[0]!;
    expect(res.matchStatus).toBe("mismatched");
    expect(res.mismatchReasons).toContain("cgst_difference");
  });

  it("marks record as missing_in_books when no matching invoice", () => {
    const records = parseGSTR2BJSON(SAMPLE_JSON).filter((r) => r.invoiceNumber === "INV-001");
    const { results } = reconcileWithBooks(records, []);

    expect(results[0]!.matchStatus).toBe("missing_in_books");
    expect(results[0]!.matchedInvoiceId).toBeNull();
  });

  it("identifies invoices missing from 2B", () => {
    const records = parseGSTR2BJSON(SAMPLE_JSON).filter((r) => r.invoiceNumber === "INV-001");
    const extraInv = makeInv({ id: "inv-extra", invoiceNumber: "INV-999" });
    const { results, missingIn2B } = reconcileWithBooks(records, [makeInv(), extraInv]);

    // INV-001 matched, INV-999 not in 2B
    expect(results.find((r) => r.matchStatus === "matched")).toBeDefined();
    expect(missingIn2B).toHaveLength(1);
    expect(missingIn2B[0]!.invoiceNumber).toBe("INV-999");
  });

  it("applies ±3 day tolerance for invoice date matching", () => {
    const records = parseGSTR2BJSON(SAMPLE_JSON).filter((r) => r.invoiceNumber === "INV-001");
    // Supplier reported 05-Apr, we have 07-Apr (2 days difference) — should still match
    const inv = makeInv({ invoiceDate: new Date("2026-04-07") });
    const { results } = reconcileWithBooks(records, [inv]);

    expect(results[0]!.matchStatus).toBe("matched");
  });
});

// ── Router integration tests ──────────────────────────────────

describe("gstr2b router — upload + auto-reconcile", () => {
  it("uploads JSON, reconciles, and stores records", async () => {
    const db = getTenantTestDb();

    // Create a matching purchase invoice in our books
    await createInvoiceWithItems(
      db,
      world.business1.id,
      supplierParty.id,
      [
        {
          itemId: world.item1.id,
          description: "Test Purchase",
          quantity: "1",
          unitPrice: "10000.00",
          taxPercent: "18.00",
        },
      ],
      {
        type: "purchase",
        documentType: "invoice",
        status: "sent",
        invoiceDate: new Date("2026-04-05"),
        invoiceNumber: "INV-001",
      },
    );

    const caller = callerForRamesh();
    const result = await caller.gstr2b.upload({
      returnPeriod: TEST_PERIOD,
      content: SAMPLE_JSON,
      fileName: "gstr2b_042026.json",
      format: "json",
    });

    expect(result.totalRecords).toBe(3); // 2 B2B + 1 CDNR
    expect(result.uploadId).toBeDefined();

    // Verify records persisted in DB
    const dbRecords = await db
      .select()
      .from(gstr2bRecords)
      .where(eq(gstr2bRecords.uploadId, result.uploadId));

    expect(dbRecords).toHaveLength(3);
    const inv1 = dbRecords.find((r) => r.invoiceNumber === "INV-001");
    expect(inv1).toBeDefined();
    // INV-001 should be matched or mismatched since we created the purchase invoice above
    expect(["matched", "mismatched"]).toContain(inv1!.matchStatus);
  });

  it("uploads CSV format successfully", async () => {
    const caller = callerForRamesh();
    const result = await caller.gstr2b.upload({
      returnPeriod: TEST_PERIOD,
      content: SAMPLE_CSV,
      fileName: "gstr2b_042026.csv",
      format: "csv",
    });

    expect(result.totalRecords).toBe(2);
    expect(result.uploadId).toBeDefined();
  });

  it("rejects invalid file content", async () => {
    const caller = callerForRamesh();
    await expect(
      caller.gstr2b.upload({
        returnPeriod: TEST_PERIOD,
        content: "this is not valid json or csv that makes sense",
        fileName: "bad.json",
        format: "json",
      }),
    ).rejects.toThrow();
  });
});

describe("gstr2b router — queries", () => {
  let uploadId: string;

  beforeAll(async () => {
    const caller = callerForRamesh();
    const result = await caller.gstr2b.upload({
      returnPeriod: TEST_PERIOD,
      content: SAMPLE_JSON,
      fileName: "query_test.json",
      format: "json",
    });
    uploadId = result.uploadId;
  });

  it("lists uploads for the business", async () => {
    const caller = callerForRamesh();
    const result = await caller.gstr2b.uploads({ page: 1, limit: 20 });

    expect(result.uploads.length).toBeGreaterThan(0);
    expect(result.uploads.every((u) => u.businessId === world.business1.id)).toBe(true);
  });

  it("returns paginated records for an upload", async () => {
    const caller = callerForRamesh();
    const result = await caller.gstr2b.records({ uploadId, page: 1, limit: 10 });

    expect(result.records.length).toBeGreaterThan(0);
    expect(result.total).toBeGreaterThan(0);
  });

  it("filters records by match status", async () => {
    const caller = callerForRamesh();
    // Request missing_in_books records
    const result = await caller.gstr2b.records({
      uploadId,
      matchStatus: "missing_in_books",
      page: 1,
      limit: 25,
    });

    // All returned records should have the filtered status
    for (const r of result.records) {
      expect(r.matchStatus).toBe("missing_in_books");
    }
  });

  it("returns summary for a return period", async () => {
    const caller = callerForRamesh();
    const summary = await caller.gstr2b.summary({ returnPeriod: TEST_PERIOD });

    expect(summary.hasData).toBe(true);
    expect(summary.totalRecords).toBeGreaterThan(0);
    expect(summary.itcAvailable).toBeDefined();
    expect(summary.itcAtRisk).toBeDefined();
  });

  it("returns summary with hasData=false for unknown period", async () => {
    const caller = callerForRamesh();
    const summary = await caller.gstr2b.summary({ returnPeriod: "2020-01" });
    expect(summary.hasData).toBe(false);
  });
});

describe("gstr2b router — mutations", () => {
  let uploadId: string;
  let recordId: string;

  beforeAll(async () => {
    const caller = callerForRamesh();
    const result = await caller.gstr2b.upload({
      returnPeriod: TEST_PERIOD,
      content: SAMPLE_JSON,
      fileName: "mutations_test.json",
      format: "json",
    });
    uploadId = result.uploadId;

    // Get a record to work with
    const db = getTenantTestDb();
    const rows = await db
      .select({ id: gstr2bRecords.id })
      .from(gstr2bRecords)
      .where(eq(gstr2bRecords.uploadId, uploadId))
      .limit(1);
    recordId = rows[0]!.id;
  });

  it("ignores a record", async () => {
    const caller = callerForRamesh();
    const result = await caller.gstr2b.ignoreRecord({ recordId });
    expect(result.success).toBe(true);

    // Verify in DB
    const db = getTenantTestDb();
    const [row] = await db
      .select({ matchStatus: gstr2bRecords.matchStatus })
      .from(gstr2bRecords)
      .where(eq(gstr2bRecords.id, recordId))
      .limit(1);
    expect(row!.matchStatus).toBe("ignored");
  });

  it("links a record to a purchase invoice", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // Find any purchase invoice
    const [inv] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.businessId, world.business1.id))
      .limit(1);

    if (!inv) {
      // Skip if no purchase invoices exist — create one first
      await createInvoiceWithItems(
        db,
        world.business1.id,
        supplierParty.id,
        [{ itemId: world.item1.id, description: "Link test", quantity: "1", unitPrice: "100.00", taxPercent: "18.00" }],
        { type: "purchase", documentType: "invoice", status: "sent", invoiceDate: new Date("2026-04-01") },
      );
    }

    // Get a different record (not the ignored one)
    const rows = await db
      .select({ id: gstr2bRecords.id })
      .from(gstr2bRecords)
      .where(eq(gstr2bRecords.uploadId, uploadId))
      .limit(5);

    const purchaseInvoices = await db
      .select({ id: invoices.id, type: invoices.type })
      .from(invoices)
      .where(eq(invoices.businessId, world.business1.id))
      .limit(10);

    const purchInv = purchaseInvoices.find((i) => i.type === "purchase");
    if (!purchInv) return; // Skip test if no purchase invoices

    const targetRecord = rows.find((r) => r.id !== recordId);
    if (!targetRecord) return;

    const result = await caller.gstr2b.linkInvoice({
      recordId: targetRecord.id,
      invoiceId: purchInv.id,
    });
    expect(result.success).toBe(true);
  });
});
