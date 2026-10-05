/**
 * Role gating — operations pages (items detail / editor, cash & bank,
 * bank reconciliation, journal entries, e-invoicing, e-way bills, ITC,
 * GSTR-2B and the POS register).
 *
 * Renders the REAL page components with only the network (tRPC) and router
 * navigation stubbed (see test-utils/trpc-stub.tsx). Every write control is
 * checked for a role whose permission matches what the API's `requireCan`
 * enforces for that mutation, and for a role that lacks it.
 *
 * Roles come from packages/shared/src/permissions.ts. Several of these pages
 * are only linked for admin/accountant today; the "lacks it" role is still a
 * real role (usually seller_manager) rendering the page by URL.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import type { ComponentType } from "react";

// ── Boundary stubs (tRPC network + router navigation) ──────────────────────

vi.mock("@/lib/trpc", async () => (await import("@/test-utils/trpc-stub")).trpcModule);
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("@/test-utils/trpc-stub")).routerOverrides,
}));

import { stub } from "@/test-utils/trpc-stub";

// ── Real implementations under test ────────────────────────────────────────

import { Route as ItemsRoute } from "@/routes/items";
import { Route as CashAndBankRoute } from "@/routes/cash-and-bank";
import { Route as BankReconRoute } from "@/routes/bank-reconciliation";
import { Route as JournalRoute } from "@/routes/journal-entries";
import { Route as EInvoicingRoute } from "@/routes/e-invoicing";
import { Route as EWayBillsRoute } from "@/routes/eway-bills";
import { Route as ITCRoute } from "@/routes/itc";
import { Route as GSTR2BRoute } from "@/routes/gstr2b";
import { POSShell } from "@/features/pos/POSShell";

const page = (route: { options: { component?: unknown } }) => route.options.component as ComponentType;

function renderAs(role: string | null, Page: ComponentType) {
  stub.session.role = role;
  return render(<Page />);
}

beforeEach(() => {
  stub.reset();
  localStorage.clear();
  sessionStorage.clear();
});

const button = (name: string | RegExp) => screen.queryByRole("button", { name });
const buttons = (name: string | RegExp) => screen.queryAllByRole("button", { name });
const labelled = (label: string | RegExp) => screen.queryByLabelText(label);
const pressGlobalKey = (key: string) => fireEvent.keyDown(document.body, { key });
const recent = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

// ═══════════════════════════════════════════════════════════════════════════
// Items — hotkey N (create:Item), detail footer Merge (delete:Item),
// Adjust Stock / Switch Unit / Edit Item (update:Item), variant × (delete:Item)
// ═══════════════════════════════════════════════════════════════════════════

describe("Items page (operations)", () => {
  const Items = page(ItemsRoute);
  const listRow = {
    id: "i1", name: "Widget", itemType: "product", itemMode: "simple", unit: "pcs",
    salePrice: "100.00", purchasePrice: "80.00", stockQuantity: "10", lowStockThreshold: null,
    hsn: null, taxPercent: "18.00",
  };
  const detail = (overrides: Record<string, unknown> = {}) => ({
    ...listRow,
    sku: "W-1", category: null, lowStockAlert: null, taxInclusive: false,
    unitVariants: [], variantAttributes: null, variants: [],
    ...overrides,
  });

  beforeEach(() => {
    stub.data["item.list"] = { data: [listRow], total: 1 };
  });

  describe("hotkey N (New item)", () => {
    it("opens the Add Item form for a role with create:Item", () => {
      renderAs("seller_manager", Items);
      expect(screen.queryByRole("dialog", { name: "Add Item" })).not.toBeInTheDocument();
      pressGlobalKey("n");
      expect(screen.getByRole("dialog", { name: "Add Item" })).toBeInTheDocument();
    });

    it("does nothing for a role without create:Item", () => {
      renderAs("seller", Items);
      pressGlobalKey("n");
      expect(screen.queryByRole("dialog", { name: "Add Item" })).not.toBeInTheDocument();
    });
  });

  describe("detail panel footer", () => {
    function openDetail(role: string, item = detail()) {
      stub.data["item.getById"] = item;
      renderAs(role, Items);
      fireEvent.click(screen.getByText("Widget"));
      return screen.getByRole("dialog", { name: "Widget" });
    }

    it("admin sees Merge, Adjust Stock, Switch Unit and Edit Item", () => {
      const panel = openDetail("admin");
      for (const name of ["Merge", "Adjust Stock", "Switch Unit", "Edit Item"]) {
        expect(within(panel).getByRole("button", { name }), name).toBeInTheDocument();
      }
    });

    it("seller_manager (update but not delete:Item) gets the edit actions but no Merge", () => {
      const panel = openDetail("seller_manager");
      for (const name of ["Adjust Stock", "Switch Unit", "Edit Item"]) {
        expect(within(panel).getByRole("button", { name }), name).toBeInTheDocument();
      }
      expect(within(panel).queryByRole("button", { name: "Merge" })).not.toBeInTheDocument();
    });

    it("seller (read-only on items) gets none of the footer actions", () => {
      const panel = openDetail("seller");
      for (const name of ["Merge", "Adjust Stock", "Switch Unit", "Edit Item"]) {
        expect(within(panel).queryByRole("button", { name }), name).not.toBeInTheDocument();
      }
    });

    it("accountant (read-only on items) gets none of the footer actions", () => {
      const panel = openDetail("accountant");
      for (const name of ["Merge", "Adjust Stock", "Switch Unit", "Edit Item"]) {
        expect(within(panel).queryByRole("button", { name }), name).not.toBeInTheDocument();
      }
    });
  });

  describe("variant controls in the item editor", () => {
    const variantItem = detail({
      itemMode: "variants",
      variantAttributes: ["Size"],
      variants: [
        { id: "v1", attributeValues: { Size: "L" }, sku: "W-L", salePrice: "120.00", purchasePrice: null, stockQuantity: "4" },
      ],
    });

    function openEditor(role: string) {
      stub.data["item.getById"] = variantItem;
      const view = renderAs(role, Items);
      fireEvent.click(screen.getByText("Widget"));
      fireEvent.click(screen.getByRole("button", { name: "Edit Item" }));
      return { view, editor: screen.getByRole("dialog", { name: "Edit Item" }) };
    }

    it("admin can edit, add and delete variants", () => {
      const { editor } = openEditor("admin");
      expect(within(editor).getByRole("button", { name: "Edit" })).toBeInTheDocument();
      expect(within(editor).getByRole("button", { name: "+ Add variant" })).toBeInTheDocument();
      fireEvent.click(within(editor).getByRole("button", { name: "×" }));
      expect(stub.mutations["item.deleteVariant"]).toEqual([{ variantId: "v1" }]);
    });

    it("seller_manager can edit variants but gets no delete (×)", () => {
      const { editor } = openEditor("seller_manager");
      expect(within(editor).getByRole("button", { name: "Edit" })).toBeInTheDocument();
      expect(within(editor).queryByRole("button", { name: "×" })).not.toBeInTheDocument();
      expect(stub.mutations["item.deleteVariant"]).toBeUndefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cash & Bank — Edit account (update:BankAccount), Delete Account
// (delete:BankAccount), Transactions card Transfer / + Add Transaction
// (create:BankTransaction), untracked-payment bulk assign (update:Payment)
// ═══════════════════════════════════════════════════════════════════════════

describe("Cash & Bank page (operations)", () => {
  const CashAndBank = page(CashAndBankRoute);
  const account = {
    id: "ba1", accountName: "HDFC Current", accountType: "current", bankName: "HDFC",
    accountNumber: "1234567890", ifsc: "HDFC0000001", upiId: null,
    openingBalance: "0", currentBalance: "1500.00", isDefault: false,
  };

  beforeEach(() => {
    stub.data["bankAccount.list"] = [account];
    stub.data["bankAccount.summary"] = { totalBalance: "1500", cashInHand: "0", bankBalance: "1500" };
    stub.data["bankAccount.listTransactions"] = { data: [], total: 0 };
    stub.data["bankAccount.getById"] = account;
  });

  describe("account edit / delete", () => {
    it("accountant can open the account editor and sees Delete Account", () => {
      renderAs("accountant", CashAndBank);
      fireEvent.click(screen.getByLabelText("Edit account"));
      const editor = screen.getByRole("dialog", { name: "Edit Account" });
      expect(within(editor).getByRole("button", { name: "Delete Account" })).toBeInTheDocument();
    });

    it("seller_manager (read-only on bank accounts) gets no Edit account button", () => {
      renderAs("seller_manager", CashAndBank);
      expect(labelled("Edit account")).not.toBeInTheDocument();
    });

    it("hides Delete Account when the session loses delete:BankAccount while the editor is open", () => {
      const { rerender } = renderAs("accountant", CashAndBank);
      fireEvent.click(screen.getByLabelText("Edit account"));
      stub.session.role = "seller_manager";
      rerender(<CashAndBank />);
      const editor = screen.getByRole("dialog", { name: "Edit Account" });
      expect(within(editor).queryByRole("button", { name: "Delete Account" })).not.toBeInTheDocument();
      expect(labelled("Edit account")).not.toBeInTheDocument();
    });
  });

  describe("transactions card", () => {
    function selectAccount(role: string) {
      renderAs(role, CashAndBank);
      fireEvent.click(screen.getByText("HDFC Current"));
      return screen.getByText("Transactions").parentElement as HTMLElement;
    }

    it("accountant gets Transfer and + Add Transaction on the card", () => {
      const header = selectAccount("accountant");
      expect(within(header).getByRole("button", { name: "Transfer" })).toBeInTheDocument();
      expect(within(header).getByRole("button", { name: "+ Add Transaction" })).toBeInTheDocument();
    });

    it("seller_manager gets neither", () => {
      const header = selectAccount("seller_manager");
      expect(within(header).queryByRole("button", { name: "Transfer" })).not.toBeInTheDocument();
      expect(within(header).queryByRole("button", { name: "+ Add Transaction" })).not.toBeInTheDocument();
    });
  });

  describe("untracked payments bulk assign", () => {
    beforeEach(() => {
      stub.data["payment.untrackedPayments"] = {
        data: [{
          id: "pay-1", paymentNumber: "PAY-001", partyName: "Acme Traders",
          paymentDate: new Date().toISOString(), mode: "cash", amount: "500.00",
        }],
        total: 1,
      };
    });

    function selectFirstPayment(role: string) {
      renderAs(role, CashAndBank);
      const row = screen.getByText("PAY-001").closest("tr") as HTMLElement;
      fireEvent.click(within(row).getByRole("checkbox"));
    }

    it("a role with update:Payment gets the assign toolbar", () => {
      selectFirstPayment("admin");
      expect(screen.getByText("Assign to:")).toBeInTheDocument();
      expect(button("Assign 1")).toBeInTheDocument();
    });

    it("a role without update:Payment gets no assign toolbar", () => {
      // Every real role that can read bank accounts has update:Payment.
      selectFirstPayment("unrecognised_role");
      expect(screen.queryByText("Assign to:")).not.toBeInTheDocument();
      expect(button(/^Assign/)).not.toBeInTheDocument();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Bank reconciliation — import (create), review actions (update),
// + Expense (create:Expense), rules (create/update/delete), templates
// (fork = create, delete = delete) on BankReconciliation
// ═══════════════════════════════════════════════════════════════════════════

describe("Bank reconciliation page", () => {
  const BankRecon = page(BankReconRoute);
  const account = {
    id: "ba1", accountName: "HDFC Current", bankName: "HDFC", accountType: "current",
    accountNumber: "1234567890", currentBalance: "1500.00",
  };
  const imp = {
    id: "imp-1", fileName: "statement.csv", status: "completed",
    totalLines: 3, matchedLines: 1, unmatchedLines: 2, createdAt: new Date().toISOString(),
  };
  const line = (id: string, matchStatus: string, extra: Record<string, unknown> = {}) => ({
    id, lineNumber: Number(id.slice(-1)), transactionDate: new Date().toISOString(),
    narration: `Line ${id}`, referenceNumber: null, debit: "0", credit: "0",
    matchStatus, matchConfidence: null, ...extra,
  });

  beforeEach(() => {
    stub.data["bankAccount.list"] = [account];
    stub.data["bankRecon.importList"] = { data: [imp], total: 1 };
  });

  describe("hub and upload entry points", () => {
    it("accountant can import statements (hub buttons and Upload tab)", () => {
      renderAs("accountant", BankRecon);
      expect(button("Import Statement")).toBeInTheDocument();
      expect(button("Upload & Map")).toBeInTheDocument();
    });

    it("seller_manager gets no import entry point", () => {
      renderAs("seller_manager", BankRecon);
      expect(button("Import Statement")).not.toBeInTheDocument();
      expect(button("Upload & Map")).not.toBeInTheDocument();
    });

    it("the empty-state Import Statement follows the same rule", () => {
      stub.data["bankRecon.importList"] = { data: [], total: 0 };
      stub.data["bankAccount.list"] = [];
      renderAs("accountant", BankRecon);
      expect(buttons("Import Statement")).toHaveLength(1);
    });

    it("the empty-state Import Statement is hidden without create permission", () => {
      stub.data["bankRecon.importList"] = { data: [], total: 0 };
      stub.data["bankAccount.list"] = [];
      renderAs("seller_manager", BankRecon);
      expect(buttons("Import Statement")).toHaveLength(0);
    });
  });

  describe("review matches", () => {
    beforeEach(() => {
      stub.data["bankRecon.importDetail"] = {
        fileName: "statement.csv", totalLines: 3, matchedLines: 1, unmatchedLines: 2,
        statementStartDate: null, statementEndDate: null,
      };
      stub.data["bankRecon.lines"] = {
        data: [
          line("l1", "auto_matched", { credit: "100.00", matchConfidence: "0.9" }),
          line("l2", "manual_matched", { credit: "50.00" }),
          line("l3", "unmatched", { debit: "75.00" }),
        ],
        total: 3,
      };
    });

    function openReview(role: string) {
      renderAs(role, BankRecon);
      fireEvent.click(screen.getByRole("button", { name: "Review" }));
    }

    it("accountant gets every review action", () => {
      openReview("accountant");
      for (const name of ["Confirm", "Reject", "Unmatch", "Match", "+ Expense", "Ignore"]) {
        expect(button(name), name).toBeInTheDocument();
      }
      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
      expect(stub.mutations["bankRecon.confirmMatch"]).toEqual([{ lineId: "l1" }]);
    });

    it("seller_manager gets none of them", () => {
      openReview("seller_manager");
      for (const name of ["Confirm", "Reject", "Unmatch", "Match", "+ Expense", "Ignore"]) {
        expect(button(name), name).not.toBeInTheDocument();
      }
    });
  });

  describe("rules", () => {
    const rule = {
      id: "r1", matchField: "narration", matchType: "contains", matchValue: "RENT",
      action: "create_expense", expenseCategory: "Rent", priority: 1, hitCount: 0, isActive: true,
    };

    function openRules(role: string) {
      renderAs(role, BankRecon);
      fireEvent.click(screen.getByRole("button", { name: "Rules" }));
    }

    it("accountant can create, edit and delete rules", () => {
      stub.data["bankRecon.ruleList"] = [rule];
      openRules("accountant");
      expect(button("+ New Rule")).toBeInTheDocument();
      expect(button("Edit")).toBeInTheDocument();
      expect(button("Delete")).toBeInTheDocument();
    });

    it("seller_manager can do none of it", () => {
      stub.data["bankRecon.ruleList"] = [rule];
      openRules("seller_manager");
      expect(button("+ New Rule")).not.toBeInTheDocument();
      expect(button("Edit")).not.toBeInTheDocument();
      expect(button("Delete")).not.toBeInTheDocument();
    });

    it("the empty-state + New Rule is offered only with create permission", () => {
      stub.data["bankRecon.ruleList"] = [];
      openRules("accountant");
      expect(buttons("+ New Rule")).toHaveLength(2);
    });

    it("the empty-state + New Rule is hidden without create permission", () => {
      stub.data["bankRecon.ruleList"] = [];
      openRules("seller_manager");
      expect(buttons("+ New Rule")).toHaveLength(0);
    });
  });

  describe("templates", () => {
    beforeEach(() => {
      stub.data["bankRecon.templateList"] = [
        { id: "t1", bankDisplayName: "HDFC Bank", version: 1, isSeeded: true, forkedFromId: null, fileFormat: "csv", label: null, isActive: true },
        { id: "t2", bankDisplayName: "My Bank", version: 1, isSeeded: false, forkedFromId: "t1", fileFormat: "csv", label: "Custom", isActive: true },
      ];
    });

    function openTemplates(role: string) {
      renderAs(role, BankRecon);
      fireEvent.click(screen.getByRole("button", { name: "Templates" }));
    }

    it("accountant can fork built-in templates and delete custom ones", () => {
      openTemplates("accountant");
      expect(button("Fork")).toBeInTheDocument();
      expect(button("Delete")).toBeInTheDocument();
    });

    it("seller_manager can do neither", () => {
      openTemplates("seller_manager");
      expect(button("Fork")).not.toBeInTheDocument();
      expect(button("Delete")).not.toBeInTheDocument();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Journal entries — + New Entry / hotkey N / Save as template / Use template
// (create:Account), Edit / Void (update:Account), Delete template
// (delete:Account)
// ═══════════════════════════════════════════════════════════════════════════

describe("Journal entries page", () => {
  const Journal = page(JournalRoute);
  const entry = {
    id: "je-1", entryNumber: "JE-001", entryDate: new Date().toISOString(),
    narration: "Accrued rent", totalAmount: "1000.00", source: "manual", isVoided: false,
  };
  const template = { id: "jt-1", name: "Monthly rent", narration: "Rent", lines: [] };

  beforeEach(() => {
    stub.data["journal.list"] = [entry];
    stub.data["account.list"] = [];
    stub.data["journal.templateList"] = [template];
  });

  it("accountant can create entries and act on rows", () => {
    renderAs("accountant", Journal);
    expect(button("+ New Entry")).toBeInTheDocument();
    expect(labelled("Edit entry")).toBeInTheDocument();
    expect(labelled("Void entry")).toBeInTheDocument();
    expect(labelled("Save as template")).toBeInTheDocument();
  });

  it("seller_manager (read-only on accounts) gets none of the write actions", () => {
    renderAs("seller_manager", Journal);
    expect(button("+ New Entry")).not.toBeInTheDocument();
    expect(labelled("Edit entry")).not.toBeInTheDocument();
    expect(labelled("Void entry")).not.toBeInTheDocument();
    expect(labelled("Save as template")).not.toBeInTheDocument();
  });

  it("hotkey N opens the new-entry form for accountant", () => {
    renderAs("accountant", Journal);
    pressGlobalKey("n");
    expect(screen.getByRole("dialog", { name: "New Journal Entry" })).toBeInTheDocument();
  });

  it("hotkey N does nothing for seller_manager", () => {
    renderAs("seller_manager", Journal);
    pressGlobalKey("n");
    expect(screen.queryByRole("dialog", { name: "New Journal Entry" })).not.toBeInTheDocument();
  });

  describe("templates tab", () => {
    function openTemplates(role: string) {
      renderAs(role, Journal);
      fireEvent.click(screen.getByRole("button", { name: "Templates" }));
    }

    it("accountant can use and delete templates", () => {
      openTemplates("accountant");
      expect(button("Use")).toBeInTheDocument();
      expect(labelled("Delete template")).toBeInTheDocument();
    });

    it("seller_manager can do neither", () => {
      openTemplates("seller_manager");
      expect(screen.getByText("Monthly rent")).toBeInTheDocument();
      expect(button("Use")).not.toBeInTheDocument();
      expect(labelled("Delete template")).not.toBeInTheDocument();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E-invoicing — every mutation requires manage:EInvoice
// ═══════════════════════════════════════════════════════════════════════════

describe("E-invoicing page", () => {
  const EInvoicing = page(EInvoicingRoute);
  const inv = (id: string, status: string | null, irn: string | null = null) => ({
    id, invoiceNumber: `INV-${id}`, invoiceDate: new Date().toISOString(), partyName: "Acme Traders",
    totalAmount: "118.00", irn, irnAckDate: null, eInvoiceStatus: status, eInvoiceError: null,
  });

  beforeEach(() => {
    stub.data["eInvoice.dashboard"] = {
      data: [inv("1", "failed"), inv("2", null), inv("3", "generated", "IRN-123")],
      total: 3,
      counts: { generated: 1, pending: 0, failed: 1, cancelled: 0 },
    };
  });

  it("admin gets Retry All Failed and the row actions", () => {
    renderAs("admin", EInvoicing);
    for (const name of ["Retry All Failed", "Retry", "Generate", "Cancel"]) {
      expect(button(name), name).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(stub.mutations["eInvoice.generate"]).toEqual([{ invoiceId: "2" }]);
  });

  it("accountant (read-only on e-invoices) gets none of them", () => {
    renderAs("accountant", EInvoicing);
    for (const name of ["Retry All Failed", "Retry", "Generate", "Cancel"]) {
      expect(button(name), name).not.toBeInTheDocument();
    }
  });

  describe("settings tab", () => {
    function openSettings(role: string) {
      renderAs(role, EInvoicing);
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    }

    it("admin can save settings and test the connection", () => {
      openSettings("admin");
      expect(button("Save Settings")).toBeInTheDocument();
      expect(button("Test Connection")).toBeInTheDocument();
    });

    it("accountant can do neither", () => {
      openSettings("accountant");
      expect(button("Save Settings")).not.toBeInTheDocument();
      expect(button("Test Connection")).not.toBeInTheDocument();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E-way bills — every mutation requires manage:EWayBill
// ═══════════════════════════════════════════════════════════════════════════

describe("E-way bills page", () => {
  const EWayBills = page(EWayBillsRoute);
  const row = {
    id: "ewb-1", ewbNumber: "EWB-001", invoiceId: "inv-1", invoiceNumber: "INV-001",
    partyName: "Acme Traders", transportMode: "road", vehicleNumber: "MH12AB1234",
    ewbDate: recent(), validUpto: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    status: "generated",
  };

  beforeEach(() => {
    stub.data["ewayBill.dashboard"] = { data: [row], total: 1, limit: 20, summary: { generated: 1 } };
    stub.data["ewayBill.expiringList"] = [row];
  });

  it("admin can generate, update vehicle and cancel", () => {
    renderAs("admin", EWayBills);
    fireEvent.click(screen.getByRole("button", { name: "+ Generate EWB" }));
    expect(screen.getByRole("dialog", { name: "Generate E-Way Bill" })).toBeInTheDocument();
    expect(screen.getByTitle("Update vehicle")).toBeInTheDocument();
    expect(screen.getByTitle("Cancel EWB")).toBeInTheDocument();
  });

  it("accountant (read-only on e-way bills) can do none of it", () => {
    renderAs("accountant", EWayBills);
    expect(button("+ Generate EWB")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Update vehicle")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Cancel EWB")).not.toBeInTheDocument();
  });

  describe("expiring tab", () => {
    function openExpiring(role: string) {
      renderAs(role, EWayBills);
      fireEvent.click(screen.getByRole("button", { name: "Expiring Soon" }));
    }

    it("admin gets Update Vehicle on expiring rows", () => {
      openExpiring("admin");
      expect(button("Update Vehicle")).toBeInTheDocument();
    });

    it("accountant does not", () => {
      openExpiring("accountant");
      expect(screen.getByText("EWB-001")).toBeInTheDocument();
      expect(button("Update Vehicle")).not.toBeInTheDocument();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ITC — Block / Unblock / Record Utilization (update:ITC)
// ═══════════════════════════════════════════════════════════════════════════

describe("ITC page", () => {
  const ITC = page(ITCRoute);
  const ledgerEntry = (id: string, status: string) => ({
    id, invoiceId: `inv-${id}`, invoiceNumber: `PUR-${id}`, partyName: "Supplier Co",
    invoiceDate: new Date().toISOString(), returnPeriod: "102026", status,
    cgst: "9.00", sgst: "9.00", igst: "0", cess: "0", isReverseCharge: false,
  });

  describe("ledger", () => {
    beforeEach(() => {
      localStorage.setItem("hisaabo_itc_tab", "ledger");
      stub.data["itc.ledger"] = {
        entries: [ledgerEntry("1", "available"), ledgerEntry("2", "blocked")],
        pagination: { total: 2 },
      };
    });

    it("accountant can block and unblock", () => {
      renderAs("accountant", ITC);
      expect(labelled("Block ITC for PUR-1")).toBeInTheDocument();
      expect(labelled("Unblock ITC for PUR-2")).toBeInTheDocument();
    });

    it("seller_manager (no ITC permission) can do neither", () => {
      renderAs("seller_manager", ITC);
      expect(screen.getByText("PUR-1")).toBeInTheDocument();
      expect(labelled("Block ITC for PUR-1")).not.toBeInTheDocument();
      expect(labelled("Unblock ITC for PUR-2")).not.toBeInTheDocument();
    });
  });

  describe("utilization", () => {
    beforeEach(() => {
      localStorage.setItem("hisaabo_itc_tab", "utilization");
    });

    it("accountant gets the Record Utilization form", () => {
      renderAs("accountant", ITC);
      expect(screen.getByText("Record Utilization")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Save Utilization" }));
      expect(stub.mutations["itc.recordUtilization"]).toHaveLength(1);
    });

    it("seller_manager does not", () => {
      renderAs("seller_manager", ITC);
      expect(screen.queryByText("Record Utilization")).not.toBeInTheDocument();
      expect(button("Save Utilization")).not.toBeInTheDocument();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GSTR-2B — upload and ignore both require create:GstReport
// ═══════════════════════════════════════════════════════════════════════════

describe("GSTR-2B page", () => {
  const GSTR2B = page(GSTR2BRoute);

  describe("upload", () => {
    it("admin lands on the Upload tab with the drop zone", () => {
      renderAs("admin", GSTR2B);
      expect(button("Upload")).toBeInTheDocument();
      expect(button("Upload GSTR-2B file")).toBeInTheDocument();
    });

    it("accountant (read-only on GST reports) gets no Upload tab and lands on Reconciliation", () => {
      renderAs("accountant", GSTR2B);
      expect(button("Upload")).not.toBeInTheDocument();
      expect(button("Upload GSTR-2B file")).not.toBeInTheDocument();
      expect(screen.getByText("No GSTR-2B data for this period")).toBeInTheDocument();
    });

    it("a remembered Upload tab still falls back to Reconciliation for accountant", () => {
      localStorage.setItem("hisaabo_gstr2b_tab", "upload");
      renderAs("accountant", GSTR2B);
      expect(button("Upload GSTR-2B file")).not.toBeInTheDocument();
      expect(screen.getByText("No GSTR-2B data for this period")).toBeInTheDocument();
    });
  });

  describe("reconciliation", () => {
    beforeEach(() => {
      localStorage.setItem("hisaabo_gstr2b_tab", "reconciliation");
      stub.data["gstr2b.summary"] = {
        hasData: true, uploadId: "up-1", matched: 0, mismatched: 0, missingInBooks: 1, pending: 0,
        itcAtRisk: { total: "0" }, itcAvailable: { total: "0" },
      };
      stub.data["gstr2b.records"] = {
        records: [{
          id: "rec-1", supplierGstin: "27AABCU9603R1ZM", supplierName: "Supplier Co",
          invoiceNumber: "S-001", invoiceDate: "2026-09-01", taxableValue: "100", cgst: "9",
          sgst: "9", igst: "0", itcAvailable: "Y", matchStatus: "missing_in_books", mismatchReasons: null,
        }],
        total: 1,
      };
    });

    it("admin can ignore a record", () => {
      renderAs("admin", GSTR2B);
      fireEvent.click(screen.getByLabelText("Ignore this record"));
      expect(stub.mutations["gstr2b.ignoreRecord"]).toEqual([{ recordId: "rec-1" }]);
    });

    it("accountant cannot", () => {
      renderAs("accountant", GSTR2B);
      expect(screen.getByText("S-001")).toBeInTheDocument();
      expect(labelled("Ignore this record")).not.toBeInTheDocument();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POS register — Pay / F9 (invoice.create + payment.create → create:Invoice
// and create:Payment), "+ New customer" (create:Party)
// ═══════════════════════════════════════════════════════════════════════════

describe("POS register", () => {
  const tile = {
    tileKey: "i1", itemId: "i1", variantId: null, displayName: "Widget", unit: "pcs",
    unitPrice: "100.00", taxPercent: "18.00", conversionFactor: "1", stockQuantity: "10",
  };
  const Register = () => <POSShell businessId="biz-1" walkInPartyId="walk-in" />;

  beforeEach(() => {
    stub.data["pos.catalog"] = { tiles: [tile], total: 1 };
    stub.data["party.list"] = { data: [], total: 0 };
  });

  const shellKey = (key: string) => fireEvent.keyDown(screen.getByLabelText("Exit POS"), { key });

  it("seller can check out: Pay button and F9 open the payment sheet", async () => {
    renderAs("seller", Register);
    fireEvent.click(screen.getByRole("button", { name: /Widget/ }));
    expect(button(/^Pay/)).toBeEnabled();
    shellKey("F9");
    expect(screen.getByText("Take Payment")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm Cash" }));
    });
    expect(stub.mutations["invoice.create"]).toHaveLength(1);
  });

  it("accountant (no create:Invoice) gets no Pay button and F9 does nothing", () => {
    renderAs("accountant", Register);
    fireEvent.click(screen.getByRole("button", { name: /Widget/ }));
    expect(button(/^Pay/)).not.toBeInTheDocument();
    shellKey("F9");
    expect(screen.queryByText("Take Payment")).not.toBeInTheDocument();
    expect(stub.mutations["invoice.create"]).toBeUndefined();
  });

  it("seller can add a new customer from the picker", () => {
    renderAs("seller", Register);
    shellKey("F3");
    fireEvent.click(screen.getByRole("button", { name: "+ New customer" }));
    expect(screen.getByText("Add customer")).toBeInTheDocument();
  });

  it("accountant (no create:Party) cannot add customers from the picker", () => {
    renderAs("accountant", Register);
    shellKey("F3");
    expect(screen.getByPlaceholderText("Search name or phone…")).toBeInTheDocument();
    expect(button("+ New customer")).not.toBeInTheDocument();
  });
});
