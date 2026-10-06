/**
 * role-gating-more.test.tsx — renders the real screens under app/(app)/(more)
 * per role and asserts that every control which calls a data-changing API is
 * present only for roles the API would allow (packages/shared/src/permissions.ts,
 * which mirrors the API's requireCan rules).
 *
 * Covers: payments, expenses, bank, quotations, proforma invoices, credit
 * notes, sales returns, delivery challans, shipments, automated (recurring)
 * invoices, store orders, and settings (index rows, business, documents,
 * online store). Create/edit screens are checked for their PermissionGate.
 *
 * Only true boundaries are mocked (tRPC, Expo Router, native modules); the
 * screens, theme, UI components and useCan hooks are the real ones.
 */

import React from "react";
import { fireEvent, screen } from "@testing-library/react-native";
import { Ionicons } from "@expo/vector-icons";
import { Alert, Switch } from "react-native";

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

import { ThemeProvider } from "../contexts/ThemeContext";
import { stub, renderScreen } from "../test-utils/trpc-stub";
import { useBusinessStore } from "../stores/business";
import { FAB } from "../components/ui";

import PaymentsListScreen from "../../app/(app)/(more)/payments/index";
import PaymentDetailScreen from "../../app/(app)/(more)/payments/[id]";
import PaymentCreateScreen from "../../app/(app)/(more)/payments/create";
import ExpensesListScreen from "../../app/(app)/(more)/expenses/index";
import ExpenseDetailScreen from "../../app/(app)/(more)/expenses/[id]";
import ExpenseCreateScreen from "../../app/(app)/(more)/expenses/create";
import BankListScreen from "../../app/(app)/(more)/bank/index";
import BankDetailScreen from "../../app/(app)/(more)/bank/[id]";
import BankCreateScreen from "../../app/(app)/(more)/bank/create";
import BankEditScreen from "../../app/(app)/(more)/bank/edit";
import BankTransferScreen from "../../app/(app)/(more)/bank/transfer";
import QuotationsListScreen from "../../app/(app)/(more)/quotations/index";
import QuotationCreateScreen from "../../app/(app)/(more)/quotations/create";
import ProformaListScreen from "../../app/(app)/(more)/proforma-invoices/index";
import ProformaCreateScreen from "../../app/(app)/(more)/proforma-invoices/create";
import CreditNotesListScreen from "../../app/(app)/(more)/credit-notes/index";
import CreditNoteDetailScreen from "../../app/(app)/(more)/credit-notes/[id]";
import CreditNoteCreateScreen from "../../app/(app)/(more)/credit-notes/create";
import SalesReturnsListScreen from "../../app/(app)/(more)/sales-returns/index";
import SalesReturnDetailScreen from "../../app/(app)/(more)/sales-returns/[id]";
import SalesReturnCreateScreen from "../../app/(app)/(more)/sales-returns/create";
import ChallansListScreen from "../../app/(app)/(more)/delivery-challans/index";
import ChallanDetailScreen from "../../app/(app)/(more)/delivery-challans/[id]";
import ChallanCreateScreen from "../../app/(app)/(more)/delivery-challans/create";
import ShipmentsListScreen from "../../app/(app)/(more)/shipments/index";
import ShipmentDetailScreen from "../../app/(app)/(more)/shipments/[id]";
import ShipmentCreateScreen from "../../app/(app)/(more)/shipments/create";
import RecurringListScreen from "../../app/(app)/(more)/automated-invoices/index";
import RecurringDetailScreen from "../../app/(app)/(more)/automated-invoices/[id]";
import RecurringCreateScreen from "../../app/(app)/(more)/automated-invoices/create";
import StoreOrderDetailScreen from "../../app/(app)/(more)/store-orders/[id]";
import SettingsIndexScreen from "../../app/(app)/(more)/settings/index";
import BusinessSettingsScreen from "../../app/(app)/(more)/settings/business";
import DocumentsSettingsScreen from "../../app/(app)/(more)/settings/documents";
import StoreSettingsScreen from "../../app/(app)/(more)/settings/store";

// ── Helpers ────────────────────────────────────────────────────────────────

