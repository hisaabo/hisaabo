/**
 * role-gating-tabs.test.tsx — renders the real tab screens (invoices, items,
 * parties, payments), the app layout, the business switcher and the
 * create-business screen per role, and asserts that every data-changing
 * control follows the permission the API checks for its mutation
 * (packages/shared/src/permissions.ts mirrors the API's CASL rules).
 *
 * Only boundaries are mocked: the tRPC client and Expo Router (shared stub),
 * plus native modules (safe-area, secure-store, constants, contacts).
 */

import React from "react";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { Ionicons } from "@expo/vector-icons";

// ── Boundary mocks ──────────────────────────────────────────────────────────

// The shared stub's auth.me session has no tenantId. AppLayout only shows its
// "no businesses yet" state once a tenant is selected, so auth.me is
// overridden here to add one; every other procedure is the shared stub.
jest.mock("../lib/trpc", () => {
  const { useRef } = require("react");
  const { trpcModule, stub } = require("../test-utils/trpc-stub");
  const me = {
    useQuery: () => {
      useRef(null);
      return {
        data:
          stub.session.role == null
            ? undefined
            : { role: stub.session.role, user: { id: "u1" }, tenantId: "tenant-1" },
        isLoading: stub.session.isLoading,
      };
    },
  };
  const auth = new Proxy({}, { get: (_t, p) => (p === "me" ? me : trpcModule.trpc.auth[p]) });
  return { trpc: new Proxy({}, { get: (_t, p) => (p === "auth" ? auth : trpcModule.trpc[p]) }) };
});
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

// Phone contacts (native). Tests set the permission and the contact list.
const mockContacts = {
  status: "undetermined" as "undetermined" | "granted" | "denied",
  data: [] as Array<{ id: string; name: string; phoneNumbers?: Array<{ number: string }> }>,
};
jest.mock("expo-contacts", () => ({
  Fields: { PhoneNumbers: "phoneNumbers", Emails: "emails", Name: "name" },
  SortTypes: { FirstName: "firstName" },
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: mockContacts.status })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: mockContacts.status })),
  getContactsAsync: jest.fn(() => Promise.resolve({ data: mockContacts.data })),
}));

// ── Real implementations under test ────────────────────────────────────────

import { stub, renderScreen } from "../test-utils/trpc-stub";
import { useBusinessStore } from "../stores/business";
import { useAuthStore } from "../stores/auth";
import { BusinessSwitcherSheet } from "../components/BusinessSwitcherSheet";

import PartyDetailScreen from "../../app/(app)/(parties)/[id]";
import PartyCreateScreen from "../../app/(app)/(parties)/create";
import PartyEditScreen from "../../app/(app)/(parties)/edit";
import ItemDetailScreen from "../../app/(app)/(items)/[id]";
import ItemCreateScreen from "../../app/(app)/(items)/create";
import ItemEditScreen from "../../app/(app)/(items)/edit";
import InvoiceDetailScreen from "../../app/(app)/(invoices)/[id]";
import InvoiceCreateScreen, { PartyPickerModal } from "../../app/(app)/(invoices)/create";
import InvoiceEditScreen from "../../app/(app)/(invoices)/edit";
import PaymentDetailScreen from "../../app/(app)/(payments)/[id]";
import PaymentCreateScreen from "../../app/(app)/(payments)/create";
import AppLayout from "../../app/(app)/_layout";
import CreateBusinessScreen from "../../app/(app)/create-business";

// ── Helpers ────────────────────────────────────────────────────────────────

const renderAs = renderScreen;

// Count Ionicons elements only (the inner element each icon renders would
// otherwise double-count).
const iconCount = (name: string) =>
  screen.UNSAFE_queryAllByType(Ionicons).filter((node) => node.props.name === name).length;
const pressIcon = (name: string) =>
  fireEvent.press(screen.UNSAFE_queryAllByType(Ionicons).find((node) => node.props.name === name)!);

// Pickers debounce their search input by 300 ms.
const waitForDebounce = () => act(() => new Promise((resolve) => setTimeout(resolve, 350)));
// Lets pending promise callbacks (e.g. the contacts permission check) settle.
const flushPromises = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(() => {
  jest.clearAllMocks();
  stub.reset();
  mockContacts.status = "undetermined";
  mockContacts.data = [];
  useBusinessStore.setState({ businessId: "biz-1", businessName: "Test Biz" } as never);
});

// ── Fixtures ───────────────────────────────────────────────────────────────

