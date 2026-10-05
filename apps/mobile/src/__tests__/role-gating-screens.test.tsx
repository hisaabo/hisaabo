/**
 * role-gating-screens.test.tsx — renders the real mobile screens and asserts
 * that Create / Edit / Delete affordances follow the shared permission matrix
 * (packages/shared/src/permissions.ts, kept in lock-step with the API's CASL
 * rules by packages/api/src/__tests__/permissions-parity.test.ts).
 *
 * WHY real screens rather than stand-ins:
 * The gating is a one-line `{canX && <Button/>}` inside each screen. A
 * stand-in component would only re-test the hook (already covered by
 * permissions.test.tsx); the regression we care about is a screen that
 * forgets to gate, or gates on the wrong action/resource.
 *
 * Only true boundaries are mocked — the tRPC client (network), Expo Router
 * (navigation), and native modules. The theme, styles, UI components, stores
 * and the useCan hooks are the real implementations.
 */

import React from "react";
import { fireEvent, screen } from "@testing-library/react-native";
import { Ionicons } from "@expo/vector-icons";

// ── Boundary mocks ──────────────────────────────────────────────────────────
// tRPC (network) and Expo Router (navigation) come from the shared stub; the
// rest are native modules.

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

// ── Real implementations under test ────────────────────────────────────────

import { ThemeProvider } from "../contexts/ThemeContext";
import { stub, renderScreen } from "../test-utils/trpc-stub";
import { useBusinessStore } from "../stores/business";
import { FAB } from "../components/ui";
import { INVOICE_DELETE_WINDOW_MS } from "@hisaabo/shared";

import PartiesScreen from "../../app/(app)/(parties)/index";
import PartyDetailScreen from "../../app/(app)/(parties)/[id]";
import ItemsScreen from "../../app/(app)/(items)/index";
import ItemDetailScreen from "../../app/(app)/(items)/[id]";
import InvoicesScreen from "../../app/(app)/(invoices)/index";
import InvoiceDetailScreen from "../../app/(app)/(invoices)/[id]";
import PaymentsScreen from "../../app/(app)/(payments)/index";

// ── Helpers ────────────────────────────────────────────────────────────────

const renderAs = renderScreen;

const fabCount = () => screen.UNSAFE_queryAllByType(FAB).length;
// Count Ionicons elements only — querying by props alone would also match
// the inner element each icon renders, double-counting every icon.
const iconCount = (name: string) =>
  screen.UNSAFE_queryAllByType(Ionicons).filter((node) => node.props.name === name).length;

beforeEach(() => {
  jest.clearAllMocks();
  stub.reset();
  useBusinessStore.setState({ businessId: "biz-1", businessName: "Test Biz" } as never);
});

// ── List screens: the "create" FAB ─────────────────────────────────────────

describe("list screens — create FAB follows `create` permission", () => {
  const cases: Array<[string, React.ComponentType, string, string]> = [
    // [label, screen, role that CAN create, role that CANNOT create]
    ["Parties",  PartiesScreen,  "seller",         "accountant"],
    ["Items",    ItemsScreen,    "seller_manager", "seller"],
    ["Invoices", InvoicesScreen, "seller",         "accountant"],
    // Every real role may create payments; only an unrecognised role cannot.
    ["Payments", PaymentsScreen, "accountant",     "unrecognised_role"],
  ];

  describe.each(cases)("%s", (_label, Screen, allowed, denied) => {
    it(`shows the FAB for ${allowed}`, () => {
      renderAs(allowed, Screen);
      expect(fabCount()).toBe(1);
    });

    it(`hides the FAB for ${denied}`, () => {
      renderAs(denied, Screen);
      expect(fabCount()).toBe(0);
    });

    it("shows the FAB while the session is still loading (no flash of hidden UI)", () => {
      renderAs(null, Screen, { loading: true });
      expect(fabCount()).toBe(1);
    });
  });
});

// ── Party detail ───────────────────────────────────────────────────────────

describe("Party detail — edit / merge / delete", () => {
  beforeEach(() => {
    stub.params.id = "party-1";
    stub.data["party.getById"] = {
      id: "party-1",
      name: "Acme Traders",
      type: "customer",
      phone: null,
      email: null,
      gstin: null,
      balance: "0",
    };
  });

  it("admin sees edit, merge and delete", () => {
    renderAs("admin", PartyDetailScreen);
    // Edit appears twice: the top-bar icon and the "Edit" action button.
    expect(iconCount("create-outline")).toBe(2);
    expect(iconCount("git-merge-outline")).toBe(1);
    expect(iconCount("trash-outline")).toBe(1);
    expect(screen.getByText("Edit")).toBeTruthy();
  });

  it("seller_manager can edit and merge but not delete", () => {
    renderAs("seller_manager", PartyDetailScreen);
    expect(iconCount("create-outline")).toBe(2);
    expect(iconCount("git-merge-outline")).toBe(1);
    expect(iconCount("trash-outline")).toBe(0);
  });

  it("seller sees no edit, merge or delete", () => {
    renderAs("seller", PartyDetailScreen);
    expect(iconCount("create-outline")).toBe(0);
    expect(iconCount("git-merge-outline")).toBe(0);
    expect(iconCount("trash-outline")).toBe(0);
    expect(screen.queryByText("Edit")).toBeNull();
  });
});

