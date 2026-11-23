/**
 * price-propagation.test.tsx — "Update saved prices?" on the mobile invoice screens.
 *
 * On save, a user who can update items and changed a rate on a catalog-linked
 * line is asked ONCE whether to update the item prices. The bill is saved either
 * way and a price-update failure never blocks it. Sellers (no Item:update) are
 * never asked. Only the tRPC client, Expo Router and native modules are mocked;
 * the screens, hooks, sheet and the shared price rules are the real ones.
 */

import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

jest.mock("../lib/trpc", () => require("../test-utils/trpc-stub").trpcModule);
jest.mock("expo-router", () => require("../test-utils/trpc-stub").expoRouterModule);
jest.mock("react-native-safe-area-context", () =>
  require("react-native-safe-area-context/jest/mock").default,
);
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock("expo-constants", () => ({ default: { expoConfig: null } }));
jest.mock("expo-contacts", () => ({
  Fields: { PhoneNumbers: "phoneNumbers", Emails: "emails", Name: "name" },
  SortTypes: { FirstName: "firstName" },
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: "denied" })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: "denied" })),
  getContactsAsync: jest.fn(() => Promise.resolve({ data: [] })),
}));

import { stub, renderScreen } from "../test-utils/trpc-stub";
import { useBusinessStore } from "../stores/business";
import { toast } from "../lib/toast";

import InvoiceCreateScreen from "../../app/(app)/(invoices)/create";
import InvoiceEditScreen from "../../app/(app)/(invoices)/edit";
import QuotationCreateScreen from "../../app/(app)/(more)/quotations/create";
import CreditNoteCreateScreen from "../../app/(app)/(more)/credit-notes/create";
import DeliveryChallanCreateScreen from "../../app/(app)/(more)/delivery-challans/create";
import ProformaCreateScreen from "../../app/(app)/(more)/proforma-invoices/create";
import SalesReturnCreateScreen from "../../app/(app)/(more)/sales-returns/create";

const steel = { id: "item-1", name: "Steel Rod", unit: "kg", itemMode: "simple", salePrice: "1000.00", purchasePrice: "800.00", taxPercent: "18.00", taxInclusive: false, unitVariants: [], variants: [] };
const cement = { id: "item-2", name: "Cement Bag", unit: "bag", itemMode: "simple", salePrice: "350.00", purchasePrice: "300.00", taxPercent: "5.00", taxInclusive: false, unitVariants: [], variants: [] };
const rice = {
  id: "item-3", name: "Rice Basmati", unit: "kg", itemMode: "alt_units", salePrice: "100.00", purchasePrice: "80.00", taxPercent: "5.00", taxInclusive: false,
  unitVariants: [{ unit: "packet", conversionFactor: 0.2, salePrice: "20.00" }], variants: [],
};
// sale price ₹118.00 INCLUDING 18% GST (bill rate 100.00); purchase price ₹90.00 (tax-exclusive)
const atta = { id: "item-4", name: "Atta Inclusive", unit: "pcs", itemMode: "simple", salePrice: "118.00", purchasePrice: "90.00", taxPercent: "18.00", taxInclusive: true, unitVariants: [], variants: [] };
// base ₹118.00 incl. 18%; a 5-unit "box" at ₹590.00 incl. 18% (bill rate 500.00)
const box = {
  id: "item-5", name: "Box Inclusive", unit: "pcs", itemMode: "alt_units", salePrice: "118.00", purchasePrice: "90.00", taxPercent: "18.00", taxInclusive: true,
  unitVariants: [{ unit: "box", conversionFactor: 5, salePrice: "590.00" }], variants: [],
};
// shelf prices that do NOT bill to the paisa on a tax-exclusive line (shared/inclusive-price.ts)
const ten = { id: "item-6", name: "Tea Ten", unit: "pcs", itemMode: "simple", salePrice: "10.00", purchasePrice: "8.00", taxPercent: "18.00", taxInclusive: true, unitVariants: [], variants: [] };
const fortyOne = { id: "item-7", name: "Biscuits FortyOne", unit: "pcs", itemMode: "simple", salePrice: "41.00", purchasePrice: "30.00", taxPercent: "18.00", taxInclusive: true, unitVariants: [], variants: [] };
const catalog = [steel, cement, rice, atta, box, ten, fortyOne];

