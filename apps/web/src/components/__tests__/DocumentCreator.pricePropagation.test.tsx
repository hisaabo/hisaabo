/**
 * "Update saved prices?" in the document form.
 *
 * On save, a user who can update items and changed a rate on a catalog-linked
 * line is asked ONCE whether to update the item prices. The bill is saved
 * either way and a price-update failure never blocks it. Users without
 * Item:update (sellers) and documents that are not invoices are never asked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  role: { current: "admin" as string },
  createCalls: [] as unknown[],
  quotationCalls: [] as unknown[],
  updateCalls: [] as unknown[],
  editData: { current: null as unknown },
  updateMutate: vi.fn(),
  getById: vi.fn(),
  invalidate: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

const catalog = vi.hoisted(() => ({
  steel: { id: "item-1", name: "Steel Rod", unit: "kg", itemMode: "simple", salePrice: "1000.00", purchasePrice: "800.00", taxPercent: "18.00", taxInclusive: false, unitVariants: [], variants: [] },
  cement: { id: "item-2", name: "Cement Bag", unit: "bag", itemMode: "simple", salePrice: "350.00", purchasePrice: "300.00", taxPercent: "5.00", taxInclusive: false, unitVariants: [], variants: [] },
  // sale price ₹118.00 INCLUDING 18% GST (bill rate 100.00); purchase price ₹90.00 (tax-exclusive)
  atta: { id: "item-4", name: "Atta Inclusive", unit: "pcs", itemMode: "simple", salePrice: "118.00", purchasePrice: "90.00", taxPercent: "18.00", taxInclusive: true, unitVariants: [], variants: [] },
  // base ₹118.00 incl. 18%; a 5-unit "box" at ₹590.00 incl. 18% (bill rate 500.00)
  box: {
    id: "item-5", name: "Box Inclusive", unit: "pcs", itemMode: "alt_units", salePrice: "118.00", purchasePrice: "90.00", taxPercent: "18.00", taxInclusive: true,
    unitVariants: [{ unit: "box", conversionFactor: 5, salePrice: "590.00" }], variants: [],
  },
  rice: {
    id: "item-3", name: "Rice Basmati", unit: "kg", itemMode: "alt_units", salePrice: "100.00", purchasePrice: "80.00", taxPercent: "5.00", taxInclusive: false,
    unitVariants: [{ unit: "packet", conversionFactor: 0.2, salePrice: "20.00" }], variants: [],
  },
}));

vi.mock("@/lib/trpc", () => {
  const mutation = (calls: unknown[]) => (opts?: { onSuccess?: (d: unknown) => void }) => ({
    mutate: (input: unknown) => {
      calls.push(input);
      opts?.onSuccess?.({ id: "inv-1", invoiceNumber: "INV-00001" });
    },
    isPending: false,
  });
  const noop = { create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) }, list: { invalidate: h.invalidate } };
  return {
    getBusinessId: () => "biz-1",
    trpc: {
      auth: { me: { useQuery: () => ({ data: { role: h.role.current }, isLoading: false }) } },
      business: { list: { useQuery: () => ({ data: [{ id: "biz-1", name: "Biz", defaultRoundOff: false, defaultTermsAndConditions: null }] }) } },
      party: {
        list: { useQuery: () => ({ data: { data: [{ id: "party-1", name: "Ramesh Traders", type: "customer", creditPeriodDays: 7 }] }, isFetching: false }) },
        create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
      item: {
        list: { useQuery: () => ({ data: { data: [catalog.steel, catalog.cement, catalog.rice, catalog.atta, catalog.box] }, isFetching: false }) },
        create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        updatePricesFromDocument: { useMutation: () => ({ mutateAsync: h.updateMutate, isPending: false }) },
      },
      invoice: {
        create: { useMutation: mutation(h.createCalls) },
        update: { useMutation: mutation(h.updateCalls) },
        getById: { useQuery: () => ({ data: h.editData.current }) },
        list: { invalidate: h.invalidate },
      },
      quotation: { create: { useMutation: mutation(h.quotationCalls) }, list: { invalidate: h.invalidate } },
      creditNote: noop, debitNote: noop, deliveryChallan: noop, proforma: noop, salesReturn: noop, purchaseReturn: noop,
      dashboard: { summary: { invalidate: h.invalidate }, shippingSummary: { invalidate: h.invalidate } },
      useUtils: () => ({
        invoice: { list: { invalidate: h.invalidate }, getById: { invalidate: h.invalidate } },
        quotation: { list: { invalidate: h.invalidate } },
        creditNote: { list: { invalidate: h.invalidate } },
        debitNote: { list: { invalidate: h.invalidate } },
        deliveryChallan: { list: { invalidate: h.invalidate } },
        proforma: { list: { invalidate: h.invalidate } },
        salesReturn: { list: { invalidate: h.invalidate } },
        purchaseReturn: { list: { invalidate: h.invalidate } },
        dashboard: { summary: { invalidate: h.invalidate }, shippingSummary: { invalidate: h.invalidate } },
        item: { list: { invalidate: h.invalidate }, getById: { fetch: h.getById, invalidate: h.invalidate } },
        party: { list: { invalidate: h.invalidate } },
      }),
    },
  };
});

vi.mock("@/hooks/useToast", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

import { DocumentCreator } from "../DocumentCreator";

function renderCreator(props: Partial<React.ComponentProps<typeof DocumentCreator>> = {}) {
  const onClose = vi.fn();
  render(<DocumentCreator documentType="invoice" invoiceType="sale" onClose={onClose} {...props} />);
  return { onClose };
}

async function pickParty(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("combobox", { name: /customer/i }));
  await user.click(screen.getByText("Ramesh Traders"));
}

/** Pick `name` into the (n-th) line's product combobox. */
async function pickItem(user: ReturnType<typeof userEvent.setup>, name: RegExp, line = 0) {
  const combos = screen.getAllByPlaceholderText("Select product or custom item");
  await user.click(combos[line]!);
  await user.click(await screen.findByRole("option", { name }));
}