// ── Item detail ────────────────────────────────────────────────────────────

describe("Item detail — edit / actions menu / delete", () => {
  beforeEach(() => {
    stub.params.id = "item-1";
    stub.data["item.getById"] = {
      id: "item-1",
      name: "Widget",
      itemType: "product",
      itemMode: "simple",
      unit: "pcs",
      salePrice: "100.00",
      purchasePrice: "80.00",
      taxPercent: "18.00",
      stockQuantity: "10",
      lowStockThreshold: null,
      hsn: null,
      variants: [],
    };
  });

  it("admin sees edit, actions menu and delete", () => {
    renderAs("admin", ItemDetailScreen);
    expect(iconCount("create-outline")).toBe(1);
    expect(iconCount("ellipsis-vertical")).toBe(1);
    expect(iconCount("trash-outline")).toBe(1);
  });

  it("seller_manager can edit but not delete", () => {
    renderAs("seller_manager", ItemDetailScreen);
    expect(iconCount("create-outline")).toBe(1);
    expect(iconCount("ellipsis-vertical")).toBe(1);
    expect(iconCount("trash-outline")).toBe(0);
  });

  it("seller (read-only on items) sees none of the mutating actions", () => {
    renderAs("seller", ItemDetailScreen);
    expect(iconCount("create-outline")).toBe(0);
    expect(iconCount("ellipsis-vertical")).toBe(0);
    expect(iconCount("trash-outline")).toBe(0);
  });
});

// ── Invoice detail ─────────────────────────────────────────────────────────

describe("Invoice detail — edit and delete", () => {
  function invoice(overrides: Record<string, unknown> = {}) {
    return {
      id: "inv-1",
      invoiceNumber: "INV-001",
      type: "sale",
      documentType: "invoice",
      status: "draft",
      invoiceDate: new Date().toISOString(),
      dueDate: null,
      createdAt: new Date().toISOString(),
      subtotal: "100.00",
      totalTax: "18.00",
      totalAmount: "118.00",
      amountPaid: "0",
      totalAdjusted: "0",
      roundOff: "0",
      party: { id: "party-1", name: "Acme Traders" },
      lineItems: [],
      relatedDocuments: [],
      ...overrides,
    };
  }

  beforeEach(() => {
    stub.params.id = "inv-1";
  });

  const yearOld = () => new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const pastDeleteWindow = () => new Date(Date.now() - INVOICE_DELETE_WINDOW_MS - 60_000).toISOString();

  it("admin sees Edit Invoice and Delete Invoice", () => {
    stub.data["invoice.getById"] = invoice();
    renderAs("admin", InvoiceDetailScreen);
    expect(screen.getByText("Edit Invoice")).toBeTruthy();
    expect(screen.getByText("Delete Invoice")).toBeTruthy();
  });

  it("seller can edit but cannot delete", () => {
    stub.data["invoice.getById"] = invoice();
    renderAs("seller", InvoiceDetailScreen);
    expect(screen.getByText("Edit Invoice")).toBeTruthy();
    expect(screen.queryByText("Delete Invoice")).toBeNull();
  });

  it("seller can still edit a year-old invoice (the API has no edit time limit)", () => {
    stub.data["invoice.getById"] = invoice({ status: "sent", createdAt: yearOld() });
    renderAs("seller", InvoiceDetailScreen);
    expect(screen.getByText("Edit Invoice")).toBeTruthy();
  });

  it("accountant (read-only on invoices) sees neither edit nor delete", () => {
    stub.data["invoice.getById"] = invoice();
    renderAs("accountant", InvoiceDetailScreen);
    expect(screen.queryByText("Edit Invoice")).toBeNull();
    expect(screen.queryByText("Delete Invoice")).toBeNull();
  });

  it("seller_manager can delete a fresh unpaid invoice", () => {
    stub.data["invoice.getById"] = invoice();
    renderAs("seller_manager", InvoiceDetailScreen);
    expect(screen.getByText("Delete Invoice")).toBeTruthy();
  });

  it("seller_manager cannot delete an invoice older than 2 hours (API rejects it)", () => {
    stub.data["invoice.getById"] = invoice({ createdAt: pastDeleteWindow() });
    renderAs("seller_manager", InvoiceDetailScreen);
    expect(screen.queryByText("Delete Invoice")).toBeNull();
    // …but can still edit it.
    expect(screen.getByText("Edit Invoice")).toBeTruthy();
  });

  it("admin can delete an old invoice", () => {
    stub.data["invoice.getById"] = invoice({ createdAt: yearOld() });
    renderAs("admin", InvoiceDetailScreen);
    expect(screen.getByText("Delete Invoice")).toBeTruthy();
  });

  it("Edit Invoice opens the edit screen", () => {
    stub.data["invoice.getById"] = invoice();
    renderAs("seller", InvoiceDetailScreen);
    fireEvent.press(screen.getByText("Edit Invoice"));
    expect(stub.router.push).toHaveBeenCalledWith({ pathname: "/(app)/(invoices)/edit", params: { id: "inv-1" } });
  });
});