const renderAs = renderScreen;
const fabCount = () => screen.UNSAFE_queryAllByType(FAB).length;
// Count Ionicons elements only (props-only queries double-count each icon).
const iconCount = (name: string) =>
  screen.UNSAFE_queryAllByType(Ionicons).filter((node) => node.props.name === name).length;
const pressIcon = (name: string, index = 0) =>
  fireEvent.press(screen.UNSAFE_queryAllByType(Ionicons).filter((n) => n.props.name === name)[index]);
const has = (text: string) => screen.queryAllByText(text).length > 0;
const denied = () => screen.queryByTestId("permission-denied") !== null;

const now = () => new Date().toISOString();

beforeEach(() => {
  jest.clearAllMocks();
  stub.reset();
  useBusinessStore.setState({ businessId: "biz-1", businessName: "Test Biz" } as never);
});

// ── Fixtures ───────────────────────────────────────────────────────────────

const payment = {
  id: "pay-1",
  paymentNumber: "PAY-00001",
  amount: "500.00",
  mode: "cash",
  partyName: "Acme Traders",
  paymentDate: now(),
  referenceNumber: null,
  notes: null,
  linkedInvoices: [],
};

const expense = {
  id: "exp-1",
  category: "Rent",
  description: "Office rent",
  amount: "1000.00",
  mode: "bank",
  expenseDate: now(),
  referenceNumber: null,
};

const bankAccount = {
  id: "acc-1",
  accountName: "HDFC Current",
  accountType: "current",
  bankName: "HDFC",
  accountNumber: "12345678",
  ifsc: "HDFC0001",
  currentBalance: "2500.00",
  isDefault: false,
};

const docRow = (id: string, status: string) => ({
  id,
  invoiceNumber: `DOC-${id}`,
  partyName: "Acme Traders",
  invoiceDate: now(),
  totalAmount: "118.00",
  status,
});
const docList = { data: [docRow("d1", "draft"), docRow("d2", "sent")], total: 2 };

const invoiceDoc = (status: string) => ({
  id: "doc-1",
  invoiceNumber: "CN-00001",
  status,
  invoiceDate: now(),
  totalAmount: "118.00",
  discountAmount: "0",
  subtotal: "100.00",
  notes: null,
  referenceDocumentId: null,
  party: { id: "party-1", name: "Acme Traders" },
  lineItems: [],
});

const shipment = (status: string) => ({
  id: "shp-1",
  status,
  carrier: "Delhivery",
  trackingNumber: "TRK1",
  trackingUrl: null,
  mode: "road",
  shipmentDate: now(),
  estimatedDelivery: null,
  actualDelivery: null,
  cost: null,
  weight: null,
  shippingAddress: null,
  shippingCity: null,
  shippingPincode: null,
  invoiceNumber: null,
  partyName: "Acme Traders",
  notes: null,
});

const template = (status: string) => ({
  id: "rec-1",
  name: "Monthly retainer",
  type: "sale",
  status,
  frequency: "monthly",
  customIntervalDays: null,
  startDate: now(),
  endDate: null,
  nextRunDate: now(),
  lastRunDate: null,
  totalRuns: 0,
  maxRuns: null,
  partyName: "Acme Traders",
  notes: null,
  lineItems: [],
});

const storeOrder = (status: string) => ({
  id: "ord-1",
  orderNumber: "ORD-1",
  status,
  customerName: "Walk-in",
  customerPhone: null,
  customerEmail: null,
  deliveryAddress: null,
  deliveryCity: null,
  deliveryPincode: null,
  createdAt: now(),
  confirmedAt: null,
  cancellationReason: null,
  itemCount: 0,
  lineItems: [],
  totalAmount: "0",
});

const business = {
  id: "biz-1",
  name: "Test Biz",
  legalName: null,
  gstRegistrationType: "unregistered",
  gstin: null,
  pan: null,
  phone: null,
  email: null,
  address: null,
  city: null,
  state: null,
  pincode: null,
  invoicePrefix: "INV",
  nextInvoiceNumber: 1,
};

// ── List screens: create FAB ──────────────────────────────────────────────