const PARTY = {
  id: "party-1",
  name: "Acme Traders",
  type: "customer",
  phone: "9999999999",
  email: null,
  gstin: null,
  pan: null,
  billingAddress: null,
  shippingAddress: null,
  state: null,
  stateCode: null,
  openingBalance: "0",
  creditLimit: null,
  creditPeriodDays: null,
  balance: "0",
};

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    name: "Widget",
    itemType: "product",
    itemMode: "simple",
    unit: "pcs",
    salePrice: "100.00",
    purchasePrice: "80.00",
    taxPercent: "18.00",
    stockQuantity: "10",
    lowStockAlert: null,
    hsn: null,
    sku: null,
    category: null,
    description: null,
    unitVariants: null,
    variants: [],
    ...overrides,
  };
}

const VARIANT = {
  id: "var-1",
  attributeValues: { Size: "M" },
  sku: null,
  salePrice: "120.00",
  purchasePrice: null,
  stockQuantity: "5",
  lowStockAlert: null,
};

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
    discountAmount: "0",
    notes: null,
    partyId: "party-1",
    party: { id: "party-1", name: "Acme Traders" },
    lineItems: [],
    relatedDocuments: [],
    ...overrides,
  };
}

function shipment(overrides: Record<string, unknown> = {}) {
  return {
    id: "ship-1",
    status: "pending",
    mode: "courier",
    carrier: null,
    trackingNumber: null,
    trackingUrl: null,
    cost: "0",
    shipmentDate: null,
    estimatedDelivery: null,
    actualDelivery: null,
    ...overrides,
  };
}

const PAYMENT = {
  id: "pay-1",
  paymentNumber: "PAY-001",
  amount: "500.00",
  mode: "cash",
  partyName: "Acme Traders",
  paymentDate: new Date().toISOString(),
  referenceNumber: null,
  notes: null,
  linkedInvoices: [],
};

// ── Party detail: merge ────────────────────────────────────────────────────

describe("Party detail — Merge follows delete:Party (party.merge)", () => {
  beforeEach(() => {
    stub.params.id = "party-1";
    stub.data["party.getById"] = PARTY;
  });

  it("admin sees the merge button and it opens the merge flow", () => {
    renderAs("admin", PartyDetailScreen);
    expect(iconCount("git-merge-outline")).toBe(1);
    pressIcon("git-merge-outline");
    expect(screen.getByPlaceholderText(/search/i)).toBeTruthy();
  });

  it("seller_manager (update:Party but not delete:Party) does not see merge", () => {
    renderAs("seller_manager", PartyDetailScreen);
    // Still sees edit — proves the screen rendered fully.
    expect(screen.getByText("Edit")).toBeTruthy();
    expect(iconCount("git-merge-outline")).toBe(0);
  });
});

// ── Payment detail ─────────────────────────────────────────────────────────

describe("Payment detail — edit follows update:Payment, delete follows delete:Payment", () => {
  beforeEach(() => {
    stub.params.id = "pay-1";
    stub.data["payment.getById"] = PAYMENT;
  });

  it("admin sees edit, the delete icon and Delete Payment", () => {
    renderAs("admin", PaymentDetailScreen);
    expect(iconCount("create-outline")).toBe(1);
    expect(screen.getByText("Delete Payment")).toBeTruthy();
    // header trash + full-width button icon
    expect(iconCount("trash-outline")).toBe(2);
  });

  it.each(["seller_manager", "seller", "accountant"])(
    "%s can edit but sees no delete control (delete:Payment is admin-only)",
    (role) => {
      renderAs(role, PaymentDetailScreen);
      expect(iconCount("create-outline")).toBe(1);
      expect(screen.queryByText("Delete Payment")).toBeNull();
      expect(iconCount("trash-outline")).toBe(0);
    },
  );

  it("edit icon enters edit mode and Save calls payment.update", () => {
    renderAs("accountant", PaymentDetailScreen);
    pressIcon("create-outline");
    fireEvent.press(screen.getByText("Save"));
    expect(stub.mutations["payment.update"]).toHaveLength(1);
  });

  it("a role without update:Payment sees no edit icon", () => {
    renderAs("unrecognised_role", PaymentDetailScreen);
    expect(screen.getByText("PAY-001")).toBeTruthy();
    expect(iconCount("create-outline")).toBe(0);
  });
});

// ── Invoice detail ─────────────────────────────────────────────────────────