const SHEET = "Update saved prices?";
const UPDATE = "Update item prices";
const JUST_BILL = "Just this bill";

beforeEach(() => {
  jest.clearAllMocks();
  stub.reset();
  useBusinessStore.setState({ businessId: "biz-1", businessName: "Test Biz" } as never);
  stub.data["party.list"] = { data: [{ id: "party-1", name: "Ramesh Traders", type: "customer", phone: "9999999999", creditPeriodDays: 7 }] };
  stub.data["item.list"] = { data: catalog };
  stub.mutationResults["invoice.create"] = { id: "inv-1", invoiceNumber: "INV-00001" };
  stub.mutationResults["invoice.update"] = { id: "inv-9" };
  stub.handlers["item.getById"] = (input) => catalog.find((i) => i.id === (input as { id: string }).id) ?? null;
  stub.mutationHandlers["item.updatePricesFromDocument"] = () => ({ documentId: "inv-1", updated: [{ itemId: "item-1" }], unchanged: [] });
});

async function pickParty() {
  fireEvent.press(screen.getByText("Select party..."));
  fireEvent.press(await screen.findByText("Ramesh Traders"));
}

/** Pick an item into the first line (the line's picker shows "Tap to select item..."). */
async function pickItem(name: string) {
  fireEvent.press(screen.getAllByText("Tap to select item...")[0]!);
  fireEvent.press(await screen.findByText(name));
}

function setRate(from: string, to: string) {
  fireEvent.changeText(screen.getByDisplayValue(from), to);
}

const created = () => stub.mutations["invoice.create"] ?? [];
const priceCalls = () => stub.mutations["item.updatePricesFromDocument"] ?? [];

