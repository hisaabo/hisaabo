import { describe, it, expect } from "vitest";
import { claimOwnlystBillSchema, type ClaimOwnlystBillInput, invoiceSources } from "@hisaabo/shared";

describe("claimOwnlystBill schema & validation", () => {
  it("includes 'ownlyst' in invoiceSources", () => {
    expect(invoiceSources).toContain("ownlyst");
  });

  it("validates a compliant Ownlyst claim payload", () => {
    const validPayload: ClaimOwnlystBillInput = {
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
        },
      ],
    };

    const parsed = claimOwnlystBillSchema.safeParse(validPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.dedupeKey).toBe("INV-2026-001::33AABCT1332L1Z1");
      expect(parsed.data.lineItems).toHaveLength(2);
      expect(parsed.data.lineItems[0].hsn).toBe("4804");
      expect(parsed.data.lineItems[1].hsn).toBe("998314");
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