describe("Invoice detail — status, payment, credit note / return, shipment actions", () => {
  beforeEach(() => {
    stub.params.id = "inv-1";
  });

  describe("status change (invoice.updateStatus → update:Invoice)", () => {
    beforeEach(() => {
      stub.data["invoice.getById"] = invoice({ status: "draft" });
    });

    it("seller sees Mark as Sent", () => {
      renderAs("seller", InvoiceDetailScreen);
      expect(screen.getByText("Mark as Sent")).toBeTruthy();
    });

    it("accountant does not see Mark as Sent", () => {
      renderAs("accountant", InvoiceDetailScreen);
      expect(screen.getByText("INV-001")).toBeTruthy();
      expect(screen.queryByText("Mark as Sent")).toBeNull();
    });
  });

  describe("Record Payment (payment.create → create:Payment)", () => {
    beforeEach(() => {
      stub.data["invoice.getById"] = invoice({ status: "sent" });
    });

    it("accountant sees Record Payment and it opens payment create", () => {
      renderAs("accountant", InvoiceDetailScreen);
      fireEvent.press(screen.getByText("Record Payment"));
      expect(stub.router.push).toHaveBeenCalledWith(
        expect.objectContaining({ pathname: "/(payments)/create" }),
      );
    });

    it("a role without create:Payment does not see Record Payment", () => {
      renderAs("unrecognised_role", InvoiceDetailScreen);
      expect(screen.getByText("INV-001")).toBeTruthy();
      expect(screen.queryByText("Record Payment")).toBeNull();
    });
  });

  describe("Issue Credit Note / Create Sales Return (document create → create:Invoice)", () => {
    beforeEach(() => {
      stub.data["invoice.getById"] = invoice({ status: "sent" });
    });

    it("seller sees both", () => {
      renderAs("seller", InvoiceDetailScreen);
      expect(screen.getByText("Issue Credit Note")).toBeTruthy();
      expect(screen.getByText("Create Sales Return")).toBeTruthy();
    });

    it("accountant sees neither", () => {
      renderAs("accountant", InvoiceDetailScreen);
      expect(screen.getByText("INV-001")).toBeTruthy();
      expect(screen.queryByText("Issue Credit Note")).toBeNull();
      expect(screen.queryByText("Create Sales Return")).toBeNull();
    });
  });

  describe("shipment actions (shipment.update → update:Invoice)", () => {
    beforeEach(() => {
      stub.data["invoice.getById"] = invoice({ status: "sent" });
    });

    it("seller sees Mark Shipped and Add Tracking on a pending shipment", () => {
      stub.data["shipment.list"] = { data: [shipment({ status: "pending" })] };
      renderAs("seller", InvoiceDetailScreen);
      expect(screen.getByText("Mark Shipped")).toBeTruthy();
      expect(screen.getByText("Add Tracking")).toBeTruthy();
    });

    it("seller sees Mark Delivered on a shipped shipment", () => {
      stub.data["shipment.list"] = { data: [shipment({ status: "shipped" })] };
      renderAs("seller", InvoiceDetailScreen);
      expect(screen.getByText("Mark Delivered")).toBeTruthy();
    });

    it("seller sees Add Tracking on a delivered shipment without tracking", () => {
      stub.data["shipment.list"] = { data: [shipment({ status: "delivered" })] };
      renderAs("seller", InvoiceDetailScreen);
      expect(screen.getByText("Add Tracking")).toBeTruthy();
    });

    it("Add Tracking → Save calls shipment.update", () => {
      stub.data["shipment.list"] = { data: [shipment({ status: "pending" })] };
      renderAs("seller", InvoiceDetailScreen);
      fireEvent.press(screen.getByText("Add Tracking"));
      fireEvent.changeText(screen.getByPlaceholderText("e.g. 1234567890"), "AWB123");
      fireEvent.press(screen.getByText("Save"));
      expect(stub.mutations["shipment.update"]).toHaveLength(1);
    });

    it.each(["pending", "shipped", "delivered"])(
      "accountant sees the %s shipment but no shipment action",
      (status) => {
        stub.data["shipment.list"] = { data: [shipment({ status })] };
        renderAs("accountant", InvoiceDetailScreen);
        expect(screen.getByText("Shipment")).toBeTruthy();
        expect(screen.queryByText("Mark Shipped")).toBeNull();
        expect(screen.queryByText("Mark Delivered")).toBeNull();
        expect(screen.queryByText("Add Tracking")).toBeNull();
      },
    );
  });
});