describe("InvoiceCreateScreen — update saved prices", () => {
  it("asks once, listing the changed item with its box checked; [Update item prices] saves the bill, then the prices", async () => {
    renderScreen("admin", InvoiceCreateScreen);
    await pickParty();
    await pickItem("Steel Rod");
    setRate("1000.00", "1100");

    fireEvent.press(screen.getByText("Create Invoice"));

    const title = await screen.findByText(SHEET);
    expect(title).toBeTruthy();
    expect(screen.getByLabelText(/Steel Rod, ₹1,000 to ₹1,100/)).toBeTruthy();
    expect(screen.getByRole("checkbox", { checked: true })).toBeTruthy();
    expect(created()).toHaveLength(0); // not saved until the user answers

    fireEvent.press(screen.getByText(UPDATE));

    await waitFor(() => expect(created()).toHaveLength(1));
    await waitFor(() => expect(priceCalls()).toHaveLength(1));
    expect(priceCalls()[0]).toEqual({
      documentId: "inv-1",
      updates: [{ itemId: "item-1", side: "sale", newPrice: "1100.00", priceIncludesTax: false }],
    });
  });

  it("[Just this bill] saves the bill and changes nothing in the catalog", async () => {
    renderScreen("admin", InvoiceCreateScreen);
    await pickParty();
    await pickItem("Steel Rod");
    setRate("1000.00", "1100");
    fireEvent.press(screen.getByText("Create Invoice"));

    fireEvent.press(await screen.findByText(JUST_BILL));

    await waitFor(() => expect(created()).toHaveLength(1));
    expect((created()[0] as { lineItems: Array<{ unitPrice: string }> }).lineItems[0]!.unitPrice).toBe("1100");
    expect(priceCalls()).toHaveLength(0);
  });

  it("lists only the items whose rate changed", async () => {
    renderScreen("admin", InvoiceCreateScreen);
    await pickParty();
    await pickItem("Steel Rod");
    fireEvent.press(screen.getByText("Add"));
    await pickItem("Cement Bag"); // the new line is prepended: its picker is first
    setRate("1000.00", "1100"); // Steel Rod
    fireEvent.press(screen.getByText("Create Invoice"));

    await screen.findByText(SHEET);
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.queryByLabelText(/Cement Bag/)).toBeNull();
  });

  it("does not ask when no rate changed", async () => {
    renderScreen("admin", InvoiceCreateScreen);
    await pickParty();
    await pickItem("Steel Rod");
    fireEvent.press(screen.getByText("Create Invoice"));

    await waitFor(() => expect(created()).toHaveLength(1));
    expect(screen.queryByText(SHEET)).toBeNull();
    expect(priceCalls()).toHaveLength(0);
  });

  it("an alternate-unit line proposes that unit's own price", async () => {
    renderScreen("admin", InvoiceCreateScreen);
    await pickParty();
    await pickItem("Rice Basmati");
    fireEvent.press(screen.getByText("packet"));
    setRate("20.00", "25");
    fireEvent.press(screen.getByText("Create Invoice"));

    await screen.findByText(SHEET);
    expect(screen.getByLabelText(/Rice Basmati \(packet\), ₹20 to ₹25/)).toBeTruthy();
    fireEvent.press(screen.getByText(UPDATE));
    await waitFor(() => expect(priceCalls()).toHaveLength(1));
    expect((priceCalls()[0] as { updates: unknown[] }).updates[0]).toMatchObject({ itemId: "item-3", unit: "packet", newPrice: "25.00" });
  });

  it("a failing price update never blocks the bill: it is saved and a toast explains", async () => {
    stub.mutationHandlers["item.updatePricesFromDocument"] = () => {
      throw new Error("Item not found");
    };
    const toastError = jest.spyOn(toast, "error").mockImplementation(() => {});
    renderScreen("admin", InvoiceCreateScreen);
    await pickParty();
    await pickItem("Steel Rod");
    setRate("1000.00", "1100");
    fireEvent.press(screen.getByText("Create Invoice"));
    fireEvent.press(await screen.findByText(UPDATE));

    await waitFor(() => expect(created()).toHaveLength(1));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Bill saved, but item prices were not updated", "Item not found"));
    expect(stub.router.replace).toHaveBeenCalled(); // the screen moved on to the saved bill
  });

  it("closing the sheet goes back to the form without saving", async () => {
    renderScreen("admin", InvoiceCreateScreen);
    await pickParty();
    await pickItem("Steel Rod");
    setRate("1000.00", "1100");
    fireEvent.press(screen.getByText("Create Invoice"));
    await screen.findByText(SHEET);

    // the X in the sheet header (the backdrop carries the same label)
    const backs = screen.getAllByLabelText("Back to editing");
    fireEvent.press(backs[backs.length - 1]!);

    await waitFor(() => expect(screen.queryByText(SHEET)).toBeNull());
    expect(created()).toHaveLength(0);
    expect(priceCalls()).toHaveLength(0);
    expect(screen.getByDisplayValue("1100")).toBeTruthy();
  });

  it("a seller (no Item:update) is never asked: the bill saves exactly as before", async () => {
    renderScreen("seller", InvoiceCreateScreen);
    await pickParty();
    await pickItem("Steel Rod");
    setRate("1000.00", "1100");
    fireEvent.press(screen.getByText("Create Invoice"));

    await waitFor(() => expect(created()).toHaveLength(1));
    expect(screen.queryByText(SHEET)).toBeNull();
    expect(stub.utilCalls["item.getById"] ?? []).toHaveLength(0);
    expect(priceCalls()).toHaveLength(0);
  });

  it("a seller_manager (can update items) is asked", async () => {
    renderScreen("seller_manager", InvoiceCreateScreen);
    await pickParty();
    await pickItem("Steel Rod");
    setRate("1000.00", "1100");
    fireEvent.press(screen.getByText("Create Invoice"));
    expect(await screen.findByText(SHEET)).toBeTruthy();
  });
});

