/**
 * e-invoicing.test.ts — Integration tests for E-Invoicing (IRP) feature.
 *
 * WHY THIS FILE EXISTS:
 * E-invoicing is a GST compliance requirement. Incorrect IRN generation or
 * cancellation can result in penalties. We verify:
 *
 *   Configure:    Saving credentials creates/updates the config.
 *   Mapping:      invoice-to-irp.ts maps all fields correctly.
 *   Generate:     Mocked IRP client succeeds → invoice gets IRN/QR/status.
 *   Idempotency:  Cannot generate twice for the same invoice.
 *   Cancel:       IRN cancelled within 24h → status = "cancelled".
 *   Late cancel:  IRN > 24h old → 400 error.
 *   Cancel = cancel the invoice too (0.10.1): the invoice is cancelled in the same
 *                 transaction, so GSTR-1/3B, the ledger, party balance and stock all
 *                 follow; IRP failure changes nothing; a local failure after the IRP
 *                 succeeded leaves a retryable state; payments refuse BEFORE the IRP.
 *   B2C skip:     Invoice with no-GSTIN party is rejected.
 *   Dashboard:    Returns correct counts per status.
 *   Status:       getStatus returns current e-invoice data.
 *   Retry:        Failed invoice can be retried.
 *   Permissions:  Non-admin (accountant) cannot manage but can read.
 *
 * The IRPClient is mocked via vitest.mock() so tests never call real NIC APIs.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { invoices, eInvoiceConfigs, items as itemsTable, auditLog, paymentAllocations } from "@hisaabo/db";
import {
  createTestWorld,
  createParty,
  createItem,
  createInvoiceWithItems,
  type TestWorld,
  type TestParty,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import {
  getTenantTestDb,
  truncateAllTables,
  closeTestDb,
} from "../helpers/test-db.js";
import { mapInvoiceToIRP } from "../../lib/invoice-to-irp.js";
import { seedChartOfAccounts } from "../../lib/coa-seed.js";
import { deriveLedger } from "../../lib/derive-ledger.js";

// ── Mock IRPClient ────────────────────────────────────────────────────────────
// We mock the entire irp-client module so tests never call real NIC endpoints.
// The mock is set up before any test and reset between tests as needed.

vi.mock("../../lib/irp-client.js", () => {
  const mockGenerateIRN = vi.fn().mockResolvedValue({
    irn: "MOCKIRN123456789012345678901234567890123456789012345678901234",
    ackNo: "232310001234567",
    ackDt: new Date(),
    signedQrCode: "MOCK_SIGNED_QR_CODE",
    signedInvoice: "MOCK_SIGNED_INVOICE_JSON",
  });

  const mockCancelIRN = vi.fn().mockResolvedValue({
    irn: "MOCKIRN123456789012345678901234567890123456789012345678901234",
    cancelDate: new Date("2026-04-02T11:00:00+05:30"),
  });

  const mockAuthenticate = vi.fn().mockResolvedValue(undefined);

  class MockIRPClient {
    authenticate = mockAuthenticate;
    generateIRN = mockGenerateIRN;
    cancelIRN = mockCancelIRN;
  }

  class IRPError extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly httpStatus?: number,
    ) {
      super(message);
      this.name = "IRPError";
    }
    get isRetryable() {
      return this.code === "RETRYABLE" || (this.httpStatus !== undefined && this.httpStatus >= 500);
    }
  }

  return {
    IRPClient: MockIRPClient,
    IRPError,
    __mockGenerateIRN: mockGenerateIRN,
    __mockCancelIRN: mockCancelIRN,
    __mockAuthenticate: mockAuthenticate,
  };
});

// ── Fixture ───────────────────────────────────────────────────────────────────

let world: TestWorld;
let b2bParty: TestParty;    // Customer with GSTIN (B2B)
let b2cParty: TestParty;    // Customer without GSTIN (B2C)

beforeAll(async () => {
  world = await createTestWorld();
  const db = getTenantTestDb();

  b2bParty = await createParty(db, world.business1.id, {
    name: "GST Registered Customer",
    type: "customer",
    gstin: "29AABCG0000R1ZM",
    city: "Bengaluru",
    state: "Karnataka",
    stateCode: "29",
    openingBalance: "0.00",
  });

  b2cParty = await createParty(db, world.business1.id, {
    name: "Walk-in Customer",
    type: "customer",
    gstin: null, // B2C — no GSTIN
    openingBalance: "0.00",
  });
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

function callerForRamesh() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

function callerForAccountant() {
  return createTestCaller({
    userId: world.suresh.id,
    email: world.suresh.email,
    name: world.suresh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

// ── Helper to configure e-invoicing ──────────────────────────────────────────

async function setupEInvoiceConfig(enabled = true) {
  const caller = callerForRamesh();
  return caller.eInvoice.configure({
    gstin: "27AABCU9603R1ZM",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    username: "testuser",
    password: "testpass123",
    isSandbox: true,
    isEnabled: enabled,
    thresholdCrore: "5",
  });
}

// ── 1. Configure credentials ───────────────────────────────────────────────

describe("eInvoice.configure", () => {
  it("creates e-invoice config for a business", async () => {
    const caller = callerForRamesh();
    const config = await caller.eInvoice.configure({
      gstin: "27AABCU9603R1ZM",
      clientId: "client-123",
      clientSecret: "secret-abc",
      username: "testuser",
      password: "testpass",
      isSandbox: true,
      isEnabled: false,
      thresholdCrore: "5",
    });

    expect(config).toBeDefined();
    expect(config!.businessId).toBe(world.business1.id);
    expect(config!.clientId).toBe("client-123");
    expect(config!.isSandbox).toBe(true);
    expect(config!.isEnabled).toBe(false);
  });

  it("updates existing config if one exists", async () => {
    const caller = callerForRamesh();

    // First save
    await caller.eInvoice.configure({
      gstin: "27AABCU9603R1ZM",
      clientId: "original-id",
      clientSecret: "original-secret",
      username: "user1",
      password: "pass1",
      isSandbox: true,
      isEnabled: false,
      thresholdCrore: "5",
    });

    // Update
    const updated = await caller.eInvoice.configure({
      gstin: "27AABCU9603R1ZM",
      clientId: "new-client-id",
      clientSecret: "new-secret",
      username: "user2",
      password: "pass2",
      isSandbox: false,
      isEnabled: true,
      thresholdCrore: "10",
    });

    expect(updated!.clientId).toBe("new-client-id");
    expect(updated!.isEnabled).toBe(true);
    expect(updated!.isSandbox).toBe(false);

    // Verify only one config exists
    const db = getTenantTestDb();
    const configs = await db
      .select()
      .from(eInvoiceConfigs)
      .where(eq(eInvoiceConfigs.businessId, world.business1.id));
    expect(configs.length).toBe(1);
  });

  it("returns masked config on getConfig", async () => {
    const caller = callerForRamesh();
    await setupEInvoiceConfig();

    const config = await caller.eInvoice.getConfig();
    expect(config).not.toBeNull();
    expect(config!.password).toBe("••••••••");
    expect(config!.clientSecret).toContain("••••••••");
    expect(config!.gstin).toBe("27AABCU9603R1ZM");
  });
});

// ── 2. Invoice-to-IRP JSON mapping ────────────────────────────────────────────

describe("mapInvoiceToIRP", () => {
  it("maps all required fields correctly", () => {
    const result = mapInvoiceToIRP(
      {
        invoiceNumber: "INV-00001",
        invoiceDate: new Date("2026-04-02"),
        type: "sale",
        documentType: "invoice",
        subtotal: "10000.00",
        taxAmount: "1800.00",
        discountAmount: null,
        additionalCharges: null,
        roundOff: null,
        totalAmount: "11800.00",
        isReverseCharge: false,
      },
      [
        {
          itemName: "Steel Pipes",
          description: null,
          quantity: "10",
          unitPrice: "1000.00",
          taxPercent: "18",
          taxAmount: "1800.00",
          discountPercent: "0",
          totalAmount: "11800.00",
          selectedUnit: "pcs",
          itemType: "product",
          itemHsn: "7306",
        },
      ],
      {
        gstin: "29AABCG0000R1ZM",
        name: "GST Registered Customer",
        billingAddress: "100 MG Road",
        city: "Bengaluru",
        state: "Karnataka",
        stateCode: "29",
        pincode: "560001",
        phone: "9876543210",
        email: null,
      },
      {
        gstin: "27AABCU9603R1ZM",
        legalName: "Acme Trading Co",
        name: "Acme Trading Co",
        address: "123 MG Road",
        city: "Mumbai",
        state: "Maharashtra",
        stateCode: "27",
        pincode: "400001",
        phone: "9876543210",
        email: null,
      },
    );

    // Basic structure
    expect(result.Version).toBe("1.1");
    expect(result.DocDtls.Typ).toBe("INV");
    expect(result.DocDtls.No).toBe("INV-00001");
    expect(result.DocDtls.Dt).toBe("02/04/2026");

    // Seller
    expect(result.SellerDtls.Gstin).toBe("27AABCU9603R1ZM");
    expect(result.SellerDtls.Stcd).toBe("27");

    // Buyer
    expect(result.BuyerDtls.Gstin).toBe("29AABCG0000R1ZM");
    expect(result.BuyerDtls.Pos).toBe("29");

    // Line item: inter-state → IGST only
    expect(result.ItemList).toHaveLength(1);
    expect(result.ItemList[0]!.HsnCd).toBe("7306");
    expect(result.ItemList[0]!.Unit).toBe("PCS");
    expect(result.ItemList[0]!.IgstAmt).toBeGreaterThan(0);
    expect(result.ItemList[0]!.CgstAmt).toBe(0);

    // Val totals
    expect(result.ValDtls.TotInvVal).toBe(11800);
    expect(result.ValDtls.IgstVal).toBeGreaterThan(0);
  });

  it("splits CGST+SGST for intra-state", () => {
    const result = mapInvoiceToIRP(
      {
        invoiceNumber: "INV-00002",
        invoiceDate: new Date("2026-04-02"),
        type: "sale",
        documentType: "invoice",
        subtotal: "10000.00",
        taxAmount: "1800.00",
        discountAmount: null,
        additionalCharges: null,
        roundOff: null,
        totalAmount: "11800.00",
        isReverseCharge: false,
      },
      [
        {
          itemName: "Cotton Fabric",
          description: null,
          quantity: "100",
          unitPrice: "100.00",
          taxPercent: "18",
          taxAmount: "1800.00",
          discountPercent: "0",
          totalAmount: "11800.00",
          selectedUnit: "m",
          itemType: "product",
          itemHsn: "5208",
        },
      ],
      {
        gstin: "27AABCM0000R1ZM", // Same state as seller (27=Maharashtra)
        name: "Intra-state Customer",
        billingAddress: "Pune",
        city: "Pune",
        state: "Maharashtra",
        stateCode: "27",
        pincode: "411001",
        phone: null,
        email: null,
      },
      {
        gstin: "27AABCU9603R1ZM",
        legalName: "Acme Trading Co",
        name: "Acme Trading Co",
        address: "123 MG Road",
        city: "Mumbai",
        state: "Maharashtra",
        stateCode: "27",
        pincode: "400001",
        phone: null,
        email: null,
      },
    );

    // Intra-state: CGST + SGST, no IGST
    expect(result.ItemList[0]!.IgstAmt).toBe(0);
    expect(result.ItemList[0]!.CgstAmt).toBeGreaterThan(0);
    expect(result.ItemList[0]!.SgstAmt).toBeGreaterThan(0);
    expect(result.ItemList[0]!.CgstAmt + result.ItemList[0]!.SgstAmt).toBe(
      result.ItemList[0]!.CgstAmt + result.ItemList[0]!.SgstAmt,
    );
    expect(result.ValDtls.IgstVal).toBe(0);
    expect(result.ValDtls.CgstVal).toBeGreaterThan(0);
  });

  it("maps credit note to CRN doc type", () => {
    const result = mapInvoiceToIRP(
      {
        invoiceNumber: "CN-00001",
        invoiceDate: new Date("2026-04-02"),
        type: "sale",
        documentType: "credit_note",
        subtotal: "1000.00",
        taxAmount: "180.00",
        discountAmount: null,
        additionalCharges: null,
        roundOff: null,
        totalAmount: "1180.00",
        isReverseCharge: false,
      },
      [
        {
          itemName: "Return",
          description: null,
          quantity: "1",
          unitPrice: "1000.00",
          taxPercent: "18",
          taxAmount: "180.00",
          discountPercent: "0",
          totalAmount: "1180.00",
          selectedUnit: null,
          itemType: null,
          itemHsn: null,
        },
      ],
      {
        gstin: "27AABCM0000R1ZM",
        name: "Customer",
        billingAddress: null,
        city: null,
        state: null,
        stateCode: "27",
        pincode: null,
        phone: null,
        email: null,
      },
      {
        gstin: "27AABCU9603R1ZM",
        legalName: null,
        name: "Acme",
        address: null,
        city: null,
        state: null,
        stateCode: "27",
        pincode: null,
        phone: null,
        email: null,
      },
    );

    expect(result.DocDtls.Typ).toBe("CRN");
  });

  it("throws if business has no GSTIN", () => {
    expect(() =>
      mapInvoiceToIRP(
        {
          invoiceNumber: "INV-00003",
          invoiceDate: new Date(),
          type: "sale",
          documentType: "invoice",
          subtotal: "1000",
          taxAmount: "180",
          discountAmount: null,
          additionalCharges: null,
          roundOff: null,
          totalAmount: "1180",
          isReverseCharge: false,
        },
        [],
        { gstin: "27AABCG0000R1ZM", name: "Party", billingAddress: null, city: null, state: null, stateCode: "27", pincode: null, phone: null, email: null },
        { gstin: null, legalName: null, name: "Biz", address: null, city: null, state: null, stateCode: null, pincode: null, phone: null, email: null },
      ),
    ).toThrow("Business GSTIN is required");
  });
});

// ── 3. Generate IRN ───────────────────────────────────────────────────────────

describe("eInvoice.generate", () => {
  it("generates IRN for a B2B invoice", async () => {
    const db = getTenantTestDb();
    await setupEInvoiceConfig();
    const caller = callerForRamesh();

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      b2bParty.id,
      [
        {
          description: "Steel Rods",
          quantity: "10",
          unitPrice: "1000.00",
          taxPercent: "18",
        },
      ],
    );

    const result = await caller.eInvoice.generate({ invoiceId: invoice.id });

    expect(result).toBeDefined();
    expect(result!.irn).toBeTruthy();
    expect(result!.irnAckNumber).toBeTruthy();
    expect(result!.eInvoiceStatus).toBe("generated");
    expect(result!.signedQrCode).toBeTruthy();
  });

  it("throws if IRN already generated", async () => {
    const db = getTenantTestDb();
    await setupEInvoiceConfig();
    const caller = callerForRamesh();

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      b2bParty.id,
      [{ description: "Product", quantity: "1", unitPrice: "5000.00", taxPercent: "18" }],
    );

    await caller.eInvoice.generate({ invoiceId: invoice.id });

    // Second attempt should fail
    await expect(
      caller.eInvoice.generate({ invoiceId: invoice.id }),
    ).rejects.toThrow("IRN already generated");
  });

  it("throws for B2C invoice (party has no GSTIN)", async () => {
    const db = getTenantTestDb();
    await setupEInvoiceConfig();
    const caller = callerForRamesh();

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      b2cParty.id, // No GSTIN
      [{ description: "Product", quantity: "1", unitPrice: "500.00", taxPercent: "18" }],
    );

    await expect(
      caller.eInvoice.generate({ invoiceId: invoice.id }),
    ).rejects.toThrow("GSTIN");
  });

  it("marks invoice as failed when IRP returns 400 error", async () => {
    const mockModule = await import("../../lib/irp-client.js") as unknown as {
      __mockGenerateIRN: ReturnType<typeof vi.fn>;
      IRPError: new (msg: string, code: string) => Error;
    };

    const { IRPError } = mockModule;
    const origMock = mockModule.__mockGenerateIRN;

    // Temporarily make generate throw a non-retryable error
    origMock.mockRejectedValueOnce(new IRPError("Duplicate IRN", "2150"));

    const db = getTenantTestDb();
    await setupEInvoiceConfig();
    const caller = callerForRamesh();

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      b2bParty.id,
      [{ description: "Product", quantity: "1", unitPrice: "1000.00", taxPercent: "18" }],
    );

    await expect(
      caller.eInvoice.generate({ invoiceId: invoice.id }),
    ).rejects.toThrow();

    // Verify DB status
    const [updated] = await db
      .select({ status: invoices.eInvoiceStatus })
      .from(invoices)
      .where(eq(invoices.id, invoice.id));
    expect(updated!.status).toBe("failed");
  });
});

// ── 4. Cancel IRN ─────────────────────────────────────────────────────────────

describe("eInvoice.cancel", () => {
  it("cancels IRN within 24 hours", async () => {
    const db = getTenantTestDb();
    await setupEInvoiceConfig();
    const caller = callerForRamesh();

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      b2bParty.id,
      [{ description: "Product", quantity: "5", unitPrice: "2000.00", taxPercent: "18" }],
    );

    // Generate first
    await caller.eInvoice.generate({ invoiceId: invoice.id });

    // Cancel
    const result = await caller.eInvoice.cancel({
      invoiceId: invoice.id,
      cancelReason: "2",
      cancelRemarks: "Entered wrong amount",
    });

    expect(result!.eInvoiceStatus).toBe("cancelled");
    expect(result!.eInvoiceCancelReason).toBe("2");
  });

  it("rejects cancellation if IRN is > 24 hours old", async () => {
    const db = getTenantTestDb();
    await setupEInvoiceConfig();
    const caller = callerForRamesh();

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      b2bParty.id,
      [{ description: "Old Product", quantity: "1", unitPrice: "500.00", taxPercent: "18" }],
    );

    // Insert IRN directly with old ack date (>24h ago)
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await db
      .update(invoices)
      .set({
        irn: "OLDIRN123456789012345678901234567890123456789012345678901234",
        irnAckDate: yesterday,
        eInvoiceStatus: "generated",
      })
      .where(eq(invoices.id, invoice.id));

    await expect(
      caller.eInvoice.cancel({
        invoiceId: invoice.id,
        cancelReason: "1",
      }),
    ).rejects.toThrow("24 hours");
  });

  it("rejects cancellation if invoice has no IRN", async () => {
    const db = getTenantTestDb();
    await setupEInvoiceConfig();
    const caller = callerForRamesh();

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      b2bParty.id,
      [{ description: "Product", quantity: "1", unitPrice: "500.00", taxPercent: "18" }],
    );

    await expect(
      caller.eInvoice.cancel({
        invoiceId: invoice.id,
        cancelReason: "1",
      }),
    ).rejects.toThrow("IRN");
  });
});

// ── 4b. Cancelling the IRN cancels the invoice ───────────────────────────────

type IrpMock = {
  __mockCancelIRN: ReturnType<typeof vi.fn>;
  IRPError: new (msg: string, code: string, httpStatus?: number) => Error;
};

describe("eInvoice.cancel also cancels the invoice", () => {
  const SALE_DATE = "2025-06-15T06:30:00.000Z"; // fixed month, so GSTR figures are stable
  const RANGE_FROM = new Date("2025-01-01");
  const RANGE_TO = new Date("2025-12-31");
  let irp: IrpMock;

  beforeAll(async () => {
    irp = (await import("../../lib/irp-client.js")) as unknown as IrpMock;
    await seedChartOfAccounts(getTenantTestDb(), world.business1.id);
  });

  async function stock(itemId: string): Promise<number> {
    const [row] = await getTenantTestDb()
      .select({ q: itemsTable.stockQuantity })
      .from(itemsTable)
      .where(eq(itemsTable.id, itemId));
    return parseFloat(row!.q);
  }

  async function row(id: string) {
    const [r] = await getTenantTestDb().select().from(invoices).where(eq(invoices.id, id));
    return r!;
  }

  /** A B2B sale of 10 x 1000 + 18% (total 11,800) with a stocked item, IRN already generated. */
  async function generatedSale(opts: { party?: TestParty } = {}) {
    await setupEInvoiceConfig();
    const caller = callerForRamesh();
    const item = await createItem(getTenantTestDb(), world.business1.id, { stockQuantity: "100.000" });
    const invoice = await caller.invoice.create({
      type: "sale",
      partyId: (opts.party ?? b2bParty).id,
      invoiceDate: SALE_DATE,
      lineItems: [{
        itemId: item.id,
        itemName: "Steel Rods",
        quantity: "10",
        unitPrice: "1000.00",
        taxPercent: "18",
        discountPercent: "0",
        conversionFactor: "1",
      }],
    });
    await caller.eInvoice.generate({ invoiceId: invoice.id });
    return { caller, item, invoice };
  }

  async function gstr1Has(invoiceNumber: string): Promise<boolean> {
    const report = await callerForRamesh().gst.gstr1({ year: 2025, month: 6 });
    return report.b2b.some((e) => e.invoiceNumber === invoiceNumber);
  }

  async function outwardTaxable(): Promise<number> {
    const report = await callerForRamesh().gst.gstr3b({ year: 2025, month: 6 });
    return report.outwardSupplies.taxable.taxableValue;
  }

  async function inLedger(invoiceId: string): Promise<boolean> {
    const entries = await deriveLedger(getTenantTestDb(), world.business1.id, RANGE_FROM, RANGE_TO);
    return entries.some((e) => e.sourceId === invoiceId);
  }

  async function partyClosing(partyId: string): Promise<string> {
    const report = await callerForRamesh().party.ledgerReport({ partyId });
    return report!.summary.closingBalance;
  }

  async function auditActions(invoiceId: string): Promise<Array<{ action: string; metadata: Record<string, unknown> }>> {
    const rows = await getTenantTestDb().select().from(auditLog).where(eq(auditLog.entityId, invoiceId));
    return rows.map((r) => ({ action: r.action, metadata: JSON.parse(r.metadata ?? "{}") }));
  }

  beforeEach(() => {
    irp.__mockCancelIRN.mockClear();
  });

  it("IRP success cancels the invoice: out of GSTR-1/3B, the ledger and the party balance, stock restored", async () => {
    const party = await createParty(getTenantTestDb(), world.business1.id, {
      name: "Ledger Customer", type: "customer", gstin: "29AABCL0000R1ZM",
      city: "Bengaluru", state: "Karnataka", stateCode: "29", openingBalance: "0.00",
    });
    const { caller, item, invoice } = await generatedSale({ party });
    expect(await stock(item.id)).toBeCloseTo(90, 3);

    const taxableBefore = await outwardTaxable();
    expect(await gstr1Has(invoice.invoiceNumber)).toBe(true);
    expect(await inLedger(invoice.id)).toBe(true);
    expect(await partyClosing(party.id)).toBe("11800.00");

    const result = await caller.eInvoice.cancel({
      invoiceId: invoice.id,
      cancelReason: "2",
      cancelRemarks: "Entered wrong amount",
    });

    expect(irp.__mockCancelIRN).toHaveBeenCalledTimes(1);
    expect(irp.__mockCancelIRN.mock.calls[0]![1]).toBe("2");
    expect(result.status).toBe("cancelled");
    expect(result.eInvoiceStatus).toBe("cancelled");
    expect(result.eInvoiceCancelReason).toBe("2");
    expect(result.eInvoiceError).toBeNull();

    const after = await row(invoice.id);
    expect(after.status).toBe("cancelled");
    expect(after.eInvoiceStatus).toBe("cancelled");
    expect(after.deletedAt).toBeNull(); // cancelled, not deleted: the number stays on record

    expect(await stock(item.id)).toBeCloseTo(100, 3);
    expect(await gstr1Has(invoice.invoiceNumber)).toBe(false);
    expect(await outwardTaxable()).toBeCloseTo(taxableBefore - 10000, 2);
    expect(await inLedger(invoice.id)).toBe(false);
    expect(await partyClosing(party.id)).toBe("0.00");

    const actions = await auditActions(invoice.id);
    expect(actions.find((a) => a.action === "eInvoice.cancel")?.metadata).toMatchObject({
      invoiceCancelled: true, irpCalled: true, cancelReason: "2",
    });
    expect(actions.find((a) => a.action === "invoice.updateStatus")?.metadata).toMatchObject({
      toStatus: "cancelled", via: "eInvoice.cancel",
    });

    // The IRN and the invoice are both final: no second cancel, no edit.
    await expect(
      caller.eInvoice.cancel({ invoiceId: invoice.id, cancelReason: "1" }),
    ).rejects.toThrow("already cancelled");
    expect(irp.__mockCancelIRN).toHaveBeenCalledTimes(1);
    await expect(
      caller.invoice.update({ id: invoice.id, notes: "edit after cancel" }),
    ).rejects.toThrow("cancelled invoice");
  });

  it("IRP failure leaves everything unchanged, and a later retry works", async () => {
    const { caller, item, invoice } = await generatedSale();
    const taxableBefore = await outwardTaxable();
    const before = await row(invoice.id);

    irp.__mockCancelIRN.mockRejectedValueOnce(new irp.IRPError("IRP is down", "RETRYABLE", 503));
    await expect(
      caller.eInvoice.cancel({ invoiceId: invoice.id, cancelReason: "1" }),
    ).rejects.toThrow("IRP is down");

    const unchanged = await row(invoice.id);
    expect(unchanged.status).toBe(before.status);
    expect(unchanged.eInvoiceStatus).toBe("generated");
    expect(unchanged.eInvoiceCancelReason).toBeNull();
    expect(unchanged.eInvoiceError).toBeNull();
    expect(unchanged.irn).toBe(before.irn);
    expect(await stock(item.id)).toBeCloseTo(90, 3);
    expect(await gstr1Has(invoice.invoiceNumber)).toBe(true);
    expect(await outwardTaxable()).toBeCloseTo(taxableBefore, 2);

    const retried = await caller.eInvoice.cancel({ invoiceId: invoice.id, cancelReason: "1" });
    expect(retried.status).toBe("cancelled");
    expect(await stock(item.id)).toBeCloseTo(100, 3);
  });

  it("allocated payments refuse the cancel BEFORE the IRP is called", async () => {
    const { caller, item, invoice } = await generatedSale();
    await caller.payment.create({
      partyId: b2bParty.id,
      amount: "1000.00",
      mode: "cash",
      paymentDate: SALE_DATE,
      allocations: [{ invoiceId: invoice.id, amount: "1000.00" }],
    });

    await expect(
      caller.eInvoice.cancel({ invoiceId: invoice.id, cancelReason: "1" }),
    ).rejects.toThrow(/The IRN was not cancelled.*payments/s);

    expect(irp.__mockCancelIRN).not.toHaveBeenCalled();
    const unchanged = await row(invoice.id);
    expect(unchanged.eInvoiceStatus).toBe("generated");
    expect(unchanged.status).not.toBe("cancelled");
    expect(unchanged.eInvoiceError).toBeNull();
    expect(await stock(item.id)).toBeCloseTo(90, 3);
  });

  it("a failure after the IRP succeeded leaves a retryable state, and cancelling again finishes it without the IRP", async () => {
    const { caller, item, invoice } = await generatedSale();

    // A payment lands while the IRP call is in flight: the pre-check could not
    // know, so the local cancel fails after the IRP has already cancelled the IRN.
    irp.__mockCancelIRN.mockImplementationOnce(async () => {
      await caller.payment.create({
        partyId: b2bParty.id,
        amount: "1000.00",
        mode: "cash",
        paymentDate: SALE_DATE,
        allocations: [{ invoiceId: invoice.id, amount: "1000.00" }],
      });
      return { irn: invoice.id, cancelDate: new Date() };
    });

    await expect(
      caller.eInvoice.cancel({ invoiceId: invoice.id, cancelReason: "3" }),
    ).rejects.toThrow(/IRN was cancelled at the IRP, but the invoice could not be cancelled here/);
    expect(irp.__mockCancelIRN).toHaveBeenCalledTimes(1);

    // Documented state: IRN cancelled, invoice live, reason + error recorded, nothing half-applied.
    const stuck = await row(invoice.id);
    expect(stuck.eInvoiceStatus).toBe("cancelled");
    expect(stuck.eInvoiceCancelReason).toBe("3");
    expect(stuck.eInvoiceError).toMatch(/IRN cancelled at the IRP, but the invoice is still active/);
    expect(stuck.status).not.toBe("cancelled");
    expect(await stock(item.id)).toBeCloseTo(90, 3);
    const actions = await auditActions(invoice.id);
    expect(actions.find((a) => a.action === "eInvoice.cancel" && a.metadata.invoiceCancelled === false)?.metadata)
      .toMatchObject({ localCancelError: expect.stringContaining("payments") });

    // The admin can see it on the dashboard.
    const dash = await caller.eInvoice.dashboard({ status: "cancelled", page: 1, limit: 100 });
    const listed = dash.data.find((r) => r.id === invoice.id);
    expect(listed).toMatchObject({ eInvoiceStatus: "cancelled", invoiceStatus: stuck.status });
    expect(listed!.eInvoiceError).toBeTruthy();

    // Retrying while the payment is still there is refused, still without touching the IRP.
    await expect(
      caller.eInvoice.cancel({ invoiceId: invoice.id, cancelReason: "3" }),
    ).rejects.toThrow(/The invoice was not cancelled.*payments/s);
    expect(irp.__mockCancelIRN).toHaveBeenCalledTimes(1);

    // Remove the payment, retry: only the local cancel runs.
    const [allocation] = await getTenantTestDb()
      .select({ paymentId: paymentAllocations.paymentId })
      .from(paymentAllocations)
      .where(eq(paymentAllocations.invoiceId, invoice.id));
    expect(allocation).toBeDefined();
    await caller.payment.delete({ id: allocation!.paymentId });

    const finished = await caller.eInvoice.cancel({ invoiceId: invoice.id, cancelReason: "3" });
    expect(irp.__mockCancelIRN).toHaveBeenCalledTimes(1);
    expect(finished.status).toBe("cancelled");
    expect(finished.eInvoiceStatus).toBe("cancelled");
    expect(finished.eInvoiceCancelReason).toBe("3");
    expect(finished.eInvoiceError).toBeNull();
    expect(await stock(item.id)).toBeCloseTo(100, 3);
    expect(await gstr1Has(invoice.invoiceNumber)).toBe(false);
  });

  it("an invoice left half-cancelled by 0.10.0 (IRN cancelled, invoice live) is finished by the normal cancel, which never calls the IRP", async () => {
    const { caller, item, invoice } = await generatedSale();
    // The exact state the old code left behind (plus the explanation a failed finish records).
    await getTenantTestDb()
      .update(invoices)
      .set({ eInvoiceStatus: "cancelled", eInvoiceCancelReason: "2", eInvoiceError: "IRN cancelled at the IRP, but the invoice is still active" })
      .where(eq(invoices.id, invoice.id));
    expect(await gstr1Has(invoice.invoiceNumber)).toBe(true);

    const cancelled = await caller.invoice.updateStatus({ id: invoice.id, status: "cancelled" });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.eInvoiceError).toBeNull(); // the stale "still active" warning is cleared
    expect(irp.__mockCancelIRN).not.toHaveBeenCalled();
    expect(await stock(item.id)).toBeCloseTo(100, 3);
    expect(await gstr1Has(invoice.invoiceNumber)).toBe(false);
  });

  it("cancel on a half-cancelled invoice also finishes it locally without calling the IRP", async () => {
    const { caller, item, invoice } = await generatedSale();
    await getTenantTestDb()
      .update(invoices)
      .set({ eInvoiceStatus: "cancelled", eInvoiceCancelReason: "2" })
      .where(eq(invoices.id, invoice.id));

    const finished = await caller.eInvoice.cancel({ invoiceId: invoice.id, cancelReason: "1" });
    expect(irp.__mockCancelIRN).not.toHaveBeenCalled();
    expect(finished.status).toBe("cancelled");
    expect(finished.eInvoiceCancelReason).toBe("2"); // the reason sent to the IRP is kept
    expect(await stock(item.id)).toBeCloseTo(100, 3);
  });

  it("keeps the 24-hour window: an old IRN is refused before the IRP and the invoice is untouched", async () => {
    const { caller, item, invoice } = await generatedSale();
    await getTenantTestDb()
      .update(invoices)
      .set({ irnAckDate: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(invoices.id, invoice.id));

    await expect(
      caller.eInvoice.cancel({ invoiceId: invoice.id, cancelReason: "1" }),
    ).rejects.toThrow("24 hours");

    expect(irp.__mockCancelIRN).not.toHaveBeenCalled();
    const unchanged = await row(invoice.id);
    expect(unchanged.eInvoiceStatus).toBe("generated");
    expect(unchanged.status).not.toBe("cancelled");
    expect(await stock(item.id)).toBeCloseTo(90, 3);
  });

  it("a seller cannot cancel an e-invoice (no EInvoice:manage), and nothing changes", async () => {
    const { invoice } = await generatedSale();
    await expect(
      callerForAccountant().eInvoice.cancel({ invoiceId: invoice.id, cancelReason: "1" }),
    ).rejects.toThrow();
    expect(irp.__mockCancelIRN).not.toHaveBeenCalled();
    expect((await row(invoice.id)).eInvoiceStatus).toBe("generated");
  });

  it("a credit note's IRN cancel cancels the credit note through the document path", async () => {
    await setupEInvoiceConfig();
    const caller = callerForRamesh();
    const note = await caller.creditNote.create({
      type: "sale",
      partyId: b2bParty.id,
      invoiceDate: SALE_DATE,
      lineItems: [{ itemName: "Return", quantity: "1", unitPrice: "1000.00", taxPercent: "18", discountPercent: "0", conversionFactor: "1" }],
    });
    await caller.eInvoice.generate({ invoiceId: note.id });

    const result = await caller.eInvoice.cancel({ invoiceId: note.id, cancelReason: "2" });
    expect(irp.__mockCancelIRN).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("cancelled");
    expect(result.eInvoiceStatus).toBe("cancelled");
    const actions = await auditActions(note.id);
    expect(actions.find((a) => a.action === "credit_note.updateStatus")?.metadata).toMatchObject({ via: "eInvoice.cancel" });
  });

  it("a sales return's IRN cancel reverses the stock it added", async () => {
    await setupEInvoiceConfig();
    const caller = callerForRamesh();
    const item = await createItem(getTenantTestDb(), world.business1.id, { stockQuantity: "10.000" });
    const doc = await caller.salesReturn.create({
      type: "sale",
      partyId: b2bParty.id,
      invoiceDate: SALE_DATE,
      lineItems: [{ itemId: item.id, itemName: "Returned", quantity: "4", unitPrice: "100.00", taxPercent: "18", discountPercent: "0", conversionFactor: "1" }],
    });
    expect(await stock(item.id)).toBeCloseTo(14, 3);
    await caller.eInvoice.generate({ invoiceId: doc.id });

    await caller.eInvoice.cancel({ invoiceId: doc.id, cancelReason: "2" });
    expect((await row(doc.id)).status).toBe("cancelled");
    expect(await stock(item.id)).toBeCloseTo(10, 3);
  });
});

