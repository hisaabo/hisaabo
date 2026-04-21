import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ─── tRPC mock surface ────────────────────────────────────────────────────────
// vi.mock factories are hoisted, so we use vi.hoisted() to define shared stubs
// that are available inside the factory closure.

const { updateMutate, updateSeqMutate, invalidateStub } = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  updateSeqMutate: vi.fn(),
  invalidateStub: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    business: {
      update: {
        // The component calls useMutation twice — once for prefixes, once for
        // defaults. Both share the same captured mutate fn so we can assert
        // on either call. onSuccess is NOT called automatically so the
        // component's post-save state transitions don't fire during tests.
        useMutation: (_opts?: { onSuccess?: () => void; onError?: (err: any) => void }) => ({
          mutate: updateMutate,
          isPending: false,
        }),
      },
      updateSequenceNumber: {
        useMutation: (_opts?: { onSuccess?: () => void; onError?: (err: any) => void }) => ({
          mutate: updateSeqMutate,
          isPending: false,
        }),
      },
    },
    useUtils: () => ({
      business: {
        list: { invalidate: invalidateStub },
      },
    }),
  },
}));

vi.mock("@/hooks/useToast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { DocumentsTab } from "../DocumentsTab";
import { toast } from "@/hooks/useToast";

// ─── Shared test fixture ──────────────────────────────────────────────────────

const baseBiz = {
  id: "biz-1",
  invoicePrefix: "",
  nextInvoiceNumber: 1,
  paymentPrefix: "",
  nextPaymentNumber: 1,
  quotationPrefix: "",
  nextQuotationNumber: 1,
  creditNotePrefix: "",
  nextCreditNoteNumber: 1,
  deliveryChallanPrefix: "",
  nextDeliveryChallanNumber: 1,
  proformaPrefix: "",
  nextProformaNumber: 1,
  defaultRoundOff: false,
  defaultTermsAndConditions: "",
};

function renderTab(biz = baseBiz) {
  return render(<DocumentsTab biz={biz} />);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DocumentsTab — Document Prefixes card", () => {
  beforeEach(() => {
    updateMutate.mockClear();
    updateSeqMutate.mockClear();
    invalidateStub.mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it("Save button is NOT visible initially when no changes have been made", () => {
    renderTab();
    // The prefixes Save button is conditionally rendered only when prefixesDirty
    // is true. With a pristine biz, it must be absent.
    const saveButtons = screen.queryAllByRole("button", { name: /^save$/i });
    expect(saveButtons).toHaveLength(0);
  });

  it("typing into an invoice prefix input reveals the prefixes Save button", () => {
    renderTab();
    const inputs = screen.getAllByPlaceholderText("e.g. INV");
    // First input is Invoice row
    fireEvent.change(inputs[0], { target: { value: "INV" } });
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });

  it("typed lowercase value is displayed uppercased in the input", () => {
    renderTab();
    const inputs = screen.getAllByPlaceholderText("e.g. INV");
    fireEvent.change(inputs[0], { target: { value: "inv" } });
    expect((inputs[0] as HTMLInputElement).value).toBe("INV");
  });

  it("clicking Save calls business.update mutate with prefix fields and the biz id", () => {
    renderTab();
    const inputs = screen.getAllByPlaceholderText("e.g. INV");
    fireEvent.change(inputs[0], { target: { value: "INV" } });

    const saveButton = screen.getByRole("button", { name: /^save$/i });
    fireEvent.click(saveButton);

    expect(updateMutate).toHaveBeenCalledTimes(1);
    const callArg = updateMutate.mock.calls[0][0] as any;
    expect(callArg.id).toBe("biz-1");
    // All six prefix fields should be in data
    expect(callArg.data).toHaveProperty("invoicePrefix");
    expect(callArg.data).toHaveProperty("paymentPrefix");
    expect(callArg.data).toHaveProperty("quotationPrefix");
    expect(callArg.data).toHaveProperty("creditNotePrefix");
    expect(callArg.data).toHaveProperty("deliveryChallanPrefix");
    expect(callArg.data).toHaveProperty("proformaPrefix");
    // The typed prefix should be uppercased
    expect(callArg.data.invoicePrefix).toBe("INV");
  });
});

describe("DocumentsTab — SequenceEditor", () => {
  beforeEach(() => {
    updateMutate.mockClear();
    updateSeqMutate.mockClear();
    invalidateStub.mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  function getChangeButtons() {
    return screen.getAllByRole("button", { name: /^change$/i });
  }

  it("clicking Change on the Invoice row reveals the warning panel", () => {
    renderTab();
    const changeButtons = getChangeButtons();
    fireEvent.click(changeButtons[0]); // Invoice row is first
    // The warning text is inside a <p> inside the SequenceEditor amber panel.
    // Use getAllByText and check at least one contains the expected phrase.
    const warningEl = screen.getByText(
      /changing the sequence number for/i
    );
    expect(warningEl).toBeInTheDocument();
    // The label name ("Invoice") appears in a <strong> inside the warning text.
    expect(warningEl.querySelector("strong")?.textContent).toBe("Invoice");
  });

  it("entering 100 and confirming calls updateSequenceNumber mutate with newNumber: 100", () => {
    renderTab();
    fireEvent.click(getChangeButtons()[0]);

    const numberInput = screen.getByLabelText(/next number/i) as HTMLInputElement;
    fireEvent.change(numberInput, { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm change/i }));

    expect(updateSeqMutate).toHaveBeenCalledTimes(1);
    const arg = updateSeqMutate.mock.calls[0][0] as any;
    expect(arg.documentType).toBe("invoice");
    expect(arg.newNumber).toBe(100);
  });

  it("entering 0 and confirming sends newNumber: 1 (clamped to min 1)", () => {
    renderTab();
    fireEvent.click(getChangeButtons()[0]);

    const numberInput = screen.getByLabelText(/next number/i) as HTMLInputElement;
    fireEvent.change(numberInput, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm change/i }));

    expect(updateSeqMutate).toHaveBeenCalledTimes(1);
    expect((updateSeqMutate.mock.calls[0][0] as any).newNumber).toBe(1);
  });

  it("clicking Cancel hides the editor without calling the mutate", () => {
    renderTab();
    fireEvent.click(getChangeButtons()[0]);

    // Panel should be visible
    expect(screen.getByRole("button", { name: /confirm change/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(updateSeqMutate).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /confirm change/i })).not.toBeInTheDocument();
  });
});

describe("DocumentsTab — Document Defaults card", () => {
  beforeEach(() => {
    updateMutate.mockClear();
    updateSeqMutate.mockClear();
    invalidateStub.mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it("Save button is NOT visible initially when biz has no pending defaults changes", () => {
    renderTab({ ...baseBiz, defaultRoundOff: true, defaultTermsAndConditions: "" });
    // No save buttons at all initially
    expect(screen.queryAllByRole("button", { name: /^save$/i })).toHaveLength(0);
  });

  it("round-off toggle renders aria-checked=true when defaultRoundOff is true", () => {
    renderTab({ ...baseBiz, defaultRoundOff: true });
    const toggle = screen.getByRole("switch", { name: /round totals down by default/i });
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("round-off toggle renders aria-checked=false when defaultRoundOff is false", () => {
    renderTab({ ...baseBiz, defaultRoundOff: false });
    const toggle = screen.getByRole("switch", { name: /round totals down by default/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("clicking the toggle flips aria-checked AND reveals the defaults Save button", () => {
    renderTab({ ...baseBiz, defaultRoundOff: false });
    const toggle = screen.getByRole("switch", { name: /round totals down by default/i });

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });

  it("typing in T&C textarea updates the character counter live", () => {
    renderTab();
    const textarea = screen.getByLabelText(/standard terms/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "abc" } });
    expect(screen.getByText("3 / 2000")).toBeInTheDocument();
  });

  it("clicking defaults Save calls business.update mutate with defaultRoundOff and defaultTermsAndConditions", () => {
    renderTab({ ...baseBiz, defaultRoundOff: false, defaultTermsAndConditions: "" });

    // Flip the toggle to dirty the defaults section
    const toggle = screen.getByRole("switch", { name: /round totals down by default/i });
    fireEvent.click(toggle);

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    const arg = updateMutate.mock.calls[0][0] as any;
    expect(arg.id).toBe("biz-1");
    expect(arg.data).toHaveProperty("defaultRoundOff", true);
    expect(arg.data).toHaveProperty("defaultTermsAndConditions", null); // empty → null
  });

  it("empty/whitespace T&C becomes null in the save payload", () => {
    renderTab();
    const textarea = screen.getByLabelText(/standard terms/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "   " } });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    const arg = updateMutate.mock.calls[0][0] as any;
    expect(arg.data.defaultTermsAndConditions).toBeNull();
  });

  it("prefixes and defaults have INDEPENDENT dirty state — typing prefix must NOT reveal defaults Save", () => {
    renderTab();

    // Type into the Invoice prefix input
    const prefixInputs = screen.getAllByPlaceholderText("e.g. INV");
    fireEvent.change(prefixInputs[0], { target: { value: "INV" } });

    // One Save button appears (for prefixes), but the defaults section Save must NOT appear
    const saveButtons = screen.getAllByRole("button", { name: /^save$/i });
    expect(saveButtons).toHaveLength(1);

    // Verify no defaults save by checking there's no second Save in the defaults card.
    // The one Save that exists must be inside the prefixes card (heading text nearby).
    expect(screen.getByText("Document Prefixes")).toBeInTheDocument();
    expect(screen.queryByText("Document Defaults")).toBeInTheDocument();
    // Only one Save button total — not two
    expect(saveButtons).toHaveLength(1);
  });
});
