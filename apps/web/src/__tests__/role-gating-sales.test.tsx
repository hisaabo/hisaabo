/**
 * Role gating — sales-side pages and components (invoices, documents,
 * parties, payments, expenses, recurring invoices, shipments, store orders,
 * dashboard, and the shared creators/panels they open).
 *
 * Each test renders the REAL page/component with the shared boundary stubs
 * (tRPC + router, see test-utils/trpc-stub.tsx) and checks that every control
 * which triggers a data-changing API call is present for a role the API
 * allows and absent for a role it rejects. The permission each control needs
 * is the one the API router checks (requireCan) for the mutation it calls.
 *
 * Roles (packages/shared/src/permissions.ts):
 *   seller_manager — Invoice CRUD, Party/Item C-R-U, Payment C-R-U, Store C-R-U,
 *                    RecurringInvoice CRUD, read Expense
 *   seller         — Invoice C-R-U, Party C-R, read Item, Payment C-R-U,
 *                    read Store / RecurringInvoice
 *   accountant     — Payment C-R-U, Expense CRUD, read Invoice/Party/Item/Store/RecurringInvoice
 *   "unrecognised_role" — no grants (every real role has create/update:Payment)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";

// ── Boundary stubs (tRPC network + router navigation) ──────────────────────
// The shared stub's useQuery has no `isSuccess`; React Query sets it whenever
// data is present. SmartAssignBanner (payments) keys its on-mount write off
// it, so this file adds the flag on top of the shared stub (unchanged).
vi.mock("@/lib/trpc", async () => {
  const { trpcModule } = await import("@/test-utils/trpc-stub");
  const wrap = (target: object): unknown =>
    new Proxy(target, {
      get(t, prop) {
        if (prop === "then") return undefined;
        const value = (t as Record<PropertyKey, unknown>)[prop];
        if (prop === "useQuery") {
          return (...args: unknown[]) => {
            const result = (value as (...a: unknown[]) => { data: unknown })(...args);
            return { ...result, isSuccess: result.data !== undefined };
          };
        }
        return value !== null && (typeof value === "object" || typeof value === "function")
          ? wrap(value as object)
          : value;
      },
    });
  return { ...trpcModule, trpc: wrap(trpcModule.trpc as object) };
});
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("@/test-utils/trpc-stub")).routerOverrides,
}));

import { stub } from "@/test-utils/trpc-stub";

// ── Real implementations under test ────────────────────────────────────────

import { Route as InvoicesRoute } from "@/routes/invoices";
import { Route as PartiesRoute } from "@/routes/parties";
import { Route as PaymentsRoute } from "@/routes/payments";
import { Route as ExpensesRoute } from "@/routes/expenses";
import { Route as AutomatedInvoicesRoute } from "@/routes/automated-invoices";
import { Route as ShipmentsRoute } from "@/routes/shipments";
import { Route as StoreOrdersRoute } from "@/routes/store-orders";
import { Route as DashboardRoute } from "@/routes/index";
import { DocumentListPage, type DocumentListPageConfig } from "@/components/DocumentListPage";
import { DocumentCreator } from "@/components/DocumentCreator";
import { RecordPaymentPanel } from "@/components/RecordPaymentPanel";

const page = (route: { options: { component?: unknown } }) => route.options.component as ComponentType;

function renderAs(role: string | null, Page: ComponentType) {
  stub.session.role = role;
  return render(<Page />);
}

beforeEach(() => stub.reset());

const button = (name: string | RegExp) => screen.queryByRole("button", { name });
const labelled = (label: string) => screen.queryByLabelText(label);
const buttons = (name: string | RegExp) => screen.queryAllByRole("button", { name });
const dialog = (name: string | RegExp) => screen.queryByRole("dialog", { name });
const pressN = () => fireEvent.keyDown(document.body, { key: "n" });

// ═══════════════════════════════════════════════════════════════════════════
// Invoices — create / update:Invoice, create:Payment, shipments
// ═══════════════════════════════════════════════════════════════════════════

describe("Invoices page", () => {
  const Invoices = page(InvoicesRoute);

  function invoice(overrides: Record<string, unknown> = {}) {
    return {
      id: "inv-1", invoiceNumber: "INV-001", type: "sale", status: "draft",
      partyId: "p1", partyName: "Acme Traders", party: { id: "p1", name: "Acme Traders" },
      invoiceDate: new Date().toISOString(), dueDate: null,
      createdAt: new Date().toISOString(),
      subtotal: "100.00", taxAmount: "18.00", discountAmount: "0", totalAmount: "118.00",
      amountPaid: "0", totalAdjusted: "0", roundOff: "0",
      lineItems: [], relatedDocuments: [],
      ...overrides,
    };
  }
  const sent = () => invoice({ status: "sent" });

  describe("hotkey N and ?create=1 open the creator only for create:Invoice", () => {
    beforeEach(() => {
      stub.data["invoice.list"] = { data: [invoice()], total: 1 };
    });

    it("seller: N opens the new-invoice form", () => {
      renderAs("seller", Invoices);
      expect(dialog("New Invoice")).not.toBeInTheDocument();
      pressN();
      expect(dialog("New Invoice")).toBeInTheDocument();
    });

    it("accountant: N does nothing", () => {
      renderAs("accountant", Invoices);
      pressN();
      expect(dialog("New Invoice")).not.toBeInTheDocument();
    });

    it("seller: ?create=1 (dashboard link) opens the form", () => {
      stub.search = { create: "1" };
      renderAs("seller", Invoices);
      expect(dialog("New Invoice")).toBeInTheDocument();
    });

    it("accountant: ?create=1 does not open the form", () => {
      stub.search = { create: "1" };
      renderAs("accountant", Invoices);
      expect(dialog("New Invoice")).not.toBeInTheDocument();
    });
  });

  describe("purchase tab — sellers cannot create purchase invoices", () => {
    beforeEach(() => {
      stub.data["invoice.list"] = { data: [invoice({ type: "purchase" })], total: 1 };
    });
    const openPurchases = () => fireEvent.click(screen.getByText("Purchases"));

    it("seller: '+ New Invoice' shows on Sales, disappears on Purchases", () => {
      renderAs("seller", Invoices);
      expect(buttons(/New Invoice/).length).toBeGreaterThan(0);
      openPurchases();
      expect(buttons(/New Invoice/)).toHaveLength(0);
    });

    it("seller: N does nothing on the Purchases tab", () => {
      renderAs("seller", Invoices);
      openPurchases();
      pressN();
      expect(dialog("New Invoice")).not.toBeInTheDocument();
    });

    it.each(["seller_manager", "admin"])("%s: '+ New Invoice' stays on the Purchases tab and N opens the form", (role) => {
      renderAs(role, Invoices);
      openPurchases();
      expect(buttons(/New Invoice/).length).toBeGreaterThan(0);
      pressN();
      expect(dialog("New Invoice")).toBeInTheDocument();
    });

    it("seller: no credit note / sales return buttons on a sent purchase invoice", () => {
      stub.data["invoice.getById"] = invoice({ type: "purchase", status: "sent" });
      stub.search = { id: "inv-1" };
      renderAs("seller", Invoices);
      expect(button("Issue Credit Note")).not.toBeInTheDocument();
      expect(button("Create Sales Return")).not.toBeInTheDocument();
    });
  });

  describe("list row actions", () => {
    it("seller sees 'Mark as sent' on a draft; accountant does not", () => {
      stub.data["invoice.list"] = { data: [invoice()], total: 1 };
      renderAs("seller", Invoices);
      expect(screen.getByTitle("Mark as sent")).toBeInTheDocument();
    });

    it("accountant gets no 'Mark as sent' / 'Mark fulfilled'", () => {
      stub.data["invoice.list"] = { data: [invoice(), invoice({ id: "inv-2", invoiceNumber: "INV-002", status: "unfulfilled" })], total: 2 };
      renderAs("accountant", Invoices);
      expect(screen.queryByTitle("Mark as sent")).not.toBeInTheDocument();
      expect(screen.queryByTitle("Mark fulfilled")).not.toBeInTheDocument();
    });

    it("clicking 'Mark as sent' calls invoice.updateStatus (allowed role)", () => {
      stub.data["invoice.list"] = { data: [invoice()], total: 1 };
      renderAs("seller", Invoices);
      fireEvent.click(screen.getByTitle("Mark as sent"));
      expect(stub.mutations["invoice.updateStatus"]).toEqual([{ id: "inv-1", status: "sent" }]);
    });

    it("'Record payment' shows for a role with create:Payment", () => {
      stub.data["invoice.list"] = { data: [sent()], total: 1 };
      renderAs("accountant", Invoices);
      expect(screen.getByTitle("Record payment")).toBeInTheDocument();
    });

    it("'Record payment' is hidden without create:Payment", () => {
      stub.data["invoice.list"] = { data: [sent()], total: 1 };
      renderAs("unrecognised_role", Invoices);
      expect(screen.queryByTitle("Record payment")).not.toBeInTheDocument();
    });
  });

  // Downloading a draft's PDF also marks it "sent" (invoice.updateStatus).
  // Every role may download; only update:Invoice roles get the status change.
  describe("PDF download of a draft", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["%PDF"])) });
      vi.stubGlobal("fetch", fetchMock);
      URL.createObjectURL = vi.fn(() => "blob:pdf");
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    async function downloadFrom(container: HTMLElement) {
      fireEvent.click(within(container).getByTitle("Download PDF"));
      // The menu is portalled to <body> (viewport-safe placement), so look it up globally.
      fireEvent.click(screen.getByRole("menuitem", { name: "Invoice (A5)" }));
      await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalled());
    }

    function row() {
      return screen.getByText("INV-001").closest("tr") as HTMLElement;
    }

    it("row: seller downloads and the draft is marked sent", async () => {
      stub.data["invoice.list"] = { data: [invoice()], total: 1 };
      renderAs("seller", Invoices);
      await downloadFrom(row());
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(stub.mutations["invoice.updateStatus"]).toEqual([{ id: "inv-1", status: "sent" }]);
    });

    it("row: accountant downloads but no status change is sent", async () => {
      stub.data["invoice.list"] = { data: [invoice()], total: 1 };
      renderAs("accountant", Invoices);
      await downloadFrom(row());
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(stub.mutations["invoice.updateStatus"]).toBeUndefined();
    });

    function openDetail(role: string) {
      stub.data["invoice.list"] = { data: [invoice()], total: 1 };
      stub.data["invoice.getById"] = invoice();
      // The open invoice lives in the URL (?id=), not local state.
      stub.search = { id: "inv-1" };
      renderAs(role, Invoices);
      return screen.getByRole("dialog", { name: "Invoice INV-001" });
    }

    it("detail panel: seller downloads; the server (not the client) promotes the draft", async () => {
      // Since main#41 the PDF endpoint promotes draft → sent itself (permission-
      // checked there), so the panel only downloads and refetches.
      const panel = openDetail("seller");
      await downloadFrom(panel);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(stub.mutations["invoice.updateStatus"]).toBeUndefined();
    });

    it("detail panel: accountant downloads but no status change is sent", async () => {
      const panel = openDetail("accountant");
      await downloadFrom(panel);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(stub.mutations["invoice.updateStatus"]).toBeUndefined();
    });
  });

  describe("detail panel", () => {
    function openPanel(role: string, inv: Record<string, unknown>) {
      stub.data["invoice.list"] = { data: [inv], total: 1 };
      stub.data["invoice.getById"] = inv;
      // The open invoice lives in the URL (?id=), not local state.
      stub.search = { id: "inv-1" };
      renderAs(role, Invoices);
      return screen.getByRole("dialog", { name: "Invoice INV-001" });
    }

    it("seller sees Mark Sent on a draft", () => {
      const panel = openPanel("seller", invoice());
      expect(within(panel).getByRole("button", { name: "Mark Sent" })).toBeInTheDocument();
    });

    it("accountant gets no Mark Sent", () => {
      const panel = openPanel("accountant", invoice());
      expect(within(panel).queryByRole("button", { name: "Mark Sent" })).not.toBeInTheDocument();
    });

    it("seller sees Mark Fulfilled on an unfulfilled invoice; accountant does not", () => {
      const panel = openPanel("seller", invoice({ status: "unfulfilled" }));
      fireEvent.click(within(panel).getByRole("button", { name: "Mark Fulfilled" }));
      expect(stub.mutations["invoice.updateStatus"]).toEqual([{ id: "inv-1", status: "sent" }]);
    });

    it("accountant gets no Mark Fulfilled", () => {
      const panel = openPanel("accountant", invoice({ status: "unfulfilled" }));
      expect(within(panel).queryByRole("button", { name: "Mark Fulfilled" })).not.toBeInTheDocument();
    });

    it("seller can issue a credit note / sales return from a sent invoice", () => {
      const panel = openPanel("seller", sent());
      expect(within(panel).getByRole("button", { name: "Issue Credit Note" })).toBeInTheDocument();
      expect(within(panel).getByRole("button", { name: "Create Sales Return" })).toBeInTheDocument();
    });

    it("accountant (no create:Invoice) gets neither", () => {
      const panel = openPanel("accountant", sent());
      expect(within(panel).queryByRole("button", { name: "Issue Credit Note" })).not.toBeInTheDocument();
      expect(within(panel).queryByRole("button", { name: "Create Sales Return" })).not.toBeInTheDocument();
    });

    it("Record Payment shows for create:Payment roles", () => {
      const panel = openPanel("accountant", sent());
      expect(within(panel).getByRole("button", { name: "Record Payment" })).toBeInTheDocument();
    });

    it("Record Payment is hidden without create:Payment", () => {
      const panel = openPanel("unrecognised_role", sent());
      expect(within(panel).queryByRole("button", { name: "Record Payment" })).not.toBeInTheDocument();
    });

    describe("shipment card (shipment.create = create:Invoice, shipment.update = update:Invoice)", () => {
      const shipment = (overrides: Record<string, unknown>) => ({
        id: "sh-1", status: "pending", mode: "courier", carrier: "dtdc",
        trackingNumber: null, trackingUrl: null, cost: "0", ...overrides,
      });

      it("seller can create a shipment", () => {
        stub.data["shipment.list"] = { data: [], total: 0 };
        const panel = openPanel("seller", sent());
        fireEvent.click(within(panel).getByRole("button", { name: "+ Create Shipment" }));
        fireEvent.click(within(panel).getByRole("button", { name: "Create Shipment" }));
        expect(stub.mutations["shipment.create"]).toHaveLength(1);
      });

      it("accountant gets no '+ Create Shipment'", () => {
        stub.data["shipment.list"] = { data: [], total: 0 };
        const panel = openPanel("accountant", sent());
        expect(within(panel).queryByRole("button", { name: /Create Shipment/ })).not.toBeInTheDocument();
      });

      it("seller can mark a pending shipment shipped and add tracking", () => {
        stub.data["shipment.list"] = { data: [shipment({})], total: 1 };
        const panel = openPanel("seller", sent());
        expect(within(panel).getByRole("button", { name: "Mark Shipped" })).toBeInTheDocument();
        fireEvent.click(within(panel).getByRole("button", { name: "Add tracking" }));
        fireEvent.change(within(panel).getByPlaceholderText("Tracking number"), { target: { value: "AWB1" } });
        fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
        expect(stub.mutations["shipment.update"]).toEqual([{ id: "sh-1", trackingNumber: "AWB1" }]);
      });

      it("accountant gets no Mark Shipped / Add tracking", () => {
        stub.data["shipment.list"] = { data: [shipment({})], total: 1 };
        const panel = openPanel("accountant", sent());
        expect(within(panel).queryByRole("button", { name: "Mark Shipped" })).not.toBeInTheDocument();
        expect(within(panel).queryByRole("button", { name: "Add tracking" })).not.toBeInTheDocument();
      });

      it("seller can mark a shipped shipment delivered; accountant cannot", () => {
        stub.data["shipment.list"] = { data: [shipment({ status: "shipped" })], total: 1 };
        const panel = openPanel("seller", sent());
        expect(within(panel).getByRole("button", { name: "Mark Delivered" })).toBeInTheDocument();
      });

      it("accountant gets no Mark Delivered", () => {
        stub.data["shipment.list"] = { data: [shipment({ status: "in_transit" })], total: 1 };
        const panel = openPanel("accountant", sent());
        expect(within(panel).queryByRole("button", { name: "Mark Delivered" })).not.toBeInTheDocument();
      });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DocumentListPage — updateStatus = update:Invoice, convert = create:Invoice
// ═══════════════════════════════════════════════════════════════════════════

describe("DocumentListPage row and detail actions", () => {
  const base: DocumentListPageConfig = {
    trpcRouter: "quotation",
    documentType: "quotation",
    defaultInvoiceType: "sale",
    title: "Quotations",
    description: "Send estimates to customers",
    buttonLabel: "+ New Quotation",
    statusTabs: [{ value: "", label: "All" }],
    emptyTitle: "No quotations",
    emptyDescription: () => "Nothing here yet",
    emptyIconPath: "M0 0",
    col2Header: "Quotation #",
    col4Variant: "dueDate",
    col4Header: "Valid Until",
    markSent: true,
  };
  const doc = (overrides: Record<string, unknown> = {}) => ({
    id: "q1", invoiceNumber: "QT-001", status: "draft", type: "sale", partyName: "Acme Traders",
    party: { id: "p1", name: "Acme Traders" }, invoiceDate: new Date().toISOString(),
    dueDate: null, subtotal: "100", discountAmount: "0", taxAmount: "18", totalAmount: "118.00",
    relatedDocuments: [], lineItems: [], ...overrides,
  });

  function renderDocs(role: string, config: DocumentListPageConfig, d = doc(), selected?: string) {
    stub.data[`${config.trpcRouter}.list`] = { data: [d], total: 1 };
    stub.data["invoice.getById"] = d;
    return renderAs(role, () => <DocumentListPage config={config} initialSelectedId={selected} />);
  }

  it("seller can Mark Sent a draft (calls <router>.updateStatus)", () => {
    renderDocs("seller", base);
    fireEvent.click(button("Mark Sent")!);
    expect(stub.mutations["quotation.updateStatus"]).toEqual([{ id: "q1", status: "sent" }]);
  });

  it("accountant gets no Mark Sent", () => {
    renderDocs("accountant", base);
    expect(button("Mark Sent")).not.toBeInTheDocument();
  });

  const creditNotes: DocumentListPageConfig = {
    ...base, trpcRouter: "creditNote", documentType: "credit_note", title: "Credit Notes",
    buttonLabel: "+ New Credit Note", markPaid: true,
  };

  it("seller can Mark Paid a sent credit note", () => {
    renderDocs("seller", creditNotes, doc({ status: "sent" }));
    fireEvent.click(button("Mark Paid")!);
    expect(stub.mutations["creditNote.updateStatus"]).toEqual([{ id: "q1", status: "paid" }]);
  });

  it("accountant gets no Mark Paid", () => {
    renderDocs("accountant", creditNotes, doc({ status: "sent" }));
    expect(button("Mark Paid")).not.toBeInTheDocument();
  });

  it("seller can Convert to Invoice (document.convert = create:Invoice)", () => {
    const onConvert = vi.fn();
    renderDocs("seller", { ...base, convert: { convertingId: null, onConvert } });
    fireEvent.click(button("Convert to Invoice")!);
    expect(onConvert).toHaveBeenCalledWith("q1");
  });

  it("accountant gets no Convert to Invoice", () => {
    renderDocs("accountant", { ...base, convert: { convertingId: null, onConvert: vi.fn() } });
    expect(button("Convert to Invoice")).not.toBeInTheDocument();
  });

  describe("purchase side (sellers cannot create purchase-side documents)", () => {
    const challans: DocumentListPageConfig = {
      ...base, trpcRouter: "deliveryChallan", documentType: "delivery_challan", hasTypeFilter: true,
      title: "Delivery Challans", buttonLabel: "+ New Challan",
    };
    const openPurchases = () => fireEvent.click(screen.getByText("Purchases"));

    it("seller: '+ New Challan' shows on Sales, hidden on Purchases", () => {
      renderDocs("seller", challans);
      expect(button("+ New Challan")).toBeInTheDocument();
      openPurchases();
      expect(button("+ New Challan")).not.toBeInTheDocument();
    });

    it.each(["seller_manager", "admin"])("%s: '+ New Challan' stays on Purchases", (role) => {
      renderDocs(role, challans);
      openPurchases();
      expect(button("+ New Challan")).toBeInTheDocument();
    });

    it("seller: no Convert to Invoice on the Purchases tab", () => {
      renderDocs("seller", { ...challans, convert: { convertingId: null, onConvert: vi.fn() } });
      expect(button("Convert to Invoice")).toBeInTheDocument();
      openPurchases();
      expect(button("Convert to Invoice")).not.toBeInTheDocument();
    });
  });

  describe("status actions follow the per-document transition table", () => {
    const challans: DocumentListPageConfig = {
      ...base, trpcRouter: "deliveryChallan", documentType: "delivery_challan",
      title: "Delivery Challans", buttonLabel: "+ New Challan", markPaid: true,
    };

    it("delivery challan: draft offers Mark Sent only", () => {
      renderDocs("seller", challans, doc({ status: "draft" }));
      expect(button("Mark Sent")).toBeInTheDocument();
      expect(button("Mark Paid")).not.toBeInTheDocument();
    });

    it("delivery challan: sent offers no Mark Sent / Mark Paid (sent -> cancelled only)", () => {
      renderDocs("seller", challans, doc({ status: "sent" }));
      expect(button("Mark Sent")).not.toBeInTheDocument();
      expect(button("Mark Paid")).not.toBeInTheDocument();
    });

    it("delivery challan: cancelled is terminal", () => {
      renderDocs("seller", challans, doc({ status: "cancelled" }));
      expect(button("Mark Sent")).not.toBeInTheDocument();
      expect(button("Mark Paid")).not.toBeInTheDocument();
    });
  });

  it("detail panel Edit shows for update:Invoice roles", () => {
    renderDocs("seller", base, doc(), "q1");
    const panel = screen.getByRole("dialog", { name: "QT-001" });
    expect(within(panel).getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("detail panel Edit is hidden from accountant", () => {
    renderDocs("accountant", base, doc(), "q1");
    const panel = screen.getByRole("dialog", { name: "QT-001" });
    expect(within(panel).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DocumentCreator — inline "Create customer" (create:Party) / "Create item"
// (create:Item). The quick-create modals open only from these options.
// ═══════════════════════════════════════════════════════════════════════════

describe("DocumentCreator inline create options", () => {
  function renderCreator(role: string) {
    stub.data["party.list"] = { data: [], total: 0 };
    stub.data["item.list"] = { data: [], total: 0 };
    return renderAs(role, () => (
      <DocumentCreator documentType="invoice" invoiceType="sale" onClose={vi.fn()} />
    ));
  }
  const openCombobox = (index: number) => {
    const boxes = screen.getAllByRole("combobox");
    fireEvent.mouseDown(boxes[index]);
  };
  const option = (name: RegExp) => screen.queryByRole("option", { name });

  it("seller_manager can create customers and items inline", () => {
    renderCreator("seller_manager");
    openCombobox(0);
    expect(option(/Create customer/)).toBeInTheDocument();
    openCombobox(1);
    expect(option(/Create item/)).toBeInTheDocument();
  });

  it("seller (no create:Item) can create customers but not items", () => {
    renderCreator("seller");
    openCombobox(0);
    expect(option(/Create customer/)).toBeInTheDocument();
    openCombobox(1);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(option(/Create item/)).not.toBeInTheDocument();
  });

  it("accountant (no create:Party) gets no 'Create customer'", () => {
    renderCreator("accountant");
    openCombobox(0);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(option(/Create customer/)).not.toBeInTheDocument();
  });

  it("picking 'Create item' opens the quick item form for an allowed role", () => {
    renderCreator("seller_manager");
    openCombobox(1);
    fireEvent.mouseDown(option(/Create item/)!);
    expect(dialog("New Item")).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RecordPaymentPanel — submit needs create:Payment (new) / update:Payment (edit)
// ═══════════════════════════════════════════════════════════════════════════

describe("RecordPaymentPanel submit", () => {
  it("create mode: shown to a role with create:Payment", () => {
    renderAs("accountant", () => <RecordPaymentPanel open onClose={vi.fn()} />);
    expect(button("Record Payment")).toBeInTheDocument();
  });

  it("create mode: hidden without create:Payment", () => {
    renderAs("unrecognised_role", () => <RecordPaymentPanel open onClose={vi.fn()} />);
    expect(dialog("Record Payment")).toBeInTheDocument();
    expect(button("Record Payment")).not.toBeInTheDocument();
  });

  it("edit mode: shown to a role with update:Payment", () => {
    renderAs("seller", () => <RecordPaymentPanel open onClose={vi.fn()} editPaymentId="pay-1" />);
    expect(button("Save Payment")).toBeInTheDocument();
  });

  it("edit mode: hidden without update:Payment", () => {
    renderAs("unrecognised_role", () => <RecordPaymentPanel open onClose={vi.fn()} editPaymentId="pay-1" />);
    expect(dialog("Edit Payment")).toBeInTheDocument();
    expect(button("Save Payment")).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Parties — hotkey N (create:Party), Merge (party.merge = delete:Party)
// ═══════════════════════════════════════════════════════════════════════════

describe("Parties page", () => {
  const Parties = page(PartiesRoute);
  const party = { id: "p1", name: "Acme Traders", type: "customer", phone: null, gstin: null, balance: "0" };

  beforeEach(() => {
    stub.data["party.list"] = { data: [party], total: 1 };
  });

  it("seller: N opens Add Party", () => {
    renderAs("seller", Parties);
    pressN();
    expect(dialog("Add Party")).toBeInTheDocument();
  });

  it("accountant: N does nothing", () => {
    renderAs("accountant", Parties);
    pressN();
    expect(dialog("Add Party")).not.toBeInTheDocument();
  });

  function openDetail(role: string) {
    stub.data["party.getById"] = party;
    // The open party lives in the URL (?id=), not local state.
    stub.search = { id: "p1" };
    renderAs(role, Parties);
    return screen.getByRole("dialog", { name: "Acme Traders" });
  }

  it("admin sees Merge in the party panel", () => {
    const panel = openDetail("admin");
    fireEvent.click(within(panel).getByRole("button", { name: "Merge" }));
    expect(dialog("Merge Parties")).toBeInTheDocument();
  });

  it("seller_manager (no delete:Party) gets no Merge", () => {
    const panel = openDetail("seller_manager");
    expect(within(panel).queryByRole("button", { name: "Merge" })).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Payments — hotkey N / empty state (create), Edit (update), auto-assign (update)
// ═══════════════════════════════════════════════════════════════════════════

describe("Payments page", () => {
  const Payments = page(PaymentsRoute);
  const payment = {
    id: "pay-1", paymentNumber: "PAY-001", partyId: "p1", partyName: "Acme Traders",
    paymentDate: new Date().toISOString(), mode: "cash", referenceNumber: null,
    amount: "500.00", type: "received",
  };

  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  describe("with rows", () => {
    beforeEach(() => {
      stub.data["payment.list"] = { data: [payment], total: 1 };
    });

    it("seller: N opens Record Payment", () => {
      renderAs("seller", Payments);
      pressN();
      expect(dialog("Record Payment")).toBeInTheDocument();
    });

    it("no create:Payment: N does nothing", () => {
      renderAs("unrecognised_role", Payments);
      pressN();
      expect(dialog("Record Payment")).not.toBeInTheDocument();
    });

    it("row Edit opens the payment editor for update:Payment roles", () => {
      renderAs("accountant", Payments);
      fireEvent.click(button("Edit")!);
      expect(dialog("Edit Payment")).toBeInTheDocument();
    });

    it("row Edit is hidden without update:Payment", () => {
      renderAs("unrecognised_role", Payments);
      expect(button("Edit")).not.toBeInTheDocument();
    });

    function openDetail(role: string) {
      stub.data["payment.getById"] = { ...payment, discount: "0", notes: null, linkedInvoices: [] };
      renderAs(role, Payments);
      fireEvent.click(screen.getByText("PAY-001"));
      return screen.getByRole("dialog", { name: "Payment PAY-001" });
    }

    it("detail 'Edit Payment' shows for update:Payment roles", () => {
      const panel = openDetail("seller");
      expect(within(panel).getByRole("button", { name: "Edit Payment" })).toBeInTheDocument();
    });

    it("detail 'Edit Payment' is hidden without update:Payment", () => {
      const panel = openDetail("unrecognised_role");
      expect(within(panel).queryByRole("button", { name: "Edit Payment" })).not.toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    beforeEach(() => {
      stub.data["payment.list"] = { data: [], total: 0 };
    });

    it("offers '+ Record Payment' (header + empty state) to create:Payment roles", () => {
      renderAs("seller", Payments);
      expect(screen.getAllByRole("button", { name: /Record Payment/ })).toHaveLength(2);
    });

    it("offers none without create:Payment", () => {
      renderAs("unrecognised_role", Payments);
      expect(screen.queryAllByRole("button", { name: /Record Payment/ })).toHaveLength(0);
    });
  });

  // SmartAssignBanner calls payment.assignAccount on mount (no user action).
  describe("automatic account assignment on page load", () => {
    beforeEach(() => {
      stub.data["payment.list"] = { data: [payment], total: 1 };
      stub.data["payment.untrackedPayments"] = { data: [{ id: "pay-9", mode: "cash", amount: "100.00" }], total: 1 };
      stub.data["bankAccount.list"] = [{ id: "acc-cash", accountType: "cash", accountName: "Cash" }];
    });

    it("runs for a role with update:Payment", async () => {
      renderAs("accountant", Payments);
      await waitFor(() =>
        expect(stub.mutations["payment.assignAccount"]).toEqual([
          { paymentIds: ["pay-9"], bankAccountId: "acc-cash" },
        ]),
      );
    });

    it("does not run without update:Payment", async () => {
      renderAs("unrecognised_role", Payments);
      await new Promise((r) => setTimeout(r, 20));
      expect(stub.mutations["payment.assignAccount"]).toBeUndefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Expenses — hotkey N (create:Expense)
// ═══════════════════════════════════════════════════════════════════════════

describe("Expenses page hotkey", () => {
  const Expenses = page(ExpensesRoute);

  beforeEach(() => {
    stub.data["expense.list"] = { data: [], total: 0 };
    stub.data["expense.categories"] = [];
  });

  it("accountant: N opens Add Expense", () => {
    renderAs("accountant", Expenses);
    pressN();
    expect(dialog("Add Expense")).toBeInTheDocument();
  });

  it("seller_manager (read-only): N does nothing", () => {
    renderAs("seller_manager", Expenses);
    pressN();
    expect(dialog("Add Expense")).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Recurring invoices — create (hotkey, suggestion, Run now), update (pause,
// resume, edit)
// ═══════════════════════════════════════════════════════════════════════════

describe("Recurring invoices page", () => {
  const Recurring = page(AutomatedInvoicesRoute);
  const template = (overrides: Record<string, unknown> = {}) => ({
    id: "tpl-1", name: "Monthly retainer", partyId: "p1", partyName: "Acme Traders", type: "sale",
    frequency: "monthly", status: "active", nextRunDate: new Date().toISOString(),
    startDate: new Date().toISOString(), lastRunDate: null, totalAmount: "1000.00",
    totalRuns: 0, lineItems: [], ...overrides,
  });

  function withRows(...rows: Record<string, unknown>[]) {
    stub.data["recurringInvoice.list"] = { data: rows, total: rows.length };
  }

  it("seller_manager: N opens the template form", () => {
    withRows(template());
    renderAs("seller_manager", Recurring);
    pressN();
    expect(dialog("Create Template")).toBeInTheDocument();
  });

  it("seller: N does nothing", () => {
    withRows(template());
    renderAs("seller", Recurring);
    pressN();
    expect(dialog("Create Template")).not.toBeInTheDocument();
  });

  describe("smart suggestion 'Create Template'", () => {
    beforeEach(() => {
      withRows(template());
      stub.data["recurringInvoice.suggestions"] = [
        { partyId: "p2", partyName: "Beta Stores", type: "sale", suggestedFrequency: "monthly", invoiceCount: 4, medianAmount: "500" },
      ];
    });

    it("seller_manager can start a template from a suggestion", () => {
      renderAs("seller_manager", Recurring);
      fireEvent.click(button("Create Template")!);
      expect(dialog("Create Template")).toBeInTheDocument();
    });

    it("seller gets no suggestion button", () => {
      renderAs("seller", Recurring);
      expect(screen.getByText("Beta Stores")).toBeInTheDocument();
      expect(button("Create Template")).not.toBeInTheDocument();
    });
  });

  describe("row actions", () => {
    it("seller_manager can pause, run and edit an active template", () => {
      withRows(template());
      renderAs("seller_manager", Recurring);
      fireEvent.click(labelled("Pause template")!);
      fireEvent.click(labelled("Run now")!);
      expect(labelled("Edit template")).toBeInTheDocument();
      expect(stub.mutations["recurringInvoice.pause"]).toEqual([{ id: "tpl-1" }]);
      expect(stub.mutations["recurringInvoice.runNow"]).toEqual([{ id: "tpl-1" }]);
    });

    it("seller_manager can resume a paused template", () => {
      withRows(template({ status: "paused" }));
      renderAs("seller_manager", Recurring);
      fireEvent.click(labelled("Resume template")!);
      expect(stub.mutations["recurringInvoice.resume"]).toEqual([{ id: "tpl-1" }]);
    });

    it("seller (read-only) gets no pause / run / edit", () => {
      withRows(template());
      renderAs("seller", Recurring);
      expect(labelled("Pause template")).not.toBeInTheDocument();
      expect(labelled("Run now")).not.toBeInTheDocument();
      expect(labelled("Edit template")).not.toBeInTheDocument();
    });

    it("seller gets no resume", () => {
      withRows(template({ status: "paused" }));
      renderAs("seller", Recurring);
      expect(labelled("Resume template")).not.toBeInTheDocument();
    });
  });

  describe("detail slide-over", () => {
    function openDetail(role: string, t: Record<string, unknown>) {
      withRows(t);
      stub.data["recurringInvoice.getById"] = t;
      renderAs(role, Recurring);
      fireEvent.click(screen.getByText("Monthly retainer"));
      return screen.getByRole("dialog", { name: "Monthly retainer" });
    }

    it("seller_manager sees Pause, Run Now and Edit Template", () => {
      const panel = openDetail("seller_manager", template());
      fireEvent.click(within(panel).getByRole("button", { name: "Pause" }));
      fireEvent.click(within(panel).getByRole("button", { name: "Run Now" }));
      expect(within(panel).getByRole("button", { name: "Edit Template" })).toBeInTheDocument();
      expect(stub.mutations["recurringInvoice.pause"]).toEqual([{ id: "tpl-1" }]);
      expect(stub.mutations["recurringInvoice.runNow"]).toEqual([{ id: "tpl-1" }]);
    });

    it("seller_manager sees Resume on a paused template", () => {
      const panel = openDetail("seller_manager", template({ status: "paused" }));
      expect(within(panel).getByRole("button", { name: "Resume" })).toBeInTheDocument();
    });

    it("seller sees none of them", () => {
      const panel = openDetail("seller", template());
      for (const name of ["Pause", "Run Now", "Edit Template"]) {
        expect(within(panel).queryByRole("button", { name }), name).not.toBeInTheDocument();
      }
    });

    it("seller gets no Resume", () => {
      const panel = openDetail("seller", template({ status: "paused" }));
      expect(within(panel).queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Shipments — shipment.update = update:Invoice, shipment.delete = delete:Invoice
// ═══════════════════════════════════════════════════════════════════════════

describe("Shipments detail panel", () => {
  const Shipments = page(ShipmentsRoute);
  const shipment = (overrides: Record<string, unknown> = {}) => ({
    id: "sh-1", invoiceId: "inv-1", partyId: "p1", carrier: "dtdc", mode: "courier",
    trackingNumber: "AWB-77", trackingUrl: null, cost: "50", weight: null, status: "pending",
    shipmentDate: null, estimatedDelivery: null, actualDelivery: null, notes: null,
    createdAt: new Date().toISOString(), invoiceNumber: "INV-001", partyName: "Acme Traders",
    ...overrides,
  });

  function openPanel(role: string, s = shipment()) {
    stub.data["shipment.list"] = { data: [s], total: 1 };
    stub.data["shipment.getById"] = s;
    renderAs(role, Shipments);
    fireEvent.click(screen.getByText("Acme Traders"));
    return screen.getByRole("dialog", { name: "Shipment" });
  }

  it("seller (update, no delete) can edit and mark shipped but not delete", () => {
    const panel = openPanel("seller");
    expect(within(panel).getByRole("button", { name: "Mark Shipped" })).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Edit" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
    expect(stub.mutations["shipment.update"]).toHaveLength(1);
  });

  it("seller can mark a shipped shipment in transit / delivered", () => {
    const panel = openPanel("seller", shipment({ status: "shipped" }));
    expect(within(panel).getByRole("button", { name: "Mark In Transit" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Mark Delivered" })).toBeInTheDocument();
  });

  it("admin can delete", () => {
    const panel = openPanel("admin");
    expect(within(panel).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("accountant (read-only) gets no Edit / Delete / Mark Shipped", () => {
    const panel = openPanel("accountant");
    for (const name of ["Edit", "Delete", "Mark Shipped"]) {
      expect(within(panel).queryByRole("button", { name }), name).not.toBeInTheDocument();
    }
  });

  it("accountant gets no Mark In Transit / Mark Delivered", () => {
    const panel = openPanel("accountant", shipment({ status: "shipped" }));
    expect(within(panel).queryByRole("button", { name: "Mark In Transit" })).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Mark Delivered" })).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Store orders — confirm / status / cancel all need update:Store
// ═══════════════════════════════════════════════════════════════════════════

describe("Store orders page", () => {
  const StoreOrders = page(StoreOrdersRoute);
  const order = (id: string, status: string) => ({
    id, orderNumber: `ORD-${id}`, customerName: `Customer ${id}`, customerPhone: null,
    itemCount: 1, totalAmount: "100", status, createdAt: new Date().toISOString(),
  });
  const rows = () => [order("1", "pending"), order("2", "confirmed"), order("3", "preparing"), order("4", "ready")];

  it("seller_manager sees confirm / status / cancel row actions", () => {
    stub.data["store.listOrders"] = { data: rows(), total: 4 };
    renderAs("seller_manager", StoreOrders);
    const table = within(screen.getByRole("table"));
    for (const name of ["Confirm", "Preparing", "Ready", "Delivered"]) {
      expect(table.getByRole("button", { name }), name).toBeInTheDocument();
    }
    expect(table.getAllByRole("button", { name: "Cancel" })).toHaveLength(4);
    fireEvent.click(table.getByRole("button", { name: "Preparing" }));
    expect(stub.mutations["store.updateOrderStatus"]).toEqual([{ orderId: "2", status: "preparing" }]);
  });

  it("seller (read-only) sees only View", () => {
    stub.data["store.listOrders"] = { data: rows(), total: 4 };
    renderAs("seller", StoreOrders);
    const table = within(screen.getByRole("table"));
    for (const name of ["Confirm", "Preparing", "Ready", "Delivered", "Cancel"]) {
      expect(table.queryByRole("button", { name }), name).not.toBeInTheDocument();
    }
    expect(table.getAllByRole("button", { name: "View" })).toHaveLength(4);
  });

  function openDetail(role: string) {
    const o = order("1", "pending");
    stub.data["store.listOrders"] = { data: [o], total: 1 };
    stub.data["store.getOrder"] = { ...o, notes: null, cancelReason: null, lineItems: [], invoiceId: null, invoiceNumber: null };
    renderAs(role, StoreOrders);
    fireEvent.click(screen.getByText("ORD-1"));
    return screen.getByRole("dialog", { name: "Order ORD-1" });
  }

  it("detail: seller_manager can cancel and confirm", () => {
    const panel = openDetail("seller_manager");
    expect(within(panel).getByRole("button", { name: "Cancel Order" })).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Confirm Order" }));
    expect(stub.mutations["store.confirmOrder"]).toEqual([{ orderId: "1" }]);
  });

  it("detail: seller gets no Cancel Order / Confirm Order", () => {
    const panel = openDetail("seller");
    expect(within(panel).queryByRole("button", { name: "Cancel Order" })).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Confirm Order" })).not.toBeInTheDocument();
  });

  it("detail: status transition buttons follow the same rule", () => {
    const o = order("2", "confirmed");
    stub.data["store.listOrders"] = { data: [o], total: 1 };
    stub.data["store.getOrder"] = { ...o, notes: null, cancelReason: null, lineItems: [], invoiceId: null, invoiceNumber: null };
    renderAs("seller_manager", StoreOrders);
    fireEvent.click(screen.getByText("ORD-2"));
    const panel = screen.getByRole("dialog", { name: "Order ORD-2" });
    expect(within(panel).getByRole("button", { name: "Mark Preparing" })).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard — "+ New Invoice" (create:Invoice)
// ═══════════════════════════════════════════════════════════════════════════

describe("Dashboard '+ New Invoice'", () => {
  const Dashboard = page(DashboardRoute);

  beforeEach(() => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    stub.data["dashboard.summary"] = {
      totalSales: "1000", totalPurchases: "400", receivable: "200", payable: "100",
      cashInHand: "300", totalExpenses: "50", totalCollected: "800", totalInvoiced: "1000",
    };
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shown to roles with create:Invoice", () => {
    renderAs("seller_manager", Dashboard);
    expect(screen.getByRole("link", { name: "+ New Invoice" })).toHaveAttribute("href", "/invoices");
  });

  it("hidden from accountant (dashboard visible, no create:Invoice)", () => {
    renderAs("accountant", Dashboard);
    expect(screen.getByText("Gross Profit")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "+ New Invoice" })).not.toBeInTheDocument();
  });
});
