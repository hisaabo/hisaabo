/**
 * The invoice PDF shows CGST + SGST or IGST by the ONE shared intra / inter-state decision
 * (@hisaabo/shared gst-state), the same one the returns, ledger, e-invoice and e-way bill use. It used to
 * compare state codes, then names, and otherwise say "inter-state": a customer with a GSTIN and no state
 * on file, or a walk-in with nothing on file, got IGST on the PDF while the ledger booked CGST + SGST.
 */
import { describe, it, expect } from "vitest";
import { isSameState, type InvoicePDFData } from "../lib/invoice-pdf.js";

const d = (over: Partial<InvoicePDFData>) => over as InvoicePDFData;
const MH = { businessGstin: "27AABCU9603R1ZM", businessStateCode: "27", businessState: "Maharashtra" };

describe("invoice PDF: intra / inter-state decision", () => {
  it("state codes: same is CGST + SGST, different is IGST", () => {
    expect(isSameState(d({ ...MH, partyStateCode: "27" }))).toBe(true);
    expect(isSameState(d({ ...MH, partyStateCode: "29" }))).toBe(false);
  });

  it("a customer with a GSTIN and no state on file is decided by the GSTIN", () => {
    expect(isSameState(d({ ...MH, partyGstin: "27AABCM0000R1ZM" }))).toBe(true);
    expect(isSameState(d({ ...MH, partyGstin: "29AABCG0000R1ZM" }))).toBe(false);
  });

  it("the GSTIN beats a wrong stored code", () => {
    expect(isSameState(d({ ...MH, partyGstin: "29AABCG0000R1ZM", partyStateCode: "27", partyState: "Maharashtra" }))).toBe(false);
  });

  it("Andhra Pradesh: legacy 28 and current 37 are one state", () => {
    expect(isSameState(d({ businessStateCode: "37", partyStateCode: "28" }))).toBe(true);
    expect(isSameState(d({ businessStateCode: "37", partyStateCode: "36" }))).toBe(false);
  });

  it("an invalid stored code is ignored: the name decides", () => {
    expect(isSameState(d({ ...MH, partyStateCode: "50", partyState: "maharashtra" }))).toBe(true);
    expect(isSameState(d({ ...MH, partyStateCode: "50", partyState: "Karnataka" }))).toBe(false);
  });

  it("nothing on the customer: the supplier's own state, CGST + SGST (it used to print IGST)", () => {
    expect(isSameState(d({ ...MH }))).toBe(true);
  });
});