function setPrice(value: string, line = 0) {
  fireEvent.change(screen.getAllByLabelText("Unit price")[line]!, { target: { value } });
}

async function save(user: ReturnType<typeof userEvent.setup>, label = /create invoice/i) {
  await user.click(screen.getByRole("button", { name: label }));
}

beforeEach(() => {
  h.role.current = "admin";
  h.createCalls.length = 0;
  h.quotationCalls.length = 0;
  h.updateCalls.length = 0;
  h.editData.current = null;
  h.updateMutate.mockReset();
  h.updateMutate.mockResolvedValue({ documentId: "inv-1", updated: [{ itemId: "item-1" }], unchanged: [] });
  h.getById.mockReset();
  h.getById.mockImplementation(async ({ id }: { id: string }) => Object.values(catalog).find((i) => i.id === id) ?? null);
  h.toastError.mockClear();
  h.toastSuccess.mockClear();
});

describe("DocumentCreator — update saved prices", () => {
  it("asks once, listing only the item whose rate changed, with every box checked", async () => {
    renderCreator();
    const user = userEvent.setup();
    await pickParty(user);
    await pickItem(user, /steel rod/i);
    await user.click(screen.getByRole("button", { name: /add line item/i }));
    await pickItem(user, /cement bag/i, 1);
    setPrice("1100", 0); // Steel Rod 1000 -> 1100; Cement stays 350

    await save(user);

    const dialog = await screen.findByRole("dialog", { name: /update saved prices/i });
    const rows = within(dialog).getAllByRole("checkbox");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toBeChecked();
    expect(within(dialog).getByText("Steel Rod")).toBeInTheDocument();
    expect(within(dialog).queryByText("Cement Bag")).not.toBeInTheDocument();
    expect(within(dialog).getByText(/₹1,000\.00/)).toBeInTheDocument();
    expect(within(dialog).getByText(/₹1,100\.00/)).toBeInTheDocument();
    // the bill is not saved until the user answers
    expect(h.createCalls).toHaveLength(0);
  });

  it("[Update item prices] saves the bill, then updates the checked prices from that bill", async () => {
    const { onClose } = renderCreator();
    const user = userEvent.setup();
    await pickParty(user);
    await pickItem(user, /steel rod/i);
    setPrice("1100");
    await save(user);

    await user.click(await screen.findByRole("button", { name: "Update item prices" }));

    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    await waitFor(() => expect(h.updateMutate).toHaveBeenCalledTimes(1));
    expect(h.updateMutate).toHaveBeenCalledWith({
      documentId: "inv-1",
      updates: [{ itemId: "item-1", side: "sale", newPrice: "1100.00", priceIncludesTax: false }],
    });
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("Updated 1 item price"));
  });

  it("[Just this bill] saves the bill and changes nothing in the catalog", async () => {
    renderCreator();
    const user = userEvent.setup();
    await pickParty(user);
    await pickItem(user, /steel rod/i);
    setPrice("1100");
    await save(user);

    await user.click(await screen.findByRole("button", { name: "Just this bill" }));

    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect((h.createCalls[0] as { lineItems: Array<{ unitPrice: string }> }).lineItems[0]!.unitPrice).toBe("1100");
    expect(h.updateMutate).not.toHaveBeenCalled();
  });

  it("an unchecked item is not updated, and with nothing checked [Update item prices] is disabled", async () => {
    renderCreator();
    const user = userEvent.setup();
    await pickParty(user);
    await pickItem(user, /steel rod/i);
    await user.click(screen.getByRole("button", { name: /add line item/i }));
    await pickItem(user, /cement bag/i, 1);
    setPrice("1100", 0);
    setPrice("400", 1);
    await save(user);

    const dialog = await screen.findByRole("dialog", { name: /update saved prices/i });
    const boxes = within(dialog).getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    await user.click(boxes[1]!); // uncheck Cement Bag
    await user.click(within(dialog).getByRole("button", { name: "Update item prices" }));

    await waitFor(() => expect(h.updateMutate).toHaveBeenCalledTimes(1));
    expect(h.updateMutate.mock.calls[0]![0].updates.map((u: { itemId: string }) => u.itemId)).toEqual(["item-1"]);
  });

  it("does not prompt when no rate changed", async () => {
    renderCreator();
    const user = userEvent.setup();
    await pickParty(user);
    await pickItem(user, /steel rod/i);
    await save(user);

    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect(screen.queryByRole("dialog", { name: /update saved prices/i })).not.toBeInTheDocument();
    expect(h.updateMutate).not.toHaveBeenCalled();
  });

  it("does not prompt when the rate is edited back to the saved price", async () => {
    renderCreator();
    const user = userEvent.setup();
    await pickParty(user);
    await pickItem(user, /steel rod/i);
    setPrice("1100");
    setPrice("1000");
    await save(user);
    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect(screen.queryByRole("dialog", { name: /update saved prices/i })).not.toBeInTheDocument();
  });

  it("a discount alone never proposes a price: only the rate field counts", async () => {
    renderCreator();
    const user = userEvent.setup();
    await pickParty(user);
    await pickItem(user, /steel rod/i);
    fireEvent.change(screen.getByLabelText("Discount percent"), { target: { value: "10" } });
    await save(user);
    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect(screen.queryByRole("dialog", { name: /update saved prices/i })).not.toBeInTheDocument();
  });

  it("a changed rate on a discounted line proposes the rate, not the discounted net", async () => {
    renderCreator();
    const user = userEvent.setup();
    await pickParty(user);
    await pickItem(user, /steel rod/i);
    fireEvent.change(screen.getByLabelText("Discount percent"), { target: { value: "10" } });
    setPrice("1200");
    await save(user);
    const dialog = await screen.findByRole("dialog", { name: /update saved prices/i });
    expect(within(dialog).getByText(/₹1,200\.00/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/₹1,080\.00/)).not.toBeInTheDocument();
  });

  it("an alternate-unit line proposes that unit's own price, labelled with the unit", async () => {
    renderCreator();
    const user = userEvent.setup();
    await pickParty(user);
    await pickItem(user, /rice basmati/i);
    await user.click(screen.getByRole("radio", { name: /packet/i }));
    setPrice("25");
    await save(user);

    const dialog = await screen.findByRole("dialog", { name: /update saved prices/i });
    expect(within(dialog).getByText("Rice Basmati (packet)")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Update item prices" }));
    await waitFor(() => expect(h.updateMutate).toHaveBeenCalledTimes(1));
    expect(h.updateMutate.mock.calls[0]![0].updates[0]).toMatchObject({ itemId: "item-3", unit: "packet", newPrice: "25.00" });
  });

  it("Esc goes back to the form without saving anything", async () => {
    renderCreator();
    const user = userEvent.setup();
    await pickParty(user);
    await pickItem(user, /steel rod/i);
    setPrice("1100");
    await save(user);
    await screen.findByRole("dialog", { name: /update saved prices/i });

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /update saved prices/i })).not.toBeInTheDocument());
    expect(h.createCalls).toHaveLength(0);
    expect(h.updateMutate).not.toHaveBeenCalled();
    // and the form is still there, with the edited rate
    expect((screen.getByLabelText("Unit price") as HTMLInputElement).value).toBe("1100");
  });

  it("a failing price update never blocks the bill: it is saved, the form closes, and a toast explains", async () => {
    h.updateMutate.mockRejectedValue(new Error("Item not found"));
    const { onClose } = renderCreator();
    const user = userEvent.setup();
    await pickParty(user);
    await pickItem(user, /steel rod/i);
    setPrice("1100");
    await save(user);
    await user.click(await screen.findByRole("button", { name: "Update item prices" }));

    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Bill saved, but item prices were not updated", "Item not found"));
  });

  it("a catalog lookup that fails means no prompt: the bill just saves", async () => {
    h.getById.mockRejectedValue(new Error("network"));
    renderCreator();
    const user = userEvent.setup();
    await pickParty(user);
    await pickItem(user, /steel rod/i);
    setPrice("1100");
    await save(user);
    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect(screen.queryByRole("dialog", { name: /update saved prices/i })).not.toBeInTheDocument();
  });

  describe("who is asked", () => {
    it("a seller (no Item:update) is never prompted: the bill saves exactly as before", async () => {
      h.role.current = "seller";
      renderCreator();
      const user = userEvent.setup();
      await pickParty(user);
      await pickItem(user, /steel rod/i);
      setPrice("1100");
      await save(user);

      await waitFor(() => expect(h.createCalls).toHaveLength(1));
      expect(screen.queryByRole("dialog", { name: /update saved prices/i })).not.toBeInTheDocument();
      expect(h.getById).not.toHaveBeenCalled();
      expect(h.updateMutate).not.toHaveBeenCalled();
    });

    it("a seller_manager (can update items) is prompted", async () => {
      h.role.current = "seller_manager";
      renderCreator();
      const user = userEvent.setup();
      await pickParty(user);
      await pickItem(user, /steel rod/i);
      setPrice("1100");
      await save(user);
      expect(await screen.findByRole("dialog", { name: /update saved prices/i })).toBeInTheDocument();
    });

    it("a purchase bill proposes the purchase price", async () => {
      renderCreator({ invoiceType: "purchase" });
      const user = userEvent.setup();
      await user.click(screen.getByRole("combobox", { name: /supplier/i }));
      await user.click(screen.getByText("Ramesh Traders"));
      await pickItem(user, /steel rod/i);
      setPrice("850");
      await save(user);

      const dialog = await screen.findByRole("dialog", { name: /update saved prices/i });
      expect(within(dialog).getByText(/₹800\.00/)).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Update item prices" }));
      await waitFor(() => expect(h.updateMutate).toHaveBeenCalledTimes(1));
      expect(h.updateMutate.mock.calls[0]![0].updates[0]).toMatchObject({ side: "purchase", newPrice: "850.00" });
    });

    it("a quotation never prompts (an offer, not a price change)", async () => {
      renderCreator({ documentType: "quotation" });
      const user = userEvent.setup();
      await pickParty(user);
      await pickItem(user, /steel rod/i);
      setPrice("1100");
      await save(user, /create quotation/i);

      await waitFor(() => expect(h.quotationCalls).toHaveLength(1));
      expect(screen.queryByRole("dialog", { name: /update saved prices/i })).not.toBeInTheDocument();
      expect(h.getById).not.toHaveBeenCalled();
    });
  });

  describe("editing a saved bill", () => {
    const saved = (unitPrice: string) => ({
      id: "inv-9", partyId: "party-1", invoiceDate: "2026-04-01T00:00:00.000Z", dueDate: null, notes: null, termsAndConditions: null,
      roundOff: "0", discountAmount: "0", charges: [],
      lineItems: [
        { itemId: "item-3", itemName: "Rice Basmati (packet)", description: null, quantity: "2.000", unitPrice, taxPercent: "5.00", discountPercent: "0.00", selectedUnit: "packet", conversionFactor: "0.200000", variantId: null },
      ],
    });

    it("keeps the unit the line was billed in, and does not offer to revert prices the catalog moved on from", async () => {
      // the bill says 18 per packet; the catalog has since moved to 20: untouched, so no prompt
      h.editData.current = saved("18.00");
      renderCreator({ editInvoiceId: "inv-9" });
      const user = userEvent.setup();
      await screen.findByDisplayValue("18.00");
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => expect(h.updateCalls).toHaveLength(1));
      expect(screen.queryByRole("dialog", { name: /update saved prices/i })).not.toBeInTheDocument();
      const line = (h.updateCalls[0] as { lineItems: Array<Record<string, unknown>> }).lineItems[0]!;
      expect(line).toMatchObject({ itemId: "item-3", selectedUnit: "packet", conversionFactor: "0.200000" });
    });

    it("an edited rate on a unit line proposes that unit's price and is applied to the edited bill", async () => {
      h.editData.current = saved("18.00");
      renderCreator({ editInvoiceId: "inv-9" });
      const user = userEvent.setup();
      await screen.findByDisplayValue("18.00");
      setPrice("22");
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      const dialog = await screen.findByRole("dialog", { name: /update saved prices/i });
      expect(within(dialog).getByText("Rice Basmati (packet)")).toBeInTheDocument();
      expect(within(dialog).getByText(/₹20\.00/)).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Update item prices" }));
      await waitFor(() => expect(h.updateMutate).toHaveBeenCalledTimes(1));
      expect(h.updateMutate).toHaveBeenCalledWith({
        documentId: "inv-1", // what the (mocked) update call returned
        updates: [{ itemId: "item-3", unit: "packet", side: "sale", newPrice: "22.00", priceIncludesTax: false }],
      });
    });
  });
});