// ── Item detail ────────────────────────────────────────────────────────────

describe("Item detail — stock, unit and variant controls", () => {
  beforeEach(() => {
    stub.params.id = "item-1";
  });

  describe("simple product (Adjust → item.adjustStock, Unit pencil → item.renameUnit: update:Item)", () => {
    beforeEach(() => {
      stub.data["item.getById"] = item();
    });

    it("seller_manager sees Adjust and the unit pencil; Adjust submits item.adjustStock", () => {
      renderAs("seller_manager", ItemDetailScreen);
      expect(iconCount("pencil-outline")).toBe(1);
      fireEvent.press(screen.getByText("Adjust"));
      fireEvent.changeText(screen.getByPlaceholderText("0"), "3");
      fireEvent.press(screen.getByText("Confirm Adjustment"));
      expect(stub.mutations["item.adjustStock"]).toHaveLength(1);
    });

    it("unit cell remains pressable for seller_manager (no-op today — pre-existing)", () => {
      renderAs("seller_manager", ItemDetailScreen);
      expect(() => fireEvent.press(screen.getByText("Unit"))).not.toThrow();
    });

    it("seller sees the unit value but neither Adjust nor the unit pencil", () => {
      renderAs("seller", ItemDetailScreen);
      expect(screen.getByText("Unit")).toBeTruthy();
      expect(screen.getAllByText("pcs").length).toBeGreaterThan(0);
      expect(screen.queryByText("Adjust")).toBeNull();
      expect(iconCount("pencil-outline")).toBe(0);
    });
  });

  describe("variants (Add/edit → update:Item, delete → item.deleteVariant: delete:Item)", () => {
    beforeEach(() => {
      stub.data["item.getById"] = item({ itemMode: "variants", variants: [VARIANT] });
    });

    it("admin sees Add, variant edit and variant delete; delete calls item.deleteVariant", () => {
      renderAs("admin", ItemDetailScreen);
      expect(screen.getByText("Add")).toBeTruthy();
      // unit pencil + variant pencil
      expect(iconCount("pencil-outline")).toBe(2);
      // top-bar delete + variant delete
      expect(iconCount("trash-outline")).toBe(2);
      // Add / edit variant are no-ops today (pre-existing) but must not crash.
      fireEvent.press(screen.getByText("Add"));
      const pencils = screen.UNSAFE_queryAllByType(Ionicons).filter((n) => n.props.name === "pencil-outline");
      fireEvent.press(pencils[1]);

      const { Alert } = require("react-native");
      const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
      const trashes = screen.UNSAFE_queryAllByType(Ionicons).filter((n) => n.props.name === "trash-outline");
      fireEvent.press(trashes[1]);
      const buttons = alert.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
      act(() => buttons.find((b) => b.text === "Delete")!.onPress!());
      expect(stub.mutations["item.deleteVariant"]).toEqual([{ variantId: "var-1" }]);
      alert.mockRestore();
    });

    it("seller_manager sees Add and variant edit but no variant delete", () => {
      renderAs("seller_manager", ItemDetailScreen);
      expect(screen.getByText("Add")).toBeTruthy();
      expect(iconCount("pencil-outline")).toBe(2);
      expect(iconCount("trash-outline")).toBe(0);
    });

    it("seller sees the variant but no Add, edit or delete", () => {
      renderAs("seller", ItemDetailScreen);
      expect(screen.getByText("Size: M")).toBeTruthy();
      expect(screen.queryByText("Add")).toBeNull();
      expect(iconCount("pencil-outline")).toBe(0);
      expect(iconCount("trash-outline")).toBe(0);
    });
  });
});

// ── Invoice create: inline party / item creation ───────────────────────────