// ── Hook-order guard ──────────────────────────────────────────────────────
// Detail screens early-return while their record is missing. The permission
// hooks must run before those returns; otherwise the first render with data
// throws "Rendered more hooks than during the previous render" (this exact
// bug shipped once in the web invoice panel). Render without data, then with.

describe("detail screens survive the no-data → data transition", () => {
  const cases: Array<[string, React.ComponentType, string, Record<string, unknown>]> = [
    ["Party", PartyDetailScreen, "party.getById", {
      id: "party-1", name: "Acme Traders", type: "customer", phone: null, email: null, gstin: null, balance: "0",
    }],
    ["Item", ItemDetailScreen, "item.getById", {
      id: "item-1", name: "Widget", itemType: "product", itemMode: "simple", unit: "pcs", salePrice: "100.00",
      purchasePrice: "80.00", taxPercent: "18.00", stockQuantity: "10", lowStockThreshold: null, hsn: null, variants: [],
    }],
    ["Invoice", InvoiceDetailScreen, "invoice.getById", {
      id: "inv-1", invoiceNumber: "INV-001", type: "sale", documentType: "invoice", status: "draft",
      invoiceDate: new Date().toISOString(), dueDate: null, createdAt: new Date().toISOString(),
      subtotal: "100.00", totalTax: "18.00", totalAmount: "118.00", amountPaid: "0", totalAdjusted: "0",
      roundOff: "0", party: { id: "party-1", name: "Acme Traders" }, lineItems: [], relatedDocuments: [],
    }],
  ];

  it.each(cases)("%s detail", (_label, Screen, key, record) => {
    stub.params.id = String(record.id);
    const view = renderAs("admin", Screen);
    stub.data[key] = record;
    expect(() =>
      view.rerender(
        <ThemeProvider initialMode="dark">
          <Screen />
        </ThemeProvider>,
      ),
    ).not.toThrow();
    expect(iconCount("trash-outline") + screen.queryAllByText("Delete Invoice").length).toBeGreaterThan(0);
  });
});

// ── Gated buttons still go to the right place ─────────────────────────────

describe("gated buttons navigate correctly when shown", () => {
  it.each([
    ["Parties",  PartiesScreen,  "/(app)/(parties)/create"],
    ["Items",    ItemsScreen,    "/(app)/(items)/create"],
    ["Invoices", InvoicesScreen, "/(invoices)/create"],
    ["Payments", PaymentsScreen, "/(payments)/create"],
  ] as const)("%s FAB opens the create screen", (_label, Screen, route) => {
    renderAs("admin", Screen);
    fireEvent.press(screen.UNSAFE_getByType(FAB));
    expect(stub.router.push).toHaveBeenCalledWith(route);
  });

  describe("Party detail", () => {
    beforeEach(() => {
      stub.params.id = "party-1";
      stub.data["party.getById"] = {
        id: "party-1", name: "Acme Traders", type: "customer", phone: null, email: null, gstin: null, balance: "0",
      };
    });

    it("top-bar edit icon and Edit action both open the edit screen", () => {
      renderAs("admin", PartyDetailScreen);
      const editIcons = screen.UNSAFE_queryAllByType(Ionicons).filter((n) => n.props.name === "create-outline");
      fireEvent.press(editIcons[0]);
      fireEvent.press(screen.getByText("Edit"));
      expect(stub.router.push).toHaveBeenCalledTimes(2);
      for (const call of stub.router.push.mock.calls) {
        expect(call[0]).toEqual({ pathname: "/(app)/(parties)/edit", params: { id: "party-1" } });
      }
    });
  });

  describe("Item detail", () => {
    beforeEach(() => {
      stub.params.id = "item-1";
      stub.data["item.getById"] = {
        id: "item-1", name: "Widget", itemType: "product", itemMode: "simple", unit: "pcs", salePrice: "100.00",
        purchasePrice: "80.00", taxPercent: "18.00", stockQuantity: "10", lowStockThreshold: null, hsn: null, variants: [],
      };
    });

    it("edit icon opens the edit screen", () => {
      renderAs("admin", ItemDetailScreen);
      const edit = screen.UNSAFE_queryAllByType(Ionicons).find((n) => n.props.name === "create-outline")!;
      fireEvent.press(edit);
      expect(stub.router.push).toHaveBeenCalledWith({ pathname: "/(app)/(items)/edit", params: { id: "item-1" } });
    });

    it("actions button is pressable and does not navigate (its menu is not implemented yet — pre-existing)", () => {
      renderAs("admin", ItemDetailScreen);
      const more = screen.UNSAFE_queryAllByType(Ionicons).find((n) => n.props.name === "ellipsis-vertical")!;
      expect(() => fireEvent.press(more)).not.toThrow();
      expect(stub.router.push).not.toHaveBeenCalled();
    });
  });
});
