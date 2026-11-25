import { describe, it, expect, beforeEach } from "vitest";
import { claimOwnlystBillSchema, type ClaimOwnlystBillInput, invoiceSources } from "@hisaabo/shared";
import { eq, and, isNull } from "drizzle-orm";
import { invoices, items, parties, itcLedgerEntries } from "@hisaabo/db";
import { processClaimOwnlystBill } from "../lib/claim-ownlyst-bill.js";
import {
  createUser,
  createTenant,
  addMember,
  createBusiness,
} from "./helpers/fixtures.js";
import { getTenantTestDb, truncateAllTables } from "./helpers/test-db.js";

describe("claimOwnlystBill schema & validation", () => {
  it("includes 'ownlyst' in invoiceSources", () => {
    expect(invoiceSources).toContain("ownlyst");
  });

  it("validates a compliant Ownlyst claim payload with businessId and itemType", () => {
    const validPayload: ClaimOwnlystBillInput = {
      businessId: "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      dedupeKey: "INV-2026-001::33AABCT1332L1Z1",
      supplier: {
        name: "Acme Supplies Pvt Ltd",
        gstin: "33AABCT1332L1Z1",
        pan: "AABCT1332L",
        email: "billing@acme.com",
        phone: "9876543210",
        address: "123 Industrial Estate",
        city: "Chennai",
        state: "Tamil Nadu",
        stateCode: "33",
        pincode: "600001",
        bankAccountNumber: "123456789012",
        bankIfsc: "HDFC0001234",
      },
      invoiceNumber: "INV-2026-001",
      invoiceDate: "2026-11-24T00:00:00.000Z",
      dueDate: "2026-12-24T00:00:00.000Z",
      notes: "Claimed via Ownlyst Studio",
      isReverseCharge: false,
      currency: "INR",
      lineItems: [
        {
          itemName: "Premium Kraft Paper 300GSM",
          description: "High tensile packaging kraft paper",
          hsn: "4804",
          quantity: "100",
          unitPrice: "45.00",
          taxPercent: "18",
          discountPercent: "0",
          unit: "pcs",
          itemType: "product",
        },
        {
          itemName: "Graphic Design Consulting Service",
          description: "Branding and die-cut layout",
          hsn: "998314",
          quantity: "1",
          unitPrice: "5000.00",
          taxPercent: "18",
          discountPercent: "0",
          unit: "pcs",
          itemType: "service",
        },
      ],
    };

    const parsed = claimOwnlystBillSchema.safeParse(validPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.dedupeKey).toBe("INV-2026-001::33AABCT1332L1Z1");
      expect(parsed.data.businessId).toBe("a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d");
      expect(parsed.data.lineItems).toHaveLength(2);
      expect(parsed.data.lineItems[0].hsn).toBe("4804");
      expect(parsed.data.lineItems[0].itemType).toBe("product");
      expect(parsed.data.lineItems[1].hsn).toBe("998314");
      expect(parsed.data.lineItems[1].itemType).toBe("service");
    }
  });

  it("handles null and empty optional fields gracefully", () => {
    const minimalPayload = {
      dedupeKey: "DEDUPE-MINIMAL-01",
      supplier: {
        name: "Freelancer John",
        gstin: null,
        pan: null,
        email: "",
        phone: null,
        address: null,
      },
      invoiceNumber: "BILL-999",
      invoiceDate: "2026-11-24",
      dueDate: null,
      notes: null,
      lineItems: [
        {
          itemName: "Web Design Services",
          quantity: "1",
          unitPrice: "12000",
          taxPercent: "0",
          discountPercent: "0",
        },
      ],
    };

    const parsed = claimOwnlystBillSchema.safeParse(minimalPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.supplier.name).toBe("Freelancer John");
      expect(parsed.data.lineItems[0].unit).toBe("pcs");
      expect(parsed.data.currency).toBe("INR");
    }
  });

  it("rejects payload without line items", () => {
    const invalidPayload = {
      dedupeKey: "EMPTY-ITEMS",
      supplier: { name: "Supplier" },
      invoiceNumber: "INV-1",
      invoiceDate: "2026-11-24",
      lineItems: [],
    };

    const parsed = claimOwnlystBillSchema.safeParse(invalidPayload);
    expect(parsed.success).toBe(false);
  });
});