describe("InvoiceEditScreen — update saved prices", () => {
  const savedBill = {
    id: "inv-9", type: "sale", documentType: "invoice", invoiceNumber: "INV-00009", partyId: "party-1",
    party: { id: "party-1", name: "Ramesh Traders" }, invoiceDate: "2026-04-01T00:00:00.000Z", dueDate: null, notes: null,
    lineItems: [
      { itemId: "item-3", itemName: "Rice Basmati (packet)", description: null, quantity: "2.000", unitPrice: "18.00", taxPercent: "5.00", discountPercent: "0.00", selectedUnit: "packet", conversionFactor: "0.200000", variantId: null },
    ],
  };

  beforeEach(() => {
    stub.params.id = "inv-9";
    stub.data["invoice.getById"] = savedBill;
  });

  it("keeps the line's unit, and an untouched rate is not offered for update even though the catalog moved on", async () => {
    renderScreen("admin", InvoiceEditScreen);
    await screen.findByText("Edit Invoice");
    fireEvent.press(screen.getByText("Save"));

    await waitFor(() => expect(stub.mutations["invoice.update"]).toHaveLength(1));
    expect(screen.queryByText(SHEET)).toBeNull();
    const line = (stub.mutations["invoice.update"]![0] as { lineItems: Array<Record<string, unknown>> }).lineItems[0]!;
    expect(line).toMatchObject({ itemId: "item-3", selectedUnit: "packet", conversionFactor: "0.200000" });
  });

  it("an edited rate proposes the unit's price and applies it to the edited bill", async () => {
    renderScreen("admin", InvoiceEditScreen);
    await screen.findByText("Edit Invoice");
    setRate("18.00", "22");
    fireEvent.press(screen.getByText("Save"));

    await screen.findByText(SHEET);
    expect(screen.getByLabelText(/Rice Basmati \(packet\), ₹20 to ₹22/)).toBeTruthy();
    fireEvent.press(screen.getByText(UPDATE));
    await waitFor(() => expect(priceCalls()).toHaveLength(1));
    expect(priceCalls()[0]).toEqual({
      documentId: "inv-9",
      updates: [{ itemId: "item-3", unit: "packet", side: "sale", newPrice: "22.00", priceIncludesTax: false }],
    });
  });

  it("a seller editing a bill is never asked", async () => {
    renderScreen("seller", InvoiceEditScreen);
    await screen.findByText("Edit Invoice");
    setRate("18.00", "22");
    fireEvent.press(screen.getByText("Save"));
    await waitFor(() => expect(stub.mutations["invoice.update"]).toHaveLength(1));
    expect(screen.queryByText(SHEET)).toBeNull();
  });
});