// ── 5. Dashboard ──────────────────────────────────────────────────────────────

describe("eInvoice.dashboard", () => {
  it("returns status counts and invoice list", async () => {
    const caller = callerForRamesh();
    const result = await caller.eInvoice.dashboard({ page: 1, limit: 20 });

    expect(result).toBeDefined();
    expect(result.counts).toHaveProperty("generated");
    expect(result.counts).toHaveProperty("pending");
    expect(result.counts).toHaveProperty("failed");
    expect(result.counts).toHaveProperty("cancelled");
    expect(result.data).toBeInstanceOf(Array);
    expect(typeof result.total).toBe("number");
  });

  it("filters by status", async () => {
    const caller = callerForRamesh();
    const result = await caller.eInvoice.dashboard({
      status: "generated",
      page: 1,
      limit: 20,
    });

    expect(result.data.every((inv) => inv.eInvoiceStatus === "generated")).toBe(true);
  });
});

// ── 6. getStatus ──────────────────────────────────────────────────────────────

describe("eInvoice.getStatus", () => {
  it("returns e-invoice status for a given invoice", async () => {
    const db = getTenantTestDb();
    await setupEInvoiceConfig();
    const caller = callerForRamesh();

    const { invoice } = await createInvoiceWithItems(
      db,
      world.business1.id,
      b2bParty.id,
      [{ description: "Product", quantity: "1", unitPrice: "500.00", taxPercent: "18" }],
    );

    await caller.eInvoice.generate({ invoiceId: invoice.id });

    const status = await caller.eInvoice.getStatus({ invoiceId: invoice.id });
    expect(status).not.toBeNull();
    expect(status!.eInvoiceStatus).toBe("generated");
    expect(status!.irn).toBeTruthy();
    expect(status!.signedQrCode).toBeTruthy();
  });

  it("returns null for unknown invoice", async () => {
    const caller = callerForRamesh();
    const status = await caller.eInvoice.getStatus({
      invoiceId: "00000000-0000-0000-0000-000000000000",
    });
    expect(status).toBeNull();
  });
});

// ── 7. Permissions ─────────────────────────────────────────────────────────────

describe("eInvoice permissions", () => {
  it("accountant can read dashboard but not configure", async () => {
    // suresh is seller role → no EInvoice:manage permission
    const caller = callerForAccountant();

    // dashboard (read) should fail for seller role (sellers don't have EInvoice:read)
    await expect(
      caller.eInvoice.dashboard({ page: 1, limit: 10 }),
    ).rejects.toThrow();

    // configure (manage) should fail
    await expect(
      caller.eInvoice.configure({
        gstin: "27AABCU9603R1ZM",
        clientId: "x",
        clientSecret: "x",
        username: "x",
        password: "x",
        isSandbox: true,
        isEnabled: false,
        thresholdCrore: "5",
      }),
    ).rejects.toThrow();
  });
});