describe("list screens — create FAB follows the router's create permission", () => {
  const cases: Array<[string, React.ComponentType, string, string, string]> = [
    // [label, screen, role that CAN, role that CANNOT, route]
    ["Payments (create:Payment)", PaymentsListScreen, "accountant", "unrecognised_role", "/(more)/payments/create"],
    ["Expenses (create:Expense)", ExpensesListScreen, "accountant", "seller_manager", "/(more)/expenses/create"],
    ["Bank (create:BankAccount)", BankListScreen, "accountant", "seller_manager", "/(more)/bank/create"],
    ["Quotations (create:Invoice)", QuotationsListScreen, "seller", "accountant", "/(more)/quotations/create"],
    ["Proforma (create:Invoice)", ProformaListScreen, "seller", "accountant", "/(more)/proforma-invoices/create"],
    ["Credit notes (create:Invoice)", CreditNotesListScreen, "seller", "accountant", "/(more)/credit-notes/create"],
    ["Sales returns (create:Invoice)", SalesReturnsListScreen, "seller", "accountant", "/(more)/sales-returns/create"],
    ["Delivery challans (create:Invoice)", ChallansListScreen, "seller", "accountant", "/(more)/delivery-challans/create"],
    ["Shipments (create:Invoice)", ShipmentsListScreen, "seller", "accountant", "/(more)/shipments/create"],
    ["Automated invoices (create:RecurringInvoice)", RecurringListScreen, "seller_manager", "seller", "/(more)/automated-invoices/create"],
  ];

  describe.each(cases)("%s", (_label, Screen, allowed, deniedRole, route) => {
    it(`shows the FAB for ${allowed} and it opens the create screen`, () => {
      renderAs(allowed, Screen);
      expect(fabCount()).toBe(1);
      fireEvent.press(screen.UNSAFE_getByType(FAB));
      expect(stub.router.push).toHaveBeenCalledWith(route);
    });

    it(`hides the FAB for ${deniedRole}`, () => {
      renderAs(deniedRole, Screen);
      expect(fabCount()).toBe(0);
    });

    it("hides the FAB while the session is still loading (fail closed)", () => {
      renderAs(null, Screen, { loading: true });
      expect(fabCount()).toBe(0);
    });
  });
});

// ── Create / edit screens: PermissionGate ─────────────────────────────────

describe("create/edit screens are wrapped in PermissionGate", () => {
  const cases: Array<[string, React.ComponentType, string, string]> = [
    ["payments/create (create:Payment)", PaymentCreateScreen, "seller", "unrecognised_role"],
    ["expenses/create (create:Expense)", ExpenseCreateScreen, "accountant", "seller_manager"],
    ["bank/create (create:BankAccount)", BankCreateScreen, "accountant", "seller_manager"],
    ["bank/edit (update:BankAccount)", BankEditScreen, "accountant", "seller"],
    ["bank/transfer (create:BankTransaction)", BankTransferScreen, "accountant", "seller_manager"],
    ["quotations/create (create:Invoice)", QuotationCreateScreen, "seller", "accountant"],
    ["proforma-invoices/create (create:Invoice)", ProformaCreateScreen, "seller", "accountant"],
    ["credit-notes/create (create:Invoice)", CreditNoteCreateScreen, "seller", "accountant"],
    ["sales-returns/create (create:Invoice)", SalesReturnCreateScreen, "seller", "accountant"],
    ["delivery-challans/create (create:Invoice)", ChallanCreateScreen, "seller", "accountant"],
    ["shipments/create (create:Invoice)", ShipmentCreateScreen, "seller", "accountant"],
    ["automated-invoices/create (create:RecurringInvoice)", RecurringCreateScreen, "seller_manager", "accountant"],
    ["settings/business (manage:Business)", BusinessSettingsScreen, "admin", "seller_manager"],
    ["settings/documents (manage:Business)", DocumentsSettingsScreen, "admin", "accountant"],
    ["settings/store (update:Store)", StoreSettingsScreen, "seller_manager", "seller"],
  ];

  beforeEach(() => {
    stub.params.id = "acc-1";
    stub.data["bankAccount.getById"] = bankAccount;
    stub.data["business.getById"] = business;
  });

  describe.each(cases)("%s", (_label, Screen, allowed, deniedRole) => {
    it(`renders the form for ${allowed}`, () => {
      renderAs(allowed, Screen);
      expect(denied()).toBe(false);
      expect(screen.toJSON()).not.toBeNull();
    });

    it(`shows the no-access state for ${deniedRole}`, () => {
      renderAs(deniedRole, Screen);
      expect(screen.getByTestId("permission-denied")).toBeTruthy();
    });
  });
});