describe("items whose sale price includes GST are billed at the tax-exclusive rate (mobile)", () => {
  const hint = () => screen.queryByTestId("inclusive-hint");
  const hintText = () => {
    const children = hint()!.props.children as unknown;
    return Array.isArray(children) ? children.join("") : String(children);
  };

  it("invoice: picking ₹118 incl. 18% starts the Rate at 100.00 (not 118 + 21.24 = 139.24), with the derivation shown", async () => {
    renderScreen("admin", InvoiceCreateScreen);
    await pickParty();
    await pickItem("Atta Inclusive");

    expect(screen.getByDisplayValue("100.00")).toBeTruthy();
    expect(hintText()).toBe("₹118 incl. GST → ₹100 + ₹18");
    fireEvent.press(screen.getByText("Create Invoice"));
    await waitFor(() => expect(created()).toHaveLength(1));
    expect((created()[0] as { lineItems: Array<{ unitPrice: string; taxPercent: string }> }).lineItems[0]).toMatchObject({ unitPrice: "100.00", taxPercent: "18.00" });
    // untouched: no price prompt (100.00 is the saved 118.00, not a price cut)
    expect(screen.queryByText(SHEET)).toBeNull();
  });

  it("invoice: editing the GST % keeps the shelf price: 18% -> 12% re-derives 105.36 (+ 12.64 = 118.00)", async () => {
    renderScreen("admin", InvoiceCreateScreen);
    await pickParty();
    await pickItem("Atta Inclusive");
    fireEvent.changeText(screen.getByDisplayValue("18.00"), "12");

    expect(screen.getByDisplayValue("105.36")).toBeTruthy();
    expect(hintText()).toBe("₹118 incl. GST → ₹105.36 + ₹12.64");
    fireEvent.press(screen.getByText("Create Invoice"));
    await waitFor(() => expect(created()).toHaveLength(1));
    expect(screen.queryByText(SHEET)).toBeNull(); // re-derived, not edited
  });

  it("invoice: typing the Rate states the exclusive rate yourself: the hint goes, and a typed 105 is proposed back as the inclusive 123.90", async () => {
    renderScreen("admin", InvoiceCreateScreen);
    await pickParty();
    await pickItem("Atta Inclusive");
    setRate("100.00", "105");
    expect(hint()).toBeNull();
    fireEvent.press(screen.getByText("Create Invoice"));

    await screen.findByText(SHEET);
    expect(screen.getByLabelText(/Atta Inclusive, ₹118 to ₹123\.9/)).toBeTruthy();
    fireEvent.press(screen.getByText(UPDATE));
    await waitFor(() => expect(priceCalls()).toHaveLength(1));
    expect((priceCalls()[0] as { updates: unknown[] }).updates[0]).toMatchObject({ itemId: "item-4", side: "sale", newPrice: "123.90", priceIncludesTax: true });
  });

  it("invoice: an alternate unit is converted too: the box at ₹590.00 incl. 18% is 500.00", async () => {
    renderScreen("admin", InvoiceCreateScreen);
    await pickParty();
    await pickItem("Box Inclusive");
    fireEvent.press(screen.getByText("box"));
    expect(screen.getByDisplayValue("500.00")).toBeTruthy();
    expect(hintText()).toBe("₹590 incl. GST → ₹500 + ₹90");
  });

  it("invoice: the purchase side is never converted: the purchase price 90.00 goes on the bill as it is", async () => {
    renderScreen("admin", InvoiceCreateScreen);
    fireEvent.press(screen.getByText("Purchase"));
    await pickItem("Atta Inclusive");
    expect(screen.getByDisplayValue("90.00")).toBeTruthy();
    expect(hint()).toBeNull();
  });

  it("invoice edit: a newly picked inclusive item is converted too", async () => {
    stub.params.id = "inv-9";
    stub.data["invoice.getById"] = {
      id: "inv-9", type: "sale", documentType: "invoice", invoiceNumber: "INV-00009", partyId: "party-1",
      party: { id: "party-1", name: "Ramesh Traders" }, invoiceDate: "2026-04-01T00:00:00.000Z", dueDate: null, notes: null,
      lineItems: [{ itemId: "item-1", itemName: "Steel Rod", description: null, quantity: "1.000", unitPrice: "1000.00", taxPercent: "18.00", discountPercent: "0.00", selectedUnit: null, conversionFactor: "1.000000", variantId: null }],
    };
    renderScreen("admin", InvoiceEditScreen);
    await screen.findByText("Edit Invoice");
    fireEvent.press(screen.getByText("Steel Rod"));
    fireEvent.press(await screen.findByText("Atta Inclusive"));
    expect(screen.getByDisplayValue("100.00")).toBeTruthy();
    expect(hintText()).toBe("₹118 incl. GST → ₹100 + ₹18");
  });

  it.each([
    ["quotation", QuotationCreateScreen],
    ["credit note", CreditNoteCreateScreen],
    ["delivery challan", DeliveryChallanCreateScreen],
    ["proforma invoice", ProformaCreateScreen],
    ["sales return", SalesReturnCreateScreen],
  ] as const)("%s: an inclusive item starts at 100.00 (GST 18.00 on top = 118.00)", async (_name, Screen) => {
    renderScreen("admin", Screen);
    fireEvent.press(screen.getAllByText("Tap to select item...")[0]!);
    fireEvent.press(await screen.findByText("Atta Inclusive"));
    expect(screen.getByDisplayValue("100.00")).toBeTruthy();
    expect(hintText()).toBe("₹118 incl. GST → ₹100 + ₹18");
    // the GST % edit re-derives here too
    fireEvent.changeText(screen.getByDisplayValue("18.00"), "12");
    expect(screen.getByDisplayValue("105.36")).toBeTruthy();
  });
});