describe("Invoice create — inline create party (create:Party) and item (create:Item)", () => {
  describe("item picker", () => {
    const openItemPicker = () => fireEvent.press(screen.getByText("Tap to select item..."));

    it("seller_manager sees 'Create new item' when there are no items, and can create one", () => {
      stub.data["item.list"] = { data: [] };
      renderAs("seller_manager", InvoiceCreateScreen);
      openItemPicker();
      fireEvent.press(screen.getByText("Create new item"));
      expect(screen.getByText("New Item")).toBeTruthy();
    });

    it("seller (create:Invoice but not create:Item) does not see 'Create new item'", () => {
      stub.data["item.list"] = { data: [] };
      renderAs("seller", InvoiceCreateScreen);
      openItemPicker();
      expect(screen.getByText("No items yet")).toBeTruthy();
      expect(screen.queryByText("Create new item")).toBeNull();
    });

    it("seller_manager sees the 'Create \"<search>\" as new item' footer", async () => {
      stub.data["item.list"] = { data: [item()] };
      renderAs("seller_manager", InvoiceCreateScreen);
      openItemPicker();
      fireEvent.changeText(screen.getByPlaceholderText("Search items..."), "Gadget");
      await waitForDebounce();
      expect(screen.getByText('Create "Gadget" as new item')).toBeTruthy();
    });

    it("seller does not see the 'Create \"<search>\" as new item' footer", async () => {
      stub.data["item.list"] = { data: [item()] };
      renderAs("seller", InvoiceCreateScreen);
      openItemPicker();
      fireEvent.changeText(screen.getByPlaceholderText("Search items..."), "Gadget");
      await waitForDebounce();
      expect(screen.getAllByText("Widget").length).toBeGreaterThan(0);
      expect(screen.queryByText('Create "Gadget" as new item')).toBeNull();
    });
  });

  describe("party picker", () => {
    // No real role has create:Invoice without create:Party, so the denied
    // cases render the picker itself as accountant (a real role without
    // create:Party). The allowed cases go through the full screen.
    const Picker = () => (
      <PartyPickerModal visible type="sale" onSelect={jest.fn()} onClose={jest.fn()} />
    );
    const openPartyPicker = () => fireEvent.press(screen.getByText("Select party..."));

    it("seller sees 'Create new customer' when there are no parties", async () => {
      stub.data["party.list"] = { data: [] };
      renderAs("seller", InvoiceCreateScreen);
      openPartyPicker();
      await flushPromises();
      fireEvent.press(screen.getByText("Create new customer"));
      expect(screen.getByText("New Customer")).toBeTruthy();
    });

    it("a role without create:Party does not see 'Create new customer'", async () => {
      stub.data["party.list"] = { data: [] };
      renderAs("accountant", Picker);
      await flushPromises();
      expect(screen.getByText("No parties yet")).toBeTruthy();
      expect(screen.queryByText("Create new customer")).toBeNull();
    });

    it("seller sees the 'Create \"<search>\" as new customer' footer", async () => {
      stub.data["party.list"] = { data: [PARTY] };
      renderAs("seller", InvoiceCreateScreen);
      openPartyPicker();
      fireEvent.changeText(screen.getByPlaceholderText("Search parties & contacts..."), "Ravi");
      await waitForDebounce();
      expect(screen.getByText('Create "Ravi" as new customer')).toBeTruthy();
    });

    it("a role without create:Party does not see the footer", async () => {
      stub.data["party.list"] = { data: [PARTY] };
      renderAs("accountant", Picker);
      fireEvent.changeText(screen.getByPlaceholderText("Search parties & contacts..."), "Ravi");
      await waitForDebounce();
      expect(screen.getByText("Acme Traders")).toBeTruthy();
      expect(screen.queryByText('Create "Ravi" as new customer')).toBeNull();
    });

    it("seller sees phone contacts; picking one creates the party", async () => {
      mockContacts.status = "granted";
      mockContacts.data = [{ id: "c1", name: "Ravi Kumar", phoneNumbers: [{ number: "98765 43210" }] }];
      stub.data["party.list"] = { data: [PARTY] };
      renderAs("seller", InvoiceCreateScreen);
      openPartyPicker();
      await flushPromises();
      expect(screen.getByText("Phone Contacts")).toBeTruthy();

      const { Alert } = require("react-native");
      const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
      fireEvent.press(screen.getByText("Ravi Kumar"));
      const buttons = alert.mock.calls[0][2] as Array<{ text: string; onPress?: () => Promise<void> }>;
      await act(() => buttons.find((b) => b.text === "Create")!.onPress!());
      expect(stub.mutations["party.create"]).toEqual([
        expect.objectContaining({ name: "Ravi Kumar", phone: "9876543210" }),
      ]);
      alert.mockRestore();
    });

    it("a role without create:Party does not see phone contacts", async () => {
      mockContacts.status = "granted";
      mockContacts.data = [{ id: "c1", name: "Ravi Kumar", phoneNumbers: [{ number: "9876543210" }] }];
      stub.data["party.list"] = { data: [PARTY] };
      renderAs("accountant", Picker);
      await flushPromises();
      expect(screen.getByText("Acme Traders")).toBeTruthy();
      expect(screen.queryByText("Phone Contacts")).toBeNull();
      expect(screen.queryByText("Ravi Kumar")).toBeNull();
    });
  });
});