// ── Payment detail ────────────────────────────────────────────────────────

describe("Payment detail — edit (update:Payment) / delete (delete:Payment)", () => {
  beforeEach(() => {
    stub.params.id = "pay-1";
    stub.data["payment.getById"] = payment;
  });

  it("admin sees edit and both delete controls", () => {
    renderAs("admin", PaymentDetailScreen);
    expect(iconCount("create-outline")).toBe(1);
    expect(iconCount("trash-outline")).toBe(2);
    expect(has("Delete Payment")).toBe(true);
  });

  it("seller_manager can edit but sees no delete control", () => {
    renderAs("seller_manager", PaymentDetailScreen);
    expect(iconCount("create-outline")).toBe(1);
    expect(iconCount("trash-outline")).toBe(0);
    expect(has("Delete Payment")).toBe(false);
  });

  it("an unrecognised role sees neither edit nor delete", () => {
    renderAs("unrecognised_role", PaymentDetailScreen);
    expect(iconCount("create-outline")).toBe(0);
    expect(iconCount("trash-outline")).toBe(0);
  });

  it("edit enters edit mode and Save calls payment.update", () => {
    renderAs("seller", PaymentDetailScreen);
    pressIcon("create-outline");
    fireEvent.press(screen.getByText("Save"));
    expect(stub.mutations["payment.update"]).toHaveLength(1);
  });
});

// ── Expense detail ────────────────────────────────────────────────────────

describe("Expense detail — edit (update:Expense) / delete (delete:Expense)", () => {
  beforeEach(() => {
    stub.params.id = "exp-1";
    stub.data["expense.list"] = { data: [expense], total: 1 };
  });

  it("accountant sees edit and both delete controls", () => {
    renderAs("accountant", ExpenseDetailScreen);
    expect(iconCount("create-outline")).toBe(1);
    expect(iconCount("trash-outline")).toBe(2);
    expect(has("Delete Expense")).toBe(true);
  });

  it("seller_manager (read-only on expenses) sees no edit or delete", () => {
    renderAs("seller_manager", ExpenseDetailScreen);
    expect(iconCount("create-outline")).toBe(0);
    expect(iconCount("trash-outline")).toBe(0);
    expect(has("Delete Expense")).toBe(false);
  });

  it("seller (no expense access) sees no edit or delete", () => {
    renderAs("seller", ExpenseDetailScreen);
    expect(iconCount("create-outline")).toBe(0);
    expect(iconCount("trash-outline")).toBe(0);
    expect(has("Delete Expense")).toBe(false);
  });

  it("edit enters edit mode and Save calls expense.update", () => {
    renderAs("accountant", ExpenseDetailScreen);
    pressIcon("create-outline");
    fireEvent.press(screen.getByText("Save"));
    expect(stub.mutations["expense.update"]).toHaveLength(1);
  });
});

// ── Bank ──────────────────────────────────────────────────────────────────

describe("Bank list — transfer (create:BankTransaction) / row edit (update:BankAccount)", () => {
  beforeEach(() => {
    stub.data["bankAccount.list"] = [bankAccount];
    stub.data["bankAccount.summary"] = { totalBalance: "2500", cashInHand: "0", bankBalance: "2500" };
  });

  it("accountant sees the transfer and row edit controls", () => {
    renderAs("accountant", BankListScreen);
    expect(iconCount("swap-horizontal-outline")).toBe(1);
    expect(iconCount("create-outline")).toBe(1);
    pressIcon("swap-horizontal-outline");
    pressIcon("create-outline");
    expect(stub.router.push).toHaveBeenCalledWith("/(more)/bank/transfer");
    expect(stub.router.push).toHaveBeenCalledWith("/(more)/bank/edit?id=acc-1");
  });

  it("seller_manager (read-only on bank) sees neither", () => {
    renderAs("seller_manager", BankListScreen);
    expect(iconCount("swap-horizontal-outline")).toBe(0);
    expect(iconCount("create-outline")).toBe(0);
  });
});