describe("a shelf price that does not bill to the paisa is brought back by the round-off (mobile)", () => {
  const hintText = () => {
    const children = screen.getByTestId("inclusive-hint").props.children as unknown;
    return Array.isArray(children) ? children.join("") : String(children);
  };

  it("invoice: ₹10.00 incl. 18% - the hint shows 8.47 + 1.52 = 9.99 and the document carries round-off +0.01 (total 10.00)", async () => {
    renderScreen("admin", InvoiceCreateScreen);
    await pickParty();
    await pickItem("Tea Ten");
    // 1000p x 100 / 118 = 847.46 -> 847; GST 847 x 18% = 152.46 -> 152; 8.47 + 1.52 = 9.99
    expect(screen.getByDisplayValue("8.47")).toBeTruthy();
    expect(hintText()).toBe("₹10 incl. GST → ₹8.47 + ₹1.52 = ₹9.99");
    expect(screen.getByText("Round off")).toBeTruthy();
    fireEvent.press(screen.getByText("Create Invoice"));
    await waitFor(() => expect(created()).toHaveLength(1));
    expect(created()[0]).toMatchObject({ roundOff: "0.01" });
  });

  it("invoice: ₹41.00 incl. 18% bills 41.01 (a paisa over): round-off -0.01", async () => {
    renderScreen("admin", InvoiceCreateScreen);
    await pickParty();
    await pickItem("Biscuits FortyOne");
    // 4100p x 100 / 118 = 3474.58 -> 3475; GST 3475 x 18% = 625.5 -> 626 (half up); 34.75 + 6.26 = 41.01
    expect(hintText()).toBe("₹41 incl. GST → ₹34.75 + ₹6.26 = ₹41.01");
    fireEvent.press(screen.getByText("Create Invoice"));
    await waitFor(() => expect(created()).toHaveLength(1));
    expect(created()[0]).toMatchObject({ roundOff: "-0.01" });
  });

  it("invoice: a price that does tie (₹118.00 incl. 18%) needs no round-off and shows no extra row", async () => {
    renderScreen("admin", InvoiceCreateScreen);
    await pickParty();
    await pickItem("Atta Inclusive");
    expect(screen.queryByText("Round off")).toBeNull();
    fireEvent.press(screen.getByText("Create Invoice"));
    await waitFor(() => expect(created()).toHaveLength(1));
    expect(Number((created()[0] as { roundOff: string }).roundOff)).toBe(0);
  });

  it("invoice: typing your own Rate ends the shelf-price round-off", async () => {
    renderScreen("admin", InvoiceCreateScreen);
    await pickParty();
    await pickItem("Tea Ten");
    setRate("8.47", "9");
    expect(screen.queryByText("Round off")).toBeNull();
    fireEvent.press(screen.getByText("Create Invoice"));
    fireEvent.press(await screen.findByText(JUST_BILL)); // a typed rate is a price edit: answer the prompt
    await waitFor(() => expect(created()).toHaveLength(1));
    expect(Number((created()[0] as { roundOff: string }).roundOff)).toBe(0);
  });

  it.each([
    ["quotation", QuotationCreateScreen, "quotation.create", "Create Quotation"],
    ["credit note", CreditNoteCreateScreen, "creditNote.create", "Create Credit Note"],
    ["proforma invoice", ProformaCreateScreen, "proforma.create", "Create Proforma Invoice"],
    ["delivery challan", DeliveryChallanCreateScreen, "deliveryChallan.create", "Create Delivery Challan"],
  ] as const)("%s: ₹10.00 incl. 18% shows 9.99 + round-off 0.01 and is saved with roundOff 0.01", async (_name, Screen, key, button) => {
    stub.mutationResults[key] = { id: "doc-1" };
    renderScreen("admin", Screen);
    // the party placeholder differs: "Select party..." (credit note) or "Select customer..." (the others)
    fireEvent.press(screen.queryByText("Select party...") ?? screen.getByText("Select customer..."));
    fireEvent.press(await screen.findByText("Ramesh Traders"));
    fireEvent.press(screen.getAllByText("Tap to select item...")[0]!);
    fireEvent.press(await screen.findByText("Tea Ten"));
    expect(hintText()).toBe("₹10 incl. GST → ₹8.47 + ₹1.52 = ₹9.99");
    expect(screen.getByText("Round off")).toBeTruthy();
    fireEvent.press(screen.getByText(button));
    await waitFor(() => expect(stub.mutations[key] ?? []).toHaveLength(1));
    expect(stub.mutations[key]![0]).toMatchObject({ roundOff: "0.01" });
  });
});