describe("processClaimOwnlystBill integration", () => {
  const db = getTenantTestDb();

  beforeEach(async () => {
    await truncateAllTables();
  });

  it("successfully claims an Ownlyst bill with product stock delta, party upsert, and ITC", async () => {
    const user = await createUser();
    const tenant = await createTenant();
    await addMember(tenant.id, user.id, "owner");
    const biz = await createBusiness(db, user.id, {
      gstRegistrationType: "regular",
      stateCode: "27",
    });

    const payload: ClaimOwnlystBillInput = {
      dedupeKey: "OWNLYST-TEST-001",
      supplier: {
        name: "Bharat Paper Mart",
        gstin: "27AABCU9603R1ZM",
        pan: "AABCU9603R",
        email: "sales@bharatpaper.in",
        phone: "9876543210",
        address: "42 Paper Market, Fort",
        city: "Mumbai",
        state: "Maharashtra",
        stateCode: "27",
        pincode: "400001",
        bankAccountNumber: "998877665544",
        bankIfsc: "SBIN0001234",
      },
      invoiceNumber: "BPM-2026-101",
      invoiceDate: "2026-11-25T00:00:00.000Z",
      dueDate: "2026-12-25T00:00:00.000Z",
      notes: "Paper shipment for printing batch A",
      isReverseCharge: false,
      currency: "INR",
      lineItems: [
        {
          itemName: "A4 Printing Paper 75GSM",
          description: "500 sheets ream",
          hsn: "4802",
          quantity: "50",
          unitPrice: "250.00",
          taxPercent: "12",
          discountPercent: "0",
          unit: "pcs",
        },
        {
          itemName: "Paper Cutting & Trimming Service",
          description: "Custom size trimming",
          hsn: "998821",
          quantity: "1",
          unitPrice: "1000.00",
          taxPercent: "18",
          discountPercent: "0",
          unit: "pcs",
        },
      ],
    };

    const result = await processClaimOwnlystBill(
      db,
      biz.id,
      { id: user.id, name: user.name },
      payload
    );

    expect(result.success).toBe(true);
    expect(result.alreadyClaimed).toBe(false);
    expect(result.invoiceNumber).toBe("BPM-2026-101");

    // 1. Check Invoice record
    const [inv] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, result.invoiceId), eq(invoices.businessId, biz.id)));
    expect(inv).toBeDefined();
    expect(inv.type).toBe("purchase");
    expect(inv.documentType).toBe("invoice");
    expect(inv.source).toBe("ownlyst");
    expect(inv.notes).toContain("[Vendor Bill: BPM-2026-101]");
    expect(inv.notes).toContain("[ownlyst-claim:OWNLYST-TEST-001]");

    // 2. Check Supplier Party
    const [supplier] = await db
      .select()
      .from(parties)
      .where(and(eq(parties.id, inv.partyId), eq(parties.businessId, biz.id)));
    expect(supplier).toBeDefined();
    expect(supplier.type).toBe("supplier");
    expect(supplier.name).toBe("Bharat Paper Mart");
    expect(supplier.gstin).toBe("27AABCU9603R1ZM");
    expect(supplier.pan).toBe("AABCU9603R");
    expect(supplier.source).toBe("ownlyst");

    // 3. Check Items & Stock delta
    const [paperItem] = await db
      .select()
      .from(items)
      .where(and(eq(items.businessId, biz.id), eq(items.name, "A4 Printing Paper 75GSM")));
    expect(paperItem).toBeDefined();
    expect(paperItem.itemType).toBe("product");
    expect(parseFloat(paperItem.stockQuantity)).toBe(50);

    const [cuttingService] = await db
      .select()
      .from(items)
      .where(and(eq(items.businessId, biz.id), eq(items.name, "Paper Cutting & Trimming Service")));
    expect(cuttingService).toBeDefined();
    expect(cuttingService.itemType).toBe("service");
    expect(parseFloat(cuttingService.stockQuantity)).toBe(0);

    // 4. Check ITC Ledger Entry
    const [itc] = await db
      .select()
      .from(itcLedgerEntries)
      .where(and(eq(itcLedgerEntries.invoiceId, inv.id), eq(itcLedgerEntries.businessId, biz.id)));
    expect(itc).toBeDefined();
    expect(itc.status).toBe("available");
    expect(parseFloat(itc.cgst!)).toBeGreaterThan(0);
    expect(parseFloat(itc.sgst!)).toBeGreaterThan(0);

    // 5. Test Idempotency / Deduplication
    const dupeResult = await processClaimOwnlystBill(
      db,
      biz.id,
      { id: user.id, name: user.name },
      payload
    );
    expect(dupeResult.success).toBe(true);
    expect(dupeResult.alreadyClaimed).toBe(true);
    expect(dupeResult.invoiceId).toBe(result.invoiceId);
    expect(dupeResult.invoiceNumber).toBe(result.invoiceNumber);

    // Ensure no duplicate invoice was inserted
    const count = await db
      .select()
      .from(invoices)
      .where(eq(invoices.businessId, biz.id));
    expect(count).toHaveLength(1);
  });

  it("handles invoice number collisions safely without throwing unique index violation", async () => {
    const user = await createUser();
    const tenant = await createTenant();
    await addMember(tenant.id, user.id, "owner");
    const biz = await createBusiness(db, user.id, {
      invoicePrefix: "BILL",
      nextInvoiceNumber: 1,
    });

    // Seed existing invoice with number "BILL-100"
    const [existingParty] = await db
      .insert(parties)
      .values({
        businessId: biz.id,
        name: "Initial Party",
        type: "supplier",
      })
      .returning();

    await db.insert(invoices).values({
      businessId: biz.id,
      partyId: existingParty.id,
      type: "purchase",
      invoiceNumber: "BILL-100",
      invoiceDate: new Date(),
      subtotal: "100.00",
      totalAmount: "100.00",
    });

    // Claim bill that also has invoiceNumber "BILL-100"
    const payload: ClaimOwnlystBillInput = {
      dedupeKey: "DEDUPE-COLLISION-TEST",
      supplier: {
        name: "New Supplier Co",
      },
      invoiceNumber: "BILL-100",
      invoiceDate: "2026-11-25T00:00:00.000Z",
      lineItems: [
        {
          itemName: "Raw Material Batch 1",
          quantity: "10",
          unitPrice: "150.00",
          taxPercent: "0",
          discountPercent: "0",
        },
      ],
    };

    const result = await processClaimOwnlystBill(
      db,
      biz.id,
      { id: user.id, name: user.name },
      payload
    );

    expect(result.success).toBe(true);
    expect(result.alreadyClaimed).toBe(false);
    expect(result.invoiceNumber).toBe("BILL-00001");

    const [saved] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, result.invoiceId));
    expect(saved.invoiceNumber).toBe("BILL-00001");
    expect(saved.notes).toContain("[Vendor Bill: BILL-100]");
  });

  it("ignores soft-deleted items and creates a fresh active item", async () => {
    const user = await createUser();
    const tenant = await createTenant();
    await addMember(tenant.id, user.id, "owner");
    const biz = await createBusiness(db, user.id);

    // Insert an item that was soft deleted
    const [deletedItem] = await db
      .insert(items)
      .values({
        businessId: biz.id,
        name: "Archived Hardware Widget",
        unit: "pcs",
        itemType: "product",
        salePrice: "50.00",
        purchasePrice: "50.00",
        deletedAt: new Date(),
      })
      .returning();

    const payload: ClaimOwnlystBillInput = {
      dedupeKey: "DEDUPE-SOFT-DELETE-TEST",
      supplier: { name: "Hardware Store" },
      invoiceNumber: "HW-555",
      invoiceDate: "2026-11-25",
      lineItems: [
        {
          itemName: "Archived Hardware Widget",
          quantity: "5",
          unitPrice: "60.00",
          taxPercent: "0",
          discountPercent: "0",
          unit: "pcs",
        },
      ],
    };

    const result = await processClaimOwnlystBill(
      db,
      biz.id,
      { id: user.id, name: user.name },
      payload
    );
    expect(result.success).toBe(true);

    const [activeItem] = await db
      .select()
      .from(items)
      .where(
        and(
          eq(items.businessId, biz.id),
          eq(items.name, "Archived Hardware Widget"),
          isNull(items.deletedAt)
        )
      );

    expect(activeItem).toBeDefined();
    expect(activeItem.id).not.toBe(deletedItem.id);
    expect(parseFloat(activeItem.stockQuantity)).toBe(5);
  });
});
