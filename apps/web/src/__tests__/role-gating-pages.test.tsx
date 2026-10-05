/**
 * Role gating — renders the real web/desktop page components and asserts that
 * every Create / Edit / Delete affordance follows the shared permission matrix
 * (packages/shared/src/permissions.ts, kept in lock-step with the API's CASL
 * rules by packages/api/src/__tests__/permissions-parity.test.ts).
 *
 * WHY real pages rather than extracted JSX:
 * The gating is a one-line `{canX && <button/>}` inside each page. A copy of
 * that JSX would only re-test the hook (covered in hooks/__tests__/useCan.test.ts);
 * the regressions we care about are a page that forgets to gate, gates on the
 * wrong action/resource, or — as happened once — calls the permission hook
 * after an early return and crashes when a detail panel opens.
 *
 * Only boundaries are stubbed: the tRPC client (network) and TanStack Router's
 * navigation hooks. Route components are taken from `Route.options.component`,
 * which needs no generated route tree. The permission hooks, shared matrix and
 * every UI component are the real implementations.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { ComponentType } from "react";
import { INVOICE_DELETE_WINDOW_MS } from "@hisaabo/shared";

// ── Boundary stubs (tRPC network + router navigation) ──────────────────────

vi.mock("@/lib/trpc", async () => (await import("@/test-utils/trpc-stub")).trpcModule);
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("@/test-utils/trpc-stub")).routerOverrides,
}));

import { stub } from "@/test-utils/trpc-stub";

// ── Real implementations under test ────────────────────────────────────────

import { Route as RootRoute } from "@/routes/__root";
import { Route as PartiesRoute } from "@/routes/parties";
import { Route as ItemsRoute } from "@/routes/items";
import { Route as ExpensesRoute } from "@/routes/expenses";
import { Route as InvoicesRoute } from "@/routes/invoices";
import { Route as PaymentsRoute } from "@/routes/payments";
import { Route as CashAndBankRoute } from "@/routes/cash-and-bank";
import { Route as AutomatedInvoicesRoute } from "@/routes/automated-invoices";
import { DocumentListPage, type DocumentListPageConfig } from "@/components/DocumentListPage";

const page = (route: { options: { component?: unknown } }) => route.options.component as ComponentType;

function renderAs(role: string | null, Page: ComponentType) {
  stub.session.role = role;
  return render(<Page />);
}

beforeEach(() => stub.reset());

const button = (name: string | RegExp) => screen.queryByRole("button", { name });
const labelled = (label: string) => screen.queryByLabelText(label);

// ═══════════════════════════════════════════════════════════════════════════
// Parties — create:Party, delete:Party
// ═══════════════════════════════════════════════════════════════════════════

describe("Parties page", () => {
  const Parties = page(PartiesRoute);
  const party = { id: "p1", name: "Acme Traders", type: "customer", phone: null, gstin: null, balance: "0" };

  describe("with rows", () => {
    beforeEach(() => {
      stub.data["party.list"] = { data: [party], total: 1 };
    });

    it("seller can add parties but not delete them", () => {
      renderAs("seller", Parties);
      expect(button(/Add Party/)).toBeInTheDocument();
      expect(labelled("Delete party")).not.toBeInTheDocument();
    });

    it("admin can add and delete parties", () => {
      renderAs("admin", Parties);
      expect(button(/Add Party/)).toBeInTheDocument();
      expect(labelled("Delete party")).toBeInTheDocument();
    });

    it("seller_manager can add but not delete parties", () => {
      renderAs("seller_manager", Parties);
      expect(button(/Add Party/)).toBeInTheDocument();
      expect(labelled("Delete party")).not.toBeInTheDocument();
    });

    it("accountant (read-only) sees neither add nor delete", () => {
      renderAs("accountant", Parties);
      expect(button(/Add Party/)).not.toBeInTheDocument();
      expect(labelled("Delete party")).not.toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    beforeEach(() => {
      stub.data["party.list"] = { data: [], total: 0 };
    });

    it("offers the add button to roles that can create (header + empty state)", () => {
      renderAs("seller", Parties);
      expect(screen.getAllByRole("button", { name: /Add Party/ })).toHaveLength(2);
    });

    it("offers no add button to read-only roles", () => {
      renderAs("accountant", Parties);
      expect(screen.queryAllByRole("button", { name: /Add Party/ })).toHaveLength(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Items — create:Item, delete:Item
// ═══════════════════════════════════════════════════════════════════════════

describe("Items page", () => {
  const Items = page(ItemsRoute);
  const item = {
    id: "i1", name: "Widget", itemType: "product", itemMode: "simple", unit: "pcs",
    salePrice: "100.00", purchasePrice: "80.00", stockQuantity: "10", lowStockThreshold: null,
    hsn: null, taxPercent: "18.00",
  };

  describe("with rows", () => {
    beforeEach(() => {
      stub.data["item.list"] = { data: [item], total: 1 };
    });

    it("admin can add and delete items", () => {
      renderAs("admin", Items);
      expect(button(/Add Item/)).toBeInTheDocument();
      expect(labelled("Delete item")).toBeInTheDocument();
    });

    it("seller_manager can add but not delete items", () => {
      renderAs("seller_manager", Items);
      expect(button(/Add Item/)).toBeInTheDocument();
      expect(labelled("Delete item")).not.toBeInTheDocument();
    });

    it("seller (read-only on items) sees neither add nor delete", () => {
      renderAs("seller", Items);
      expect(button(/Add Item/)).not.toBeInTheDocument();
      expect(labelled("Delete item")).not.toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    beforeEach(() => {
      stub.data["item.list"] = { data: [], total: 0 };
    });

    it("offers the add button to roles that can create (header + empty state)", () => {
      renderAs("seller_manager", Items);
      expect(screen.getAllByRole("button", { name: /Add Item/ })).toHaveLength(2);
    });

    it("offers no add button to read-only roles", () => {
      renderAs("seller", Items);
      expect(screen.queryAllByRole("button", { name: /Add Item/ })).toHaveLength(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Expenses — create / update / delete:Expense
// ═══════════════════════════════════════════════════════════════════════════

describe("Expenses page", () => {
  const Expenses = page(ExpensesRoute);
  const expense = {
    id: "e1", category: "Rent", description: "Office rent", amount: "5000.00",
    expenseDate: new Date().toISOString(), mode: "cash", referenceNumber: null,
  };

  beforeEach(() => {
    stub.data["expense.list"] = { data: [expense], total: 1 };
    stub.data["expense.categories"] = [];
  });

  it("accountant can create, edit and delete expenses", () => {
    renderAs("accountant", Expenses);
    expect(button(/New Expense/)).toBeInTheDocument();
    expect(labelled("Edit expense")).toBeInTheDocument();
    expect(labelled("Delete expense")).toBeInTheDocument();
  });

  it("seller_manager (read-only on expenses) sees none of the mutating actions", () => {
    renderAs("seller_manager", Expenses);
    expect(button(/New Expense/)).not.toBeInTheDocument();
    expect(labelled("Edit expense")).not.toBeInTheDocument();
    expect(labelled("Delete expense")).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Invoices — create / update / delete:Invoice, plus the API's one record rule:
// a seller_manager may delete only unpaid invoices up to 2 hours old.
// Edits carry no time limit (invoice.update has none).
// ═══════════════════════════════════════════════════════════════════════════

describe("Invoices page", () => {
  const Invoices = page(InvoicesRoute);

  function invoice(overrides: Record<string, unknown> = {}) {
    return {
      id: "inv-1", invoiceNumber: "INV-001", type: "sale", status: "draft",
      partyId: "p1", partyName: "Acme Traders", party: { id: "p1", name: "Acme Traders" },
      invoiceDate: new Date().toISOString(), dueDate: null,
      createdAt: new Date().toISOString(),
      subtotal: "100.00", totalTax: "18.00", totalAmount: "118.00",
      amountPaid: "0", totalAdjusted: "0", roundOff: "0",
      lineItems: [], relatedDocuments: [],
      ...overrides,
    };
  }

  describe("list", () => {
    beforeEach(() => {
      stub.data["invoice.list"] = { data: [invoice()], total: 1 };
    });

    it("seller can create invoices but cannot delete them", () => {
      renderAs("seller", Invoices);
      expect(button(/New Invoice/)).toBeInTheDocument();
      expect(screen.queryByTitle("Delete invoice")).not.toBeInTheDocument();
    });

    it("seller_manager can create invoices and delete a fresh draft", () => {
      renderAs("seller_manager", Invoices);
      expect(button(/New Invoice/)).toBeInTheDocument();
      expect(screen.getByTitle("Delete invoice")).toBeInTheDocument();
    });

    it("seller_manager cannot delete a draft older than 2 hours (API rejects it)", () => {
      const old = new Date(Date.now() - INVOICE_DELETE_WINDOW_MS - 60_000).toISOString();
      stub.data["invoice.list"] = { data: [invoice({ createdAt: old })], total: 1 };
      renderAs("seller_manager", Invoices);
      expect(screen.queryByTitle("Delete invoice")).not.toBeInTheDocument();
    });

    it("admin can delete a draft of any age", () => {
      const old = new Date(Date.now() - 30 * INVOICE_DELETE_WINDOW_MS).toISOString();
      stub.data["invoice.list"] = { data: [invoice({ createdAt: old })], total: 1 };
      renderAs("admin", Invoices);
      expect(screen.getByTitle("Delete invoice")).toBeInTheDocument();
    });

    it("only drafts / unfulfilled invoices offer delete, even to admin", () => {
      stub.data["invoice.list"] = { data: [invoice({ status: "sent" })], total: 1 };
      renderAs("admin", Invoices);
      expect(screen.queryByTitle("Delete invoice")).not.toBeInTheDocument();
    });

    it("accountant (read-only on invoices) can neither create nor delete", () => {
      renderAs("accountant", Invoices);
      expect(button(/New Invoice/)).not.toBeInTheDocument();
      expect(screen.queryByTitle("Delete invoice")).not.toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    beforeEach(() => {
      stub.data["invoice.list"] = { data: [], total: 0 };
    });

    it("offers the create button to roles that can create (header + empty state)", () => {
      renderAs("seller", Invoices);
      expect(screen.getAllByRole("button", { name: /New Invoice/ })).toHaveLength(2);
    });

    it("offers no create button to read-only roles", () => {
      renderAs("accountant", Invoices);
      expect(screen.queryAllByRole("button", { name: /New Invoice/ })).toHaveLength(0);
    });
  });

  describe("detail panel", () => {
    function openPanel(role: string, inv: Record<string, unknown>) {
      stub.data["invoice.list"] = { data: [inv], total: 1 };
      stub.data["invoice.getById"] = inv;
      renderAs(role, Invoices);
      // Real user path: the panel is mounted with no selection, then a row
      // click selects an invoice. This transition is what crashed when the
      // permission hook ran after the panel's early return.
      fireEvent.click(screen.getByText("INV-001"));
      return screen.getByRole("dialog");
    }

    it("opens without crashing when a row is clicked (hooks-order regression)", () => {
      const panel = openPanel("admin", invoice());
      expect(within(panel).getByText("Invoice INV-001")).toBeInTheDocument();
    });

    it.each(["admin", "seller_manager", "seller"])(
      "%s can edit an invoice of any age (the API has no edit time limit)",
      (role) => {
        const yearOld = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
        const panel = openPanel(role, invoice({ createdAt: yearOld }));
        expect(within(panel).getByRole("button", { name: "Edit" })).toBeEnabled();
      },
    );

    it("clicking Edit swaps the detail panel for the invoice editor", () => {
      const panel = openPanel("seller", invoice());
      expect(screen.getByRole("dialog", { name: "Invoice INV-001" })).toBe(panel);
      fireEvent.click(within(panel).getByRole("button", { name: "Edit" }));
      expect(screen.queryByRole("dialog", { name: "Invoice INV-001" })).not.toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Edit Invoice" })).toBeInTheDocument();
    });

    it("accountant (no update permission) gets no Edit button at all", () => {
      const panel = openPanel("accountant", invoice());
      expect(within(panel).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    });

    it("paid invoices show no Edit button even for admin", () => {
      const panel = openPanel("admin", invoice({ status: "paid", amountPaid: "118.00" }));
      expect(within(panel).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Payments — create / delete:Payment
// ═══════════════════════════════════════════════════════════════════════════

describe("Payments page", () => {
  const Payments = page(PaymentsRoute);
  const payment = {
    id: "pay-1", paymentNumber: "PAY-001", partyId: "p1", partyName: "Acme Traders",
    paymentDate: new Date().toISOString(), mode: "cash", referenceNumber: null,
    amount: "500.00", type: "received",
  };

  beforeEach(() => {
    stub.data["payment.list"] = { data: [payment], total: 1 };
  });

  it("admin can record and delete payments", () => {
    renderAs("admin", Payments);
    expect(button(/Record Payment/)).toBeInTheDocument();
    expect(labelled("Delete payment")).toBeInTheDocument();
  });

  it("seller can record payments but not delete them", () => {
    renderAs("seller", Payments);
    expect(button(/Record Payment/)).toBeInTheDocument();
    expect(labelled("Delete payment")).not.toBeInTheDocument();
  });

  it("an unrecognised role can neither record nor delete", () => {
    renderAs("unrecognised_role", Payments);
    expect(button(/Record Payment/)).not.toBeInTheDocument();
    expect(labelled("Delete payment")).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cash & Bank — create:BankAccount ("+ Add Account", "+ Add"),
//               create:BankTransaction ("Transfer")
// ═══════════════════════════════════════════════════════════════════════════

describe("Cash & Bank page", () => {
  const CashAndBank = page(CashAndBankRoute);

  beforeEach(() => {
    stub.data["bankAccount.list"] = [];
    stub.data["bankAccount.summary"] = { totalBalance: "0", cashInHand: "0", bankBalance: "0" };
  });

  it("accountant can add accounts and transfer", () => {
    renderAs("accountant", CashAndBank);
    expect(button("+ Add Account")).toBeInTheDocument();
    expect(button("+ Add")).toBeInTheDocument();
    expect(button("Transfer")).toBeInTheDocument();
  });

  it("seller_manager (read-only on bank) can neither add accounts nor transfer", () => {
    renderAs("seller_manager", CashAndBank);
    expect(button("+ Add Account")).not.toBeInTheDocument();
    expect(button("+ Add")).not.toBeInTheDocument();
    expect(button("Transfer")).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Recurring invoices — create / delete:RecurringInvoice
// ═══════════════════════════════════════════════════════════════════════════

describe("Recurring invoices page", () => {
  const Recurring = page(AutomatedInvoicesRoute);
  const template = {
    id: "tpl-1", name: "Monthly retainer", partyId: "p1", partyName: "Acme Traders",
    frequency: "monthly", status: "active", nextRunDate: new Date().toISOString(),
    lastRunDate: null, totalAmount: "1000.00", runCount: 0, lineItems: [],
  };

  describe("with rows", () => {
    beforeEach(() => {
      stub.data["recurringInvoice.list"] = { data: [template], total: 1 };
    });

    it("seller_manager can create and delete templates", () => {
      renderAs("seller_manager", Recurring);
      expect(button(/New Template/)).toBeInTheDocument();
      expect(labelled("Delete template")).toBeInTheDocument();
    });

    it("seller (read-only) can neither create nor delete templates", () => {
      renderAs("seller", Recurring);
      expect(button(/New Template/)).not.toBeInTheDocument();
      expect(labelled("Delete template")).not.toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    beforeEach(() => {
      stub.data["recurringInvoice.list"] = { data: [], total: 0 };
    });

    it("offers 'Create Template' to roles that can create", () => {
      renderAs("seller_manager", Recurring);
      expect(button(/Create Template/)).toBeInTheDocument();
    });

    it("offers no 'Create Template' to read-only roles", () => {
      renderAs("seller", Recurring);
      expect(button(/Create Template/)).not.toBeInTheDocument();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DocumentListPage — shared by quotations, proforma, delivery challans,
// sales returns and credit notes. All are Invoice-backed on the API.
// ═══════════════════════════════════════════════════════════════════════════

describe("DocumentListPage (quotations, proforma, challans, returns, credit notes)", () => {
  const config: DocumentListPageConfig = {
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
  };
  const doc = {
    id: "q1", invoiceNumber: "QT-001", status: "draft", type: "sale",
    party: { id: "p1", name: "Acme Traders" }, invoiceDate: new Date().toISOString(),
    dueDate: null, totalAmount: "118.00", relatedDocuments: [], lineItems: [],
  };
  const DocPage = () => <DocumentListPage config={config} />;

  describe("with a draft row", () => {
    beforeEach(() => {
      stub.data["quotation.list"] = { data: [doc], total: 1 };
    });

    it("seller_manager can create and delete drafts", () => {
      renderAs("seller_manager", DocPage);
      expect(button("+ New Quotation")).toBeInTheDocument();
      expect(button("Delete")).toBeInTheDocument();
    });

    it("seller can create but not delete", () => {
      renderAs("seller", DocPage);
      expect(button("+ New Quotation")).toBeInTheDocument();
      expect(button("Delete")).not.toBeInTheDocument();
    });

    it("accountant can neither create nor delete", () => {
      renderAs("accountant", DocPage);
      expect(button("+ New Quotation")).not.toBeInTheDocument();
      expect(button("Delete")).not.toBeInTheDocument();
    });

    it("the detail panel's Delete follows the same rule", () => {
      stub.data["invoice.getById"] = doc;
      renderAs("seller_manager", () => <DocumentListPage config={config} initialSelectedId="q1" />);
      // One in the row, one in the open panel footer.
      expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);
    });

    it("the detail panel hides Delete from roles without delete permission", () => {
      stub.data["invoice.getById"] = doc;
      renderAs("seller", () => <DocumentListPage config={config} initialSelectedId="q1" />);
      expect(screen.queryAllByRole("button", { name: "Delete" })).toHaveLength(0);
    });
  });

  describe("empty state", () => {
    beforeEach(() => {
      stub.data["quotation.list"] = { data: [], total: 0 };
    });

    it("offers the create button (header + empty state) to roles that can create", () => {
      renderAs("seller", DocPage);
      expect(screen.getAllByRole("button", { name: "+ New Quotation" })).toHaveLength(2);
    });

    it("offers no create button to read-only roles", () => {
      renderAs("accountant", DocPage);
      expect(screen.queryAllByRole("button", { name: "+ New Quotation" })).toHaveLength(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Root layout — sidebar navigation and dashboard redirect (canAccess)
// ═══════════════════════════════════════════════════════════════════════════

describe("Root layout navigation", () => {
  const Root = page(RootRoute);

  beforeEach(() => {
    vi.stubGlobal("__APP_VERSION__", "0.0.0-test");
    // jsdom has no matchMedia; the layout's useTheme hook reads it (same stub
    // approach as hooks/__tests__/useTheme.test.ts).
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: false,
      media: "(prefers-color-scheme: dark)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    stub.pathname = "/invoices";
    stub.data["tenant.list"] = [{ tenantId: "t1", tenantName: "Test Org", tenantSlug: "test", role: "owner" }];
    stub.data["business.list"] = [{ id: "biz-1", name: "Test Biz", gstRegistrationType: "regular", gstin: "27AABCU9603R1ZM" }];
    stub.data["business.canCreate"] = true;
    stub.data["tenant.canCreateOrg"] = false;
  });

  const nav = () => screen.getByRole("navigation");
  const navItem = (label: string) => within(nav()).queryByText(label, { exact: true });

  it("legacy 'owner' role (mapped to superadmin) sees every section", () => {
    renderAs("owner", Root);
    for (const label of ["Dashboard", "Invoices", "Parties", "Items", "Payments", "Cash & Bank", "Expenses", "Business Reports", "GST Returns"]) {
      expect(navItem(label), label).toBeInTheDocument();
    }
  });

  it("seller sees sales nav but not money/compliance", () => {
    renderAs("seller", Root);
    for (const label of ["Invoices", "Quotations", "Parties", "Items", "Payments", "Recurring Invoices"]) {
      expect(navItem(label), label).toBeInTheDocument();
    }
    for (const label of ["Dashboard", "Cash & Bank", "Expenses", "Business Reports", "GST Returns"]) {
      expect(navItem(label), label).not.toBeInTheDocument();
    }
  });

  it("seller_manager now sees Expenses, Cash & Bank and Reports (read access per API)", () => {
    renderAs("seller_manager", Root);
    for (const label of ["Dashboard", "Expenses", "Cash & Bank", "Business Reports"]) {
      expect(navItem(label), label).toBeInTheDocument();
    }
    expect(navItem("GST Returns")).not.toBeInTheDocument();
  });

  it("accountant sees money and compliance sections", () => {
    renderAs("accountant", Root);
    for (const label of ["Dashboard", "Payments", "Cash & Bank", "Expenses", "Business Reports", "GST Returns", "Input Tax Credit"]) {
      expect(navItem(label), label).toBeInTheDocument();
    }
  });

  it("shows every item while the role is not yet known (graceful degradation)", () => {
    renderAs(null, Root);
    for (const label of ["Dashboard", "Cash & Bank", "Expenses", "Business Reports"]) {
      expect(navItem(label), label).toBeInTheDocument();
    }
  });

  it("redirects a role without Report:read away from the dashboard", () => {
    stub.pathname = "/";
    renderAs("seller", Root);
    expect(stub.navigate).toHaveBeenCalledWith({ to: "/invoices" });
  });

  it("keeps a role with Report:read on the dashboard", () => {
    stub.pathname = "/";
    renderAs("accountant", Root);
    expect(stub.navigate).not.toHaveBeenCalledWith({ to: "/invoices" });
  });
});
