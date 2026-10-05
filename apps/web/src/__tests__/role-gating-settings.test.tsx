/**
 * Role gating — Settings page (Business, Documents, Shipping, Online Store,
 * Data tabs) and the Import wizard.
 *
 * Renders the REAL settings route component (and the real ImportWizard) with
 * only the tRPC client and router navigation stubbed (see
 * src/test-utils/trpc-stub.tsx). Each test asserts that a control which
 * triggers a data-changing API call is shown to a role whose permission
 * allows that call and hidden from one whose permission does not.
 *
 * Permissions mirror what the API checks:
 *  - business.update / uploadLogo / deleteLogo  → tenant admin  → manage:Business
 *  - business.updateSequenceNumber / exportData → requireCan manage:Business
 *  - store.updateSettings                       → requireCan manage:Store
 *  - store.bulkToggleItems                      → requireCan update:Store
 *  - import.*                                   → requireCan manage:Import
 *
 * Roles (packages/shared/src/permissions.ts): only admin/superadmin hold
 * manage:Business, manage:Store and manage:Import. seller_manager holds
 * update:Store (but not delete:Store, so not manage:Store). seller and
 * accountant hold read:Store only.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";

// ── Boundary stubs (tRPC network + router navigation) ──────────────────────

vi.mock("@/lib/trpc", async () => (await import("@/test-utils/trpc-stub")).trpcModule);
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("@/test-utils/trpc-stub")).routerOverrides,
}));

import { stub } from "@/test-utils/trpc-stub";

// ── Real implementations under test ────────────────────────────────────────

import { Route as SettingsRoute } from "@/routes/settings";
import { ImportWizard } from "@/components/ImportWizard";

const Settings = SettingsRoute.options.component as ComponentType;

// ── Fixtures ───────────────────────────────────────────────────────────────

const biz = {
  id: "biz-1",
  name: "Acme Traders",
  legalName: "Acme Traders Pvt Ltd",
  gstin: null,
  pan: null,
  phone: "+919876543210",
  email: "acme@example.com",
  address: "1 MG Road",
  city: "Bengaluru",
  state: "Karnataka",
  pincode: "560001",
  currency: "INR",
  logoMimeType: "image/png",
  logoUpdatedAt: "2026-01-01T00:00:00.000Z",
  invoicePrefix: "INV",
  nextInvoiceNumber: 42,
  paymentPrefix: "PAY",
  nextPaymentNumber: 7,
  quotationPrefix: "QT",
  nextQuotationNumber: 3,
  creditNotePrefix: "CN",
  nextCreditNoteNumber: 1,
  deliveryChallanPrefix: "DC",
  nextDeliveryChallanNumber: 1,
  proformaPrefix: "PF",
  nextProformaNumber: 1,
  defaultRoundOff: true,
  defaultTermsAndConditions: "",
  customShippingMethods: [],
};

const storeSettings = {
  storeEnabled: true,
  storeSlug: "acme",
  storeTagline: "Fresh produce",
  storeWhatsappNumber: "",
  storeMinOrderAmount: "",
  storeDeliveryNote: "",
  storeAllowNegativeStock: false,
};

const storeItems = {
  data: [
    { id: "i1", name: "Basmati Rice", category: "Grains", salePrice: "120", unit: "kg", storeEnabled: true },
  ],
  total: 1,
};

function renderTab(role: string, tab: string) {
  stub.session.role = role;
  sessionStorage.setItem("settings-tab", tab);
  return render(<Settings />);
}

const button = (name: string | RegExp) => screen.queryByRole("button", { name });

beforeEach(() => {
  stub.reset();
  sessionStorage.clear();
  stub.data["business.list"] = [biz];
  stub.data["business.canCreate"] = true;
  stub.data["store.getSettings"] = storeSettings;
  stub.data["store.listStoreItems"] = storeItems;
});

// ═══════════════════════════════════════════════════════════════════════════
// Business tab — Edit (business.update) and logo (uploadLogo / deleteLogo)
// ═══════════════════════════════════════════════════════════════════════════

describe("Business tab", () => {
  it("admin sees Edit and can open the edit form", () => {
    renderTab("admin", "business");
    // Read-only details are shown to everyone.
    expect(screen.getByText("Acme Traders Pvt Ltd")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();
  });

  it("DB role owner (maps to superadmin) sees Edit", () => {
    renderTab("owner", "business");
    expect(button("Edit")).toBeInTheDocument();
  });

  it.each(["seller_manager", "seller", "accountant"])(
    "%s sees the business details but no Edit button",
    (role) => {
      renderTab(role, "business");
      expect(screen.getByText("Acme Traders Pvt Ltd")).toBeInTheDocument();
      expect(button("Edit")).not.toBeInTheDocument();
      expect(button("Save Changes")).not.toBeInTheDocument();
    },
  );

  it("admin sees the logo Choose file and Remove controls", () => {
    renderTab("admin", "business");
    expect(screen.getByAltText("Current business logo")).toBeInTheDocument();
    expect(button("Choose file")).toBeInTheDocument();
    expect(button("Remove")).toBeInTheDocument();
  });

  it("admin removing the logo calls business.deleteLogo", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderTab("admin", "business");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(stub.mutations["business.deleteLogo"]).toEqual([{ id: "biz-1" }]);
    confirmSpy.mockRestore();
  });

  describe("with a picked logo file (pending preview)", () => {
    // jsdom has no image decoding or canvas; stub just enough for
    // LogoUploader's rasterize step to produce a preview data URL.
    beforeEach(() => {
      class FakeImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        naturalWidth = 200;
        naturalHeight = 100;
        width = 200;
        height = 100;
        set src(_v: string) {
          queueMicrotask(() => this.onload?.());
        }
      }
      vi.stubGlobal("Image", FakeImage);
      // jsdom does not implement these at all, so define (not spy on) them.
      Object.assign(URL, { createObjectURL: () => "blob:logo", revokeObjectURL: () => {} });
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
        clearRect: () => {},
        drawImage: () => {},
      } as unknown as CanvasRenderingContext2D);
      vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAAA");
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      const u = URL as unknown as Record<string, unknown>;
      delete u.createObjectURL;
      delete u.revokeObjectURL;
    });

    function pickFile(container: HTMLElement) {
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(["png"], "logo.png", { type: "image/png" });
      fireEvent.change(input, { target: { files: [file] } });
    }

    it("admin gets Save Logo, which calls business.uploadLogo", async () => {
      const { container } = renderTab("admin", "business");
      pickFile(container);
      fireEvent.click(await screen.findByRole("button", { name: "Save Logo" }));
      expect(stub.mutations["business.uploadLogo"]).toEqual([
        { id: "biz-1", data: { dataUrl: "data:image/png;base64,AAAA", width: 200, height: 100 } },
      ]);
    });

    it("seller never gets Save Logo, even with a pending preview", async () => {
      const { container } = renderTab("seller", "business");
      pickFile(container);
      expect(await screen.findByAltText("Pending logo preview")).toBeInTheDocument();
      expect(button("Save Logo")).not.toBeInTheDocument();
      expect(button("Pick a different file")).not.toBeInTheDocument();
    });
  });

  it.each(["seller_manager", "seller", "accountant"])(
    "%s sees the current logo but no Choose file / Remove controls",
    (role) => {
      renderTab(role, "business");
      expect(screen.getByAltText("Current business logo")).toBeInTheDocument();
      expect(button("Choose file")).not.toBeInTheDocument();
      expect(button("Remove")).not.toBeInTheDocument();
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Documents tab — prefixes / defaults Save (business.update) and sequence
// Change → Confirm Change (business.updateSequenceNumber)
// ═══════════════════════════════════════════════════════════════════════════

describe("Documents tab", () => {
  it("admin sees a Change button per document type", () => {
    renderTab("admin", "documents");
    expect(screen.getAllByRole("button", { name: "Change" })).toHaveLength(6);
  });

  it("admin can change a sequence number (Change → Confirm Change)", () => {
    renderTab("admin", "documents");
    fireEvent.click(screen.getAllByRole("button", { name: "Change" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Confirm Change" }));
    expect(stub.mutations["business.updateSequenceNumber"]).toEqual([
      { documentType: "invoice", newNumber: 42 },
    ]);
  });

  it.each(["seller_manager", "seller", "accountant"])(
    "%s sees the next numbers but no Change buttons",
    (role) => {
      renderTab(role, "documents");
      expect(screen.getByText("42")).toBeInTheDocument();
      expect(screen.queryAllByRole("button", { name: "Change" })).toHaveLength(0);
    },
  );

  it("admin gets a Save button after editing a prefix, and saving calls business.update", () => {
    renderTab("admin", "documents");
    fireEvent.change(screen.getByDisplayValue("INV"), { target: { value: "BILL" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(stub.mutations["business.update"]).toHaveLength(1);
    expect(stub.mutations["business.update"][0]).toMatchObject({
      id: "biz-1",
      data: { invoicePrefix: "BILL" },
    });
  });

  it("seller_manager gets no Save button after editing a prefix", () => {
    renderTab("seller_manager", "documents");
    fireEvent.change(screen.getByDisplayValue("INV"), { target: { value: "BILL" } });
    expect(button("Save")).not.toBeInTheDocument();
    expect(stub.mutations["business.update"]).toBeUndefined();
  });

  it("admin gets a Save button after changing document defaults", () => {
    renderTab("admin", "documents");
    fireEvent.click(screen.getByRole("switch", { name: "Round totals down by default" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(stub.mutations["business.update"]).toEqual([
      { id: "biz-1", data: { defaultRoundOff: false, defaultTermsAndConditions: null } },
    ]);
  });

  it("accountant gets no Save button after changing document defaults", () => {
    renderTab("accountant", "documents");
    fireEvent.click(screen.getByRole("switch", { name: "Round totals down by default" }));
    expect(button("Save")).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Shipping tab — Save Shipping Settings (business.update)
// ═══════════════════════════════════════════════════════════════════════════

describe("Shipping tab", () => {
  function addMethod() {
    fireEvent.change(screen.getByPlaceholderText(/Dunzo/), { target: { value: "Porter" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
  }

  it("admin gets Save Shipping Settings after adding a method", () => {
    renderTab("admin", "shipping");
    addMethod();
    fireEvent.click(screen.getByRole("button", { name: "Save Shipping Settings" }));
    expect(stub.mutations["business.update"]).toHaveLength(1);
  });

  it.each(["seller_manager", "seller", "accountant"])(
    "%s gets no Save Shipping Settings button",
    (role) => {
      renderTab(role, "shipping");
      addMethod();
      expect(screen.getByText("Porter")).toBeInTheDocument();
      expect(button("Save Shipping Settings")).not.toBeInTheDocument();
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Online Store tab — Save Settings (manage:Store), Manage Items (update:Store)
// ═══════════════════════════════════════════════════════════════════════════

describe("Online Store tab", () => {
  it("admin sees Save Settings and Manage Items", () => {
    renderTab("admin", "store");
    expect(button(/No changes|Save Settings/)).toBeInTheDocument();
    expect(button("Manage Items")).toBeInTheDocument();
  });

  it("admin saving store settings calls store.updateSettings", () => {
    renderTab("admin", "store");
    fireEvent.click(screen.getByRole("switch", { name: "Enable online store" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));
    expect(stub.mutations["store.updateSettings"]).toHaveLength(1);
  });

  it("seller_manager (update:Store, not manage:Store) sees Manage Items but no Save Settings", () => {
    renderTab("seller_manager", "store");
    fireEvent.click(screen.getByRole("switch", { name: "Enable online store" }));
    expect(button(/No changes|Save Settings/)).not.toBeInTheDocument();
    expect(button("Manage Items")).toBeInTheDocument();
  });

  it("seller_manager can open Manage Items and apply a change (store.bulkToggleItems)", async () => {
    renderTab("seller_manager", "store");
    fireEvent.click(screen.getByRole("button", { name: "Manage Items" }));
    fireEvent.click(await screen.findByText("Basmati Rice", { selector: "p" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply 1 Change" }));
    expect(stub.mutations["store.bulkToggleItems"]).toEqual([
      { itemIds: ["i1"], storeEnabled: false },
    ]);
    // applyChanges closes the modal once the mutation resolves.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Apply/ })).not.toBeInTheDocument(),
    );
  });

  it.each(["seller", "accountant"])(
    "%s sees the store settings and items but neither Save Settings nor Manage Items",
    (role) => {
      renderTab(role, "store");
      expect(screen.getByDisplayValue("Fresh produce")).toBeInTheDocument();
      expect(screen.getByText("Basmati Rice")).toBeInTheDocument();
      expect(button(/No changes|Save Settings/)).not.toBeInTheDocument();
      expect(button("Manage Items")).not.toBeInTheDocument();
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Data tab — Start import (manage:Import), Export CSV bundle (manage:Business)
// ═══════════════════════════════════════════════════════════════════════════

describe("Data tab", () => {
  it("admin sees Start import and Export CSV bundle", () => {
    renderTab("admin", "data");
    expect(button("Start import")).toBeInTheDocument();
    expect(button("Export CSV bundle")).toBeInTheDocument();
  });

  it("admin clicking Start import opens the import wizard", () => {
    renderTab("admin", "data");
    expect(screen.queryByRole("dialog", { name: "Import Data" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start import" }));
    expect(screen.getByRole("dialog", { name: "Import Data" })).toBeInTheDocument();
  });

  it("admin clicking Export CSV bundle calls business.exportData", () => {
    renderTab("admin", "data");
    fireEvent.click(screen.getByRole("button", { name: "Export CSV bundle" }));
    expect(stub.mutations["business.exportData"]).toHaveLength(1);
  });

  it.each(["seller_manager", "seller", "accountant"])(
    "%s sees neither Start import nor Export CSV bundle",
    (role) => {
      renderTab(role, "data");
      expect(screen.getByText("Import data")).toBeInTheDocument();
      expect(button("Start import")).not.toBeInTheDocument();
      expect(button("Export CSV bundle")).not.toBeInTheDocument();
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// ImportWizard — every entry point (Data tab, post-onboarding WhatsNext)
// ═══════════════════════════════════════════════════════════════════════════

describe("ImportWizard", () => {
  it.each(["admin", "owner"])("opens for %s (manage:Import)", (role) => {
    stub.session.role = role;
    render(<ImportWizard open onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Import Data" })).toBeInTheDocument();
  });

  it.each(["seller_manager", "seller", "accountant"])(
    "stays closed for %s even when asked to open",
    (role) => {
      stub.session.role = role;
      render(<ImportWizard open onClose={() => {}} />);
      expect(screen.queryByRole("dialog", { name: "Import Data" })).not.toBeInTheDocument();
      expect(button("Continue")).not.toBeInTheDocument();
    },
  );
});