describe("Bank detail — edit / delete / set default / add transaction", () => {
  beforeEach(() => {
    stub.params.id = "acc-1";
    stub.data["bankAccount.getById"] = bankAccount;
    stub.data["bankAccount.listTransactions"] = { data: [], total: 0 };
  });

  it("accountant sees every control", () => {
    renderAs("accountant", BankDetailScreen);
    expect(iconCount("create-outline")).toBe(1);
    expect(iconCount("trash-outline")).toBe(1);
    expect(has("Set as Default")).toBe(true);
    expect(has("Add Transaction")).toBe(true);
    fireEvent.press(screen.getByText("Set as Default"));
    expect(stub.mutations["bankAccount.update"]).toEqual([{ id: "acc-1", data: { isDefault: true } }]);
    pressIcon("create-outline");
    expect(stub.router.push).toHaveBeenCalledWith("/(more)/bank/edit?id=acc-1");
    expect(() => fireEvent.press(screen.getByText("Add Transaction"))).not.toThrow();
  });

  it("seller_manager sees none of them", () => {
    renderAs("seller_manager", BankDetailScreen);
    expect(iconCount("create-outline")).toBe(0);
    expect(iconCount("trash-outline")).toBe(0);
    expect(has("Set as Default")).toBe(false);
    expect(has("Add Transaction")).toBe(false);
  });
});

// ── Document lists (quotation, proforma, CN, SR, DC) ──────────────────────

describe("Quotation / proforma lists — convert, mark sent, cancel, delete", () => {
  const cases: Array<[string, React.ComponentType, string]> = [
    ["Quotations", QuotationsListScreen, "quotation"],
    ["Proforma", ProformaListScreen, "proforma"],
  ];

  describe.each(cases)("%s", (_label, Screen, router) => {
    beforeEach(() => {
      stub.data[`${router}.list`] = docList;
    });

    it("seller can convert, mark sent and cancel but not delete", () => {
      renderAs("seller", Screen);
      expect(screen.getAllByText("To Invoice")).toHaveLength(2);
      expect(has("Mark Sent")).toBe(true);
      expect(has("Cancel")).toBe(true);
      expect(has("Delete")).toBe(false);
      fireEvent.press(screen.getByText("Mark Sent"));
      expect(stub.mutations[`${router}.updateStatus`]).toEqual([{ id: "d1", status: "sent" }]);
    });

    it("seller_manager also sees Delete", () => {
      renderAs("seller_manager", Screen);
      expect(has("Delete")).toBe(true);
    });

    it("accountant (read-only on invoices) sees no actions", () => {
      renderAs("accountant", Screen);
      expect(has("To Invoice")).toBe(false);
      expect(has("Mark Sent")).toBe(false);
      expect(has("Cancel")).toBe(false);
      expect(has("Delete")).toBe(false);
    });
  });
});

describe("Credit note / sales return / delivery challan lists — status actions and delete", () => {
  const cases: Array<[string, React.ComponentType, string, string[]]> = [
    ["Credit notes", CreditNotesListScreen, "creditNote", ["Mark Sent", "Mark Paid", "Cancel"]],
    ["Sales returns", SalesReturnsListScreen, "salesReturn", ["Mark Sent", "Cancel"]],
    ["Delivery challans", ChallansListScreen, "deliveryChallan", ["Mark Sent", "Cancel"]],
  ];

  describe.each(cases)("%s", (_label, Screen, router, updateActions) => {
    beforeEach(() => {
      stub.data[`${router}.list`] = docList;
    });

    it("seller sees the status actions but not Delete", () => {
      renderAs("seller", Screen);
      for (const a of updateActions) expect(has(a)).toBe(true);
      expect(has("Delete")).toBe(false);
    });

    it("seller_manager also sees Delete", () => {
      renderAs("seller_manager", Screen);
      expect(has("Delete")).toBe(true);
    });

    it("accountant sees no actions", () => {
      renderAs("accountant", Screen);
      for (const a of updateActions) expect(has(a)).toBe(false);
      expect(has("Delete")).toBe(false);
    });
  });
});

