/**
 * DocumentCreator — Bug B (Stage 3) + Bug C (Stage 4)
 *
 * These tests cover:
 *
 * Bug B — itemName / description split:
 *   - `itemName` is populated from `product.name` when an item is picked,
 *     and frozen on the invoice line so later renames don't rewrite
 *     historical invoices.
 *   - `description` carries the user's free-text notes. Empty or
 *     whitespace-only notes become `undefined` so the backend keeps the
 *     column NULL instead of persisting "".
 *
 * Bug C — AltUnitSelector pill row:
 *   - Items with `itemMode === "alt_units"` and at least one unitVariant
 *     get a horizontal pill row below the product combobox.
 *   - Clicking a variant pill swaps `unitPrice` and stores `conversionFactor`.
 *   - Clicking the base-unit pill reverts to base price and clears CF.
 *   - Submission payload carries the stored `conversionFactor` directly
 *     (no longer derived dynamically from `availableUnits`).
 *
 * tRPC is mocked so the tests run without a real API server.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ─── tRPC mock surface ────────────────────────────────────────────────────

// vi.mock factories are hoisted to the top of the file, so we can't
// reference normal top-level vars inside them. vi.hoisted() is the
// official escape hatch — it runs BEFORE the hoisted factories so the
// references are available at mock-initialisation time.
const { invoiceCreateMutate, quotationCreateMutate, invalidateStub } =
  vi.hoisted(() => ({
    invoiceCreateMutate: vi.fn(),
    quotationCreateMutate: vi.fn(),
    invalidateStub: vi.fn(),
  }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    party: {
      list: {
        useQuery: () => ({
          data: {
            data: [
              {
                id: "party-1",
                name: "Ramesh Traders",
                type: "customer",
                creditPeriodDays: 7,
              },
            ],
          },
          isFetching: false,
        }),
      },
    },
    item: {
      list: {
        useQuery: () => ({
          data: {
            data: [
              {
                id: "item-1",
                name: "Steel Rod",
                salePrice: "1000",
                purchasePrice: "800",
                taxPercent: "18",
                itemMode: "standard",
                unit: "kg",
                unitVariants: [],
              },
              {
                id: "item-2",
                name: "Cement Bag",
                salePrice: "350",
                purchasePrice: "300",
                taxPercent: "5",
                itemMode: "standard",
                unit: "bag",
                unitVariants: [],
              },
              {
                id: "item-3",
                name: "Rice Basmati",
                salePrice: "100",
                purchasePrice: "80",
                taxPercent: "5",
                itemMode: "alt_units",
                unit: "kg",
                unitVariants: [
                  { unit: "packet", conversionFactor: 0.2, salePrice: "20" },
                ],
              },
            ],
          },
          isFetching: false,
        }),
      },
    },
    invoice: {
      create: {
        useMutation: () => ({ mutate: invoiceCreateMutate, isPending: false }),
      },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      getById: {
        useQuery: () => ({ data: null }),
      },
      list: { invalidate: invalidateStub },
    },
    quotation: {
      create: {
        useMutation: () => ({ mutate: quotationCreateMutate, isPending: false }),
      },
      list: { invalidate: invalidateStub },
    },
    creditNote: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      list: { invalidate: invalidateStub },
    },
    debitNote: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      list: { invalidate: invalidateStub },
    },
    deliveryChallan: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      list: { invalidate: invalidateStub },
    },
    proforma: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      list: { invalidate: invalidateStub },
    },
    salesReturn: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      list: { invalidate: invalidateStub },
    },
    purchaseReturn: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      list: { invalidate: invalidateStub },
    },
    dashboard: {
      summary: { invalidate: invalidateStub },
      shippingSummary: { invalidate: invalidateStub },
    },
    useUtils: () => ({
      invoice: {
        list: { invalidate: invalidateStub },
        getById: { invalidate: invalidateStub },
      },
      quotation: { list: { invalidate: invalidateStub } },
      creditNote: { list: { invalidate: invalidateStub } },
      debitNote: { list: { invalidate: invalidateStub } },
      deliveryChallan: { list: { invalidate: invalidateStub } },
      proforma: { list: { invalidate: invalidateStub } },
      salesReturn: { list: { invalidate: invalidateStub } },
      purchaseReturn: { list: { invalidate: invalidateStub } },
      dashboard: {
        summary: { invalidate: invalidateStub },
        shippingSummary: { invalidate: invalidateStub },
      },
      item: { list: { invalidate: invalidateStub } },
    }),
  },
}));

vi.mock("@/hooks/useToast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after the mocks so the component picks up the stubbed trpc.
import { DocumentCreator } from "../DocumentCreator";
import { toast } from "@/hooks/useToast";

function renderCreator(props: Partial<React.ComponentProps<typeof DocumentCreator>> = {}) {
  return render(
    <DocumentCreator
      documentType="invoice"
      invoiceType="sale"
      onClose={vi.fn()}
      {...props}
    />
  );
}

function getFirstItemNameInput() {
  return screen.getAllByPlaceholderText("Item name *")[0] as HTMLInputElement;
}

function getFirstNotesTextarea() {
  return screen.getAllByPlaceholderText(
    "Notes for this line (optional)"
  )[0] as HTMLTextAreaElement;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("DocumentCreator — Bug B itemName / description split", () => {
  beforeEach(() => {
    invoiceCreateMutate.mockClear();
    quotationCreateMutate.mockClear();
    invalidateStub.mockClear();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
  });

  describe("form structure", () => {
    it("renders a line item row with an item-name input and a notes textarea — they are separate controls", () => {
      renderCreator();

      // The item name input is the primary bold field on each line.
      expect(
        screen.getAllByPlaceholderText("Item name *").length
      ).toBeGreaterThan(0);

      // The notes textarea is a separate control, below the qty/price grid.
      const notes = screen.getAllByPlaceholderText("Notes for this line (optional)");
      expect(notes.length).toBeGreaterThan(0);
      // The notes control is a <textarea> so users can enter multi-line
      // comments. A single-line <input> would be wrong for this UX.
      expect(notes[0].tagName).toBe("TEXTAREA");
    });
  });

  describe("item pick — sets itemName, leaves notes empty", () => {
    it("typing into the item-name field updates the line's itemName state (smoke test for rename from description)", () => {
      renderCreator();

      const nameInput = getFirstItemNameInput();
      fireEvent.change(nameInput, { target: { value: "Custom steel pipe" } });

      expect(nameInput.value).toBe("Custom steel pipe");

      // Notes should still be blank — the two fields are independent.
      const notesInput = getFirstNotesTextarea();
      expect(notesInput.value).toBe("");
    });
  });

  describe("notes input behaviour", () => {
    it("typing into the notes textarea updates only the notes state, not the item name", () => {
      renderCreator();

      const nameInput = getFirstItemNameInput();
      const notesInput = getFirstNotesTextarea();

      fireEvent.change(nameInput, { target: { value: "Steel Rod" } });
      fireEvent.change(notesInput, {
        target: { value: "Keep separate from order #42" },
      });

      expect(nameInput.value).toBe("Steel Rod");
      expect(notesInput.value).toBe("Keep separate from order #42");
    });

    it("shows a 500-char counter once the notes exceed 400 characters (soft warning zone)", () => {
      renderCreator();

      const notesInput = getFirstNotesTextarea();

      // Under 400: no counter visible.
      fireEvent.change(notesInput, { target: { value: "a".repeat(100) } });
      expect(screen.queryByText(/\/ 500/)).not.toBeInTheDocument();

      // Above 400: counter appears.
      fireEvent.change(notesInput, { target: { value: "a".repeat(450) } });
      expect(screen.getByText("450 / 500")).toBeInTheDocument();
    });

    it("the notes textarea enforces a 500-character maximum via the browser-native maxLength attribute", () => {
      renderCreator();
      const notesInput = getFirstNotesTextarea();
      expect(notesInput.maxLength).toBe(500);
    });
  });

  describe("submission payload — itemName is always sent, description is conditional", () => {
    /**
     * Fills the minimum required fields (party + item name + unit price)
     * so handleSubmit can complete. The party picker is a Combobox — we
     * drive it by typing and picking the option; failing that, we manually
     * dispatch a change to the underlying state via clicking the option.
     */
    async function primeMinimalInvoice({
      itemName,
      notes,
    }: {
      itemName: string;
      notes?: string;
    }) {
      // Pick the party via the combobox.
      const user = userEvent.setup();
      const partyCombobox = screen.getByRole("combobox", { name: /customer/i });
      await user.click(partyCombobox);
      await user.click(screen.getByText("Ramesh Traders"));

      // Fill the item-name and unit price.
      const nameInput = getFirstItemNameInput();
      fireEvent.change(nameInput, { target: { value: itemName } });

      const priceInputs = screen.getAllByLabelText("Unit price");
      fireEvent.change(priceInputs[0], { target: { value: "500" } });

      if (notes !== undefined) {
        const notesInput = getFirstNotesTextarea();
        fireEvent.change(notesInput, { target: { value: notes } });
      }
    }

    it("sends the trimmed itemName and the trimmed description when notes are provided", async () => {
      renderCreator();

      await primeMinimalInvoice({
        itemName: "Steel Rod",
        notes: "Keep separate from order #42",
      });

      const submit = screen.getByRole("button", { name: /create invoice/i });
      await userEvent.setup().click(submit);

      await waitFor(() => {
        expect(invoiceCreateMutate).toHaveBeenCalledTimes(1);
      });

      const payload = invoiceCreateMutate.mock.calls[0][0];
      expect(payload.lineItems).toHaveLength(1);
      expect(payload.lineItems[0].itemName).toBe("Steel Rod");
      expect(payload.lineItems[0].description).toBe(
        "Keep separate from order #42"
      );
    });

    it("omits description (sends undefined) when notes are empty so the DB column stays NULL", async () => {
      renderCreator();

      await primeMinimalInvoice({
        itemName: "Steel Rod",
        // notes intentionally not set
      });

      const submit = screen.getByRole("button", { name: /create invoice/i });
      await userEvent.setup().click(submit);

      await waitFor(() => {
        expect(invoiceCreateMutate).toHaveBeenCalledTimes(1);
      });

      const payload = invoiceCreateMutate.mock.calls[0][0];
      expect(payload.lineItems[0].itemName).toBe("Steel Rod");
      // Whether it's omitted entirely or set to undefined, the validator
      // (optional().nullable()) accepts both. What we MUST NOT send is an
      // empty string — that would be a regression that persists "" in the
      // DB column and shows an italic blank line on the PDF.
      expect(payload.lineItems[0].description).toBeUndefined();
    });

    it("omits description when notes are only whitespace — the trim() guard keeps whitespace-only garbage out of the DB", async () => {
      renderCreator();

      await primeMinimalInvoice({
        itemName: "Steel Rod",
        notes: "   \n\t  ",
      });

      const submit = screen.getByRole("button", { name: /create invoice/i });
      await userEvent.setup().click(submit);

      await waitFor(() => {
        expect(invoiceCreateMutate).toHaveBeenCalledTimes(1);
      });

      const payload = invoiceCreateMutate.mock.calls[0][0];
      expect(payload.lineItems[0].description).toBeUndefined();
    });

    it("refuses to submit when the item name is empty — no mutate fires, user gets a toast error", async () => {
      renderCreator();

      // Pick the party so the "no party" branch doesn't short-circuit first.
      const user = userEvent.setup();
      const partyCombobox = screen.getByRole("combobox", { name: /customer/i });
      await user.click(partyCombobox);
      await user.click(screen.getByText("Ramesh Traders"));

      // Set a price but leave item name empty.
      const priceInputs = screen.getAllByLabelText("Unit price");
      fireEvent.change(priceInputs[0], { target: { value: "500" } });

      const submit = screen.getByRole("button", { name: /create invoice/i });
      await user.click(submit);

      expect(invoiceCreateMutate).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalled();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug C — AltUnitSelector pill row
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Selects "Rice Basmati" (item-3, an alt_units item) from the first line's
 * product combobox by clicking it open and choosing the option.
 *
 * The product Combobox has no label prop so we find it via placeholder text
 * (which maps to the underlying input's placeholder attribute).
 */
async function selectRiceBasmati() {
  const user = userEvent.setup();
  // The product Combobox uses placeholder="Select product or custom item".
  const combobox = screen.getByPlaceholderText("Select product or custom item");
  await user.click(combobox);
  // The Combobox renders matching options in a listbox; find the Rice option.
  const option = await screen.findByRole("option", { name: /rice basmati/i });
  await user.click(option);
  return user;
}

describe("DocumentCreator — Bug C AltUnitSelector pill row", () => {
  beforeEach(() => {
    invoiceCreateMutate.mockClear();
    invalidateStub.mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it("renders pill row for an item with alt units", async () => {
    renderCreator();
    await selectRiceBasmati();

    const radiogroup = await screen.findByRole("radiogroup", { name: /select unit/i });
    expect(radiogroup).toBeInTheDocument();
    const pills = screen.getAllByRole("radio");
    expect(pills.length).toBe(2); // KG (base) + PACKET (variant)
  });

  it("each pill shows unit name and price", async () => {
    renderCreator();
    await selectRiceBasmati();

    // Base unit pill
    const kgPill = await screen.findByRole("radio", { name: /KG/i });
    expect(kgPill).toBeInTheDocument();
    expect(kgPill.textContent).toMatch(/KG/i);
    expect(kgPill.textContent).toMatch(/100/);

    // Variant pill
    const packetPill = screen.getByRole("radio", { name: /PACKET/i });
    expect(packetPill.textContent).toMatch(/PACKET/i);
    expect(packetPill.textContent).toMatch(/20/);
  });

  it("base unit pill is selected by default (aria-checked=true)", async () => {
    renderCreator();
    await selectRiceBasmati();

    const kgPill = await screen.findByRole("radio", { name: /KG/i });
    expect(kgPill).toHaveAttribute("aria-checked", "true");

    const packetPill = screen.getByRole("radio", { name: /PACKET/i });
    expect(packetPill).toHaveAttribute("aria-checked", "false");
  });

  it("clicking a variant pill swaps the unit price input to the variant price", async () => {
    renderCreator();
    const user = await selectRiceBasmati();

    // Initially price should be ₹100 (base)
    const priceInput = screen.getAllByLabelText("Unit price")[0] as HTMLInputElement;
    expect(priceInput.value).toBe("100");

    // Click the PACKET pill
    const packetPill = await screen.findByRole("radio", { name: /PACKET/i });
    await user.click(packetPill);

    expect(priceInput.value).toBe("20");
  });

  it("clicking a variant pill marks it as selected (aria-checked=true) and deselects base", async () => {
    renderCreator();
    const user = await selectRiceBasmati();

    const packetPill = await screen.findByRole("radio", { name: /PACKET/i });
    await user.click(packetPill);

    expect(packetPill).toHaveAttribute("aria-checked", "true");
    const kgPill = screen.getByRole("radio", { name: /KG/i });
    expect(kgPill).toHaveAttribute("aria-checked", "false");
  });

  it("clicking base-unit pill after a variant reverts price to base price", async () => {
    renderCreator();
    const user = await selectRiceBasmati();

    // Select variant first
    const packetPill = await screen.findByRole("radio", { name: /PACKET/i });
    await user.click(packetPill);

    const priceInput = screen.getAllByLabelText("Unit price")[0] as HTMLInputElement;
    expect(priceInput.value).toBe("20");

    // Revert to base
    const kgPill = screen.getByRole("radio", { name: /KG/i });
    await user.click(kgPill);

    expect(priceInput.value).toBe("100");
  });

  it("submission payload carries conversionFactor from stored state (not derived)", async () => {
    renderCreator();
    const user = await selectRiceBasmati();

    // Pick the party
    const partyCombobox = screen.getByRole("combobox", { name: /customer/i });
    await user.click(partyCombobox);
    await user.click(screen.getByText("Ramesh Traders"));

    // Select PACKET variant
    const packetPill = await screen.findByRole("radio", { name: /PACKET/i });
    await user.click(packetPill);

    const submit = screen.getByRole("button", { name: /create invoice/i });
    await user.click(submit);

    await waitFor(() => {
      expect(invoiceCreateMutate).toHaveBeenCalledTimes(1);
    });

    const payload = invoiceCreateMutate.mock.calls[0][0];
    expect(payload.lineItems[0].selectedUnit).toBe("packet");
    expect(payload.lineItems[0].conversionFactor).toBe("0.2");
  });

  it("submission payload has no conversionFactor when base unit is selected", async () => {
    renderCreator();
    const user = await selectRiceBasmati();

    // Pick the party
    const partyCombobox = screen.getByRole("combobox", { name: /customer/i });
    await user.click(partyCombobox);
    await user.click(screen.getByText("Ramesh Traders"));

    // Leave on base unit (default after item pick)
    const submit = screen.getByRole("button", { name: /create invoice/i });
    await user.click(submit);

    await waitFor(() => {
      expect(invoiceCreateMutate).toHaveBeenCalledTimes(1);
    });

    const payload = invoiceCreateMutate.mock.calls[0][0];
    expect(payload.lineItems[0].conversionFactor).toBeUndefined();
    expect(payload.lineItems[0].selectedUnit).toBeUndefined();
  });

  it("no pill row rendered for a single-unit item (Steel Rod)", async () => {
    renderCreator();
    const user = userEvent.setup();

    // Select Steel Rod (standard, no unitVariants)
    const combobox = screen.getByPlaceholderText("Select product or custom item");
    await user.click(combobox);
    const option = await screen.findByRole("option", { name: /steel rod/i });
    await user.click(option);

    // No radiogroup should appear
    expect(screen.queryByRole("radiogroup", { name: /select unit/i })).not.toBeInTheDocument();
  });
});