describe("DocumentCreator: items whose sale price includes GST are billed at the tax-exclusive rate", () => {
  const hint = () => screen.queryByTestId("inclusive-hint");

  it("picking ₹118 incl. 18% starts the line at 100.00 (not 118 + 21.24 = 139.24), with the derivation shown", async () => {
    renderCreator();
    const user = userEvent.setup();
    await pickParty(user);
    await pickItem(user, /atta inclusive/i);

    expect((screen.getByLabelText("Unit price") as HTMLInputElement).value).toBe("100.00");
    expect(hint()).toHaveTextContent("₹118.00 incl. GST → ₹100.00 + ₹18.00");
    // 100.00 + 18.00 GST = 118.00 (the saved price), so the form's amount is the shelf price
    expect(screen.getAllByText("₹118.00").length).toBeGreaterThan(0);
    expect(screen.queryByText("₹139.24")).not.toBeInTheDocument();

    await save(user);
    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect((h.createCalls[0] as { lineItems: Array<{ unitPrice: string; taxPercent: string }> }).lineItems[0]).toMatchObject({ unitPrice: "100.00", taxPercent: "18.00" });
  });

  it("quantity 2 bills 2 x 100.00 + 36.00 = 236.00", async () => {
    renderCreator();
    const user = userEvent.setup();
    await pickParty(user);
    await pickItem(user, /atta inclusive/i);
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "2" } });
    expect(screen.getAllByText("₹236.00").length).toBeGreaterThan(0);
  });

  it("editing the GST % keeps the shelf price: 18% -> 12% re-derives 105.36 + 12.64 = 118.00 (rounded to the paisa)", async () => {
    renderCreator();
    const user = userEvent.setup();
    await pickParty(user);
    await pickItem(user, /atta inclusive/i);

    fireEvent.change(screen.getByLabelText("Tax percent"), { target: { value: "12" } });

    expect((screen.getByLabelText("Unit price") as HTMLInputElement).value).toBe("105.36");
    expect(hint()).toHaveTextContent("₹118.00 incl. GST → ₹105.36 + ₹12.64");
    // and it is not a price edit: no prompt on save
    await save(user);
    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect(screen.queryByRole("dialog", { name: /update saved prices/i })).not.toBeInTheDocument();
  });

  it("typing the rate states the exclusive rate yourself: the hint goes and a later GST edit leaves it alone", async () => {
    renderCreator();
    const user = userEvent.setup();
    await pickParty(user);
    await pickItem(user, /atta inclusive/i);
    setPrice("110");
    expect(hint()).toBeNull();
    fireEvent.change(screen.getByLabelText("Tax percent"), { target: { value: "12" } });
    expect((screen.getByLabelText("Unit price") as HTMLInputElement).value).toBe("110");
  });

  it("a typed rate is proposed back as the INCLUSIVE price: 105.00 + 18% = 123.90, labelled incl. GST", async () => {
    renderCreator();
    const user = userEvent.setup();
    await pickParty(user);
    await pickItem(user, /atta inclusive/i);
    setPrice("105");
    await save(user);

    const dialog = await screen.findByRole("dialog", { name: /update saved prices/i });
    expect(within(dialog).getByText(/₹118\.00/)).toBeInTheDocument();
    expect(within(dialog).getByText(/₹123\.90/)).toBeInTheDocument();
    expect(within(dialog).getByText("incl. GST")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Update item prices" }));
    await waitFor(() => expect(h.updateMutate).toHaveBeenCalledTimes(1));
    expect(h.updateMutate.mock.calls[0]![0].updates[0]).toMatchObject({ itemId: "item-4", side: "sale", newPrice: "123.90", priceIncludesTax: true });
  });

  it("an untouched inclusive line proposes nothing: the bill rate 100.00 is the saved 118.00, not a price cut", async () => {
    renderCreator();
    const user = userEvent.setup();
    await pickParty(user);
    await pickItem(user, /atta inclusive/i);
    await save(user);
    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect(screen.queryByRole("dialog", { name: /update saved prices/i })).not.toBeInTheDocument();
  });

  it("an alternate unit is converted too: the 5-unit box at ₹590.00 incl. 18% is 500.00", async () => {
    renderCreator();
    const user = userEvent.setup();
    await pickParty(user);
    await pickItem(user, /box inclusive/i);
    expect((screen.getByLabelText("Unit price") as HTMLInputElement).value).toBe("100.00");
    await user.click(screen.getByRole("radio", { name: /box/i }));
    expect((screen.getByLabelText("Unit price") as HTMLInputElement).value).toBe("500.00");
    expect(hint()).toHaveTextContent("₹590.00 incl. GST → ₹500.00 + ₹90.00");
  });

  it("the purchase side is never converted: the purchase price 90.00 goes on the bill as it is", async () => {
    renderCreator({ invoiceType: "purchase" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: /supplier/i }));
    await user.click(screen.getByText("Ramesh Traders"));
    await pickItem(user, /atta inclusive/i);
    expect((screen.getByLabelText("Unit price") as HTMLInputElement).value).toBe("90.00");
    expect(hint()).toBeNull();
  });

  it.each([
    ["invoice", "sale", "100.00"],
    ["quotation", "sale", "100.00"],
    ["proforma", "sale", "100.00"],
    ["delivery_challan", "sale", "100.00"],
    ["credit_note", "sale", "100.00"],
    ["sales_return", "sale", "100.00"],
    // purchase-side documents use the (tax-exclusive) purchase price
    ["invoice", "purchase", "90.00"],
    ["debit_note", "purchase", "90.00"],
    ["purchase_return", "purchase", "90.00"],
  ] as const)("%s (%s): an inclusive item starts at %s", async (documentType, invoiceType, rate) => {
    renderCreator({ documentType, invoiceType });
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: invoiceType === "sale" ? /customer/i : /supplier/i }));
    await user.click(screen.getByText("Ramesh Traders"));
    await pickItem(user, /atta inclusive/i);
    expect((screen.getByLabelText("Unit price") as HTMLInputElement).value).toBe(rate);
  });
});