describe("document list actions call the right procedure when pressed (admin)", () => {
  // Accept every confirmation dialog by pressing its last (confirming) button.
  beforeEach(() => {
    jest.spyOn(Alert, "alert").mockImplementation((_title, _msg, buttons) => {
      buttons?.[buttons.length - 1]?.onPress?.();
    });
  });
  afterEach(() => jest.restoreAllMocks());

  const cases: Array<[string, React.ComponentType, string, string[], string | null]> = [
    // [label, screen, router, status actions on d1/d2, detail route]
    ["Quotations", QuotationsListScreen, "quotation", ["Mark Sent", "Cancel"], null],
    ["Proforma", ProformaListScreen, "proforma", ["Mark Sent", "Cancel"], null],
    ["Credit notes", CreditNotesListScreen, "creditNote", ["Mark Sent", "Mark Paid", "Cancel"], "/(more)/credit-notes/d1"],
    ["Sales returns", SalesReturnsListScreen, "salesReturn", ["Mark Sent", "Cancel"], "/(more)/sales-returns/d1"],
    ["Delivery challans", ChallansListScreen, "deliveryChallan", ["Mark Sent", "Cancel"], "/(more)/delivery-challans/d1"],
  ];

  it.each(cases)("%s", (_label, Screen, router, statusActions, detailRoute) => {
    stub.data[`${router}.list`] = docList;
    renderAs("admin", Screen);
    for (const a of statusActions) fireEvent.press(screen.getByText(a));
    fireEvent.press(screen.getByText("Delete"));
    expect(stub.mutations[`${router}.updateStatus`]).toHaveLength(statusActions.length);
    expect(stub.mutations[`${router}.delete`]).toEqual([{ id: "d1" }]);
    if (detailRoute) {
      fireEvent.press(screen.getByText("DOC-d1"));
      expect(stub.router.push).toHaveBeenCalledWith(detailRoute);
    } else {
      fireEvent.press(screen.getAllByText("To Invoice")[0]);
      expect(stub.mutations["document.convert"]).toEqual([{ sourceDocumentId: "d1", targetDocumentType: "invoice" }]);
    }
  });
});

// ── Document details ──────────────────────────────────────────────────────

describe("Credit note / sales return detail — mark sent (update:Invoice) / delete (delete:Invoice)", () => {
  const cases: Array<[string, React.ComponentType, string, string]> = [
    ["Credit note", CreditNoteDetailScreen, "Delete Credit Note", "creditNote"],
    ["Sales return", SalesReturnDetailScreen, "Delete Sales Return", "salesReturn"],
  ];

  describe.each(cases)("%s", (_label, Screen, deleteLabel) => {
    beforeEach(() => {
      stub.params.id = "doc-1";
      stub.data["invoice.getById"] = invoiceDoc("draft");
    });

    it("seller can mark sent but not delete", () => {
      renderAs("seller", Screen);
      expect(has("Mark as Sent")).toBe(true);
      expect(has(deleteLabel)).toBe(false);
    });

    it("seller_manager can delete", () => {
      renderAs("seller_manager", Screen);
      expect(has(deleteLabel)).toBe(true);
    });

    it("accountant sees neither", () => {
      renderAs("accountant", Screen);
      expect(has("Mark as Sent")).toBe(false);
      expect(has(deleteLabel)).toBe(false);
    });
  });
});

describe("Delivery challan detail — status (update:Invoice) / convert (create:Invoice)", () => {
  beforeEach(() => {
    stub.params.id = "doc-1";
    stub.data["deliveryChallan.getById"] = invoiceDoc("draft");
  });

  it("seller sees Mark as Sent, Mark as Delivered and Convert to Invoice", () => {
    renderAs("seller", ChallanDetailScreen);
    expect(has("Mark as Sent")).toBe(true);
    expect(has("Mark as Delivered")).toBe(true);
    expect(has("Convert to Invoice")).toBe(true);
  });

  it("accountant sees none of them", () => {
    renderAs("accountant", ChallanDetailScreen);
    expect(has("Mark as Sent")).toBe(false);
    expect(has("Mark as Delivered")).toBe(false);
    expect(has("Convert to Invoice")).toBe(false);
  });
});