// ── Create / edit screens behind PermissionGate ───────────────────────────

describe("create/edit screens are gated (deep links)", () => {
  type Case = [label: string, Screen: React.ComponentType, allowed: string, denied: string, marker: string, setup?: () => void];
  const cases: Case[] = [
    ["(invoices)/create", InvoiceCreateScreen, "seller", "accountant", "Create Invoice"],
    ["(invoices)/edit", InvoiceEditScreen, "seller", "accountant", "Edit Invoice", () => {
      stub.params.id = "inv-1";
      stub.data["invoice.getById"] = invoice();
    }],
    ["(items)/create", ItemCreateScreen, "seller_manager", "seller", "New Item"],
    ["(items)/edit", ItemEditScreen, "seller_manager", "seller", "Edit Item", () => {
      stub.params.id = "item-1";
      stub.data["item.getById"] = item();
    }],
    ["(parties)/create", PartyCreateScreen, "seller", "accountant", "New Party"],
    ["(parties)/edit", PartyEditScreen, "seller_manager", "seller", "Edit Party", () => {
      stub.params.id = "party-1";
      stub.data["party.getById"] = PARTY;
    }],
    // Every real role may create payments.
    ["(payments)/create", PaymentCreateScreen, "accountant", "unrecognised_role", "Party *"],
    ["create-business", CreateBusinessScreen, "admin", "seller_manager", "Create Business"],
  ];

  describe.each(cases)("%s", (_label, Screen, allowed, denied, marker, setup) => {
    beforeEach(() => setup?.());

    it(`renders the form for ${allowed}`, () => {
      renderAs(allowed, Screen);
      expect(screen.queryByTestId("permission-denied")).toBeNull();
      expect(screen.getByText(marker)).toBeTruthy();
    });

    it(`shows the no-access state for ${denied}`, () => {
      renderAs(denied, Screen);
      expect(screen.getByTestId("permission-denied")).toBeTruthy();
      expect(screen.queryByText(marker)).toBeNull();
    });
  });
});

// ── Business creation entry points (business.create → manage:Business) ────

describe("Create business entry points follow manage:Business", () => {
  describe("AppLayout — no businesses yet", () => {
    beforeEach(() => {
      useAuthStore.setState({ token: "tok" } as never);
      useBusinessStore.setState({ businessId: null, businessName: null } as never);
      stub.data["business.list"] = [];
    });

    it("admin sees Create Business and it opens the create screen", () => {
      renderAs("admin", AppLayout);
      fireEvent.press(screen.getByText("Create Business"));
      expect(stub.router.push).toHaveBeenCalledWith("/(app)/create-business");
    });

    it("seller_manager does not see Create Business", () => {
      renderAs("seller_manager", AppLayout);
      expect(screen.getByText("No businesses yet")).toBeTruthy();
      expect(screen.queryByText("Create Business")).toBeNull();
    });
  });

  describe("BusinessSwitcherSheet", () => {
    const onCreateNew = jest.fn();
    const Sheet = ({ withCreate = true }: { withCreate?: boolean }) => (
      <BusinessSwitcherSheet
        visible
        onClose={jest.fn()}
        businesses={[{ id: "biz-1", name: "Test Biz" }]}
        activeBusinessId="biz-1"
        onSwitch={jest.fn()}
        onCreateNew={withCreate ? onCreateNew : undefined}
      />
    );

    it("admin sees Create New Business and it calls onCreateNew", () => {
      renderAs("admin", Sheet);
      fireEvent.press(screen.getByText("Create New Business"));
      expect(onCreateNew).toHaveBeenCalledTimes(1);
    });

    it("admin does not see it when the plan limit is reached (no onCreateNew)", () => {
      renderAs("admin", () => <Sheet withCreate={false} />);
      expect(screen.getByText("Test Biz")).toBeTruthy();
      expect(screen.queryByText("Create New Business")).toBeNull();
    });

    it.each(["seller_manager", "seller", "accountant"])("%s does not see Create New Business", (role) => {
      renderAs(role, Sheet);
      expect(screen.getByText("Test Biz")).toBeTruthy();
      expect(screen.queryByText("Create New Business")).toBeNull();
    });
  });
});