describe("Shipment detail — status (update:Invoice) / delete (delete:Invoice)", () => {
  beforeEach(() => {
    stub.params.id = "shp-1";
    stub.data["shipment.getById"] = shipment("pending");
  });

  it("seller can advance the status but not delete", () => {
    renderAs("seller", ShipmentDetailScreen);
    expect(has("Mark as Shipped")).toBe(true);
    expect(has("Delete")).toBe(false);
  });

  it("seller_manager can delete", () => {
    renderAs("seller_manager", ShipmentDetailScreen);
    expect(has("Delete")).toBe(true);
  });

  it("accountant sees neither", () => {
    renderAs("accountant", ShipmentDetailScreen);
    expect(has("Mark as Shipped")).toBe(false);
    expect(has("Delete")).toBe(false);
  });
});

// ── Automated invoices ────────────────────────────────────────────────────

describe("Automated invoice detail — edit / delete / pause / run now", () => {
  beforeEach(() => {
    stub.params.id = "rec-1";
    stub.data["recurringInvoice.getById"] = template("active");
    stub.data["recurringInvoice.executionHistory"] = { data: [], total: 0 };
  });

  it("seller_manager sees every control", () => {
    renderAs("seller_manager", RecurringDetailScreen);
    expect(iconCount("create-outline")).toBe(1);
    expect(iconCount("trash-outline")).toBe(2);
    expect(has("Delete Template")).toBe(true);
    expect(has("Pause")).toBe(true);
    expect(has("Run Now")).toBe(true);
  });

  it("seller (read-only) sees none of them", () => {
    renderAs("seller", RecurringDetailScreen);
    expect(iconCount("create-outline")).toBe(0);
    expect(iconCount("trash-outline")).toBe(0);
    expect(has("Delete Template")).toBe(false);
    expect(has("Pause")).toBe(false);
    expect(has("Run Now")).toBe(false);
  });

  it("edit enters edit mode and Save calls recurringInvoice.update", () => {
    renderAs("admin", RecurringDetailScreen);
    pressIcon("create-outline");
    fireEvent.press(screen.getByText("Save"));
    expect(stub.mutations["recurringInvoice.update"]).toHaveLength(1);
  });
});

// ── Store orders ──────────────────────────────────────────────────────────

describe("Store order detail — confirm / next status / cancel (update:Store)", () => {
  beforeEach(() => {
    stub.params.id = "ord-1";
  });

  it("seller_manager sees Confirm Order and Cancel Order on a pending order", () => {
    stub.data["store.getOrder"] = storeOrder("pending");
    renderAs("seller_manager", StoreOrderDetailScreen);
    expect(has("Confirm Order")).toBe(true);
    expect(has("Cancel Order")).toBe(true);
  });

  it("seller_manager sees the next-status action on a confirmed order", () => {
    stub.data["store.getOrder"] = storeOrder("confirmed");
    renderAs("seller_manager", StoreOrderDetailScreen);
    expect(has("Mark Preparing")).toBe(true);
  });

  it("seller sees no order actions", () => {
    stub.data["store.getOrder"] = storeOrder("pending");
    renderAs("seller", StoreOrderDetailScreen);
    expect(has("Confirm Order")).toBe(false);
    expect(has("Cancel Order")).toBe(false);
  });

  it("seller sees no next-status action", () => {
    stub.data["store.getOrder"] = storeOrder("confirmed");
    renderAs("seller", StoreOrderDetailScreen);
    expect(has("Mark Preparing")).toBe(false);
  });
});

// ── Settings ──────────────────────────────────────────────────────────────

describe("Settings index — rows that lead only to edit screens", () => {
  it("admin sees Business Details, Documents and Online Store", () => {
    renderAs("admin", SettingsIndexScreen);
    expect(has("Business Details")).toBe(true);
    expect(has("Documents")).toBe(true);
    expect(has("Online Store")).toBe(true);
    fireEvent.press(screen.getByText("Business Details"));
    expect(stub.router.push).toHaveBeenCalledWith("/(more)/settings/business");
  });

  it("seller_manager sees Online Store but not the business rows", () => {
    renderAs("seller_manager", SettingsIndexScreen);
    expect(has("Business Details")).toBe(false);
    expect(has("Documents")).toBe(false);
    expect(has("Online Store")).toBe(true);
  });

  it("seller sees none of them, nor Team or API Keys, but still sees Profile and Sign Out", () => {
    renderAs("seller", SettingsIndexScreen);
    expect(has("API Keys")).toBe(false);
    expect(has("Business Details")).toBe(false);
    expect(has("Documents")).toBe(false);
    expect(has("Online Store")).toBe(false);
    expect(has("Team")).toBe(false);
    expect(has("Profile")).toBe(true);
    expect(has("Sign Out")).toBe(true);
  });

  it("admin sees Team and API Keys", () => {
    renderAs("admin", SettingsIndexScreen);
    expect(has("Team")).toBe(true);
    expect(has("API Keys")).toBe(true);
  });
});

describe("Store settings — Save and toggles need manage:Store", () => {
  beforeEach(() => {
    stub.data["store.getSettings"] = {
      storeEnabled: true,
      storeSlug: "test-biz",
      storeTagline: "",
      storeWhatsappNumber: "",
      storeMinOrderAmount: "",
      storeDeliveryNote: "",
      storeAllowNegativeStock: false,
    };
    stub.data["store.listStoreItems"] = { data: [], total: 0 };
  });

  const editTagline = () =>
    fireEvent.changeText(screen.getByPlaceholderText("Fresh organic produce delivered daily"), "Fresh");

  it("admin sees both toggles and Save once the form is dirty", () => {
    renderAs("admin", StoreSettingsScreen);
    expect(screen.UNSAFE_queryAllByType(Switch)).toHaveLength(2);
    editTagline();
    fireEvent.press(screen.getByText("Save"));
    expect(stub.mutations["store.updateSettings"]).toHaveLength(1);
  });

  it("seller_manager can manage items but sees no toggles and no Save", () => {
    renderAs("seller_manager", StoreSettingsScreen);
    expect(screen.UNSAFE_queryAllByType(Switch)).toHaveLength(0);
    expect(has("Manage")).toBe(true);
    editTagline();
    expect(has("Save")).toBe(false);
  });
});

describe("Business / documents settings render their edit controls for admin", () => {
  beforeEach(() => {
    stub.data["business.getById"] = business;
  });

  it("business: Save calls business.update", () => {
    renderAs("admin", BusinessSettingsScreen);
    fireEvent.press(screen.getByText("Save"));
    expect(stub.mutations["business.update"]).toHaveLength(1);
  });

  it("documents: sequence Change buttons are shown", () => {
    renderAs("admin", DocumentsSettingsScreen);
    expect(screen.getAllByText("Change").length).toBeGreaterThan(0);
  });
});

// ── Hook-order guard ──────────────────────────────────────────────────────
// Detail screens early-return while loading / without a record. The new
// permission hooks must run before those returns; otherwise the first render
// with data throws "Rendered more hooks than during the previous render".

describe("detail screens survive the no-data → data transition", () => {
  const cases: Array<[string, React.ComponentType, string, string, unknown]> = [
    ["Payment", PaymentDetailScreen, "pay-1", "payment.getById", payment],
    ["Expense", ExpenseDetailScreen, "exp-1", "expense.list", { data: [expense], total: 1 }],
    ["Bank account", BankDetailScreen, "acc-1", "bankAccount.getById", bankAccount],
    ["Credit note", CreditNoteDetailScreen, "doc-1", "invoice.getById", invoiceDoc("draft")],
    ["Sales return", SalesReturnDetailScreen, "doc-1", "invoice.getById", invoiceDoc("draft")],
    ["Delivery challan", ChallanDetailScreen, "doc-1", "deliveryChallan.getById", invoiceDoc("draft")],
    ["Shipment", ShipmentDetailScreen, "shp-1", "shipment.getById", shipment("pending")],
    ["Automated invoice", RecurringDetailScreen, "rec-1", "recurringInvoice.getById", template("active")],
    ["Store order", StoreOrderDetailScreen, "ord-1", "store.getOrder", storeOrder("pending")],
  ];

  it.each(cases)("%s detail", (_label, Screen, id, key, record) => {
    stub.params.id = id;
    const view = renderAs("admin", Screen);
    stub.data[key] = record;
    expect(() =>
      view.rerender(
        <ThemeProvider initialMode="dark">
          <Screen />
        </ThemeProvider>,
      ),
    ).not.toThrow();
  });
});
