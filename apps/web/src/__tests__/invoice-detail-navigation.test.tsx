/**
 * Invoice detail — URL-addressable panel, clickable line items, and
 * viewport-safe Download PDF menu. Renders the REAL invoices route with the
 * shared tRPC/router stubs (test-utils/trpc-stub); Link is overridden so the
 * `search` prop can be asserted.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { ComponentType } from "react";

vi.mock("@/lib/trpc", async () => (await import("@/test-utils/trpc-stub")).trpcModule);
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("@/test-utils/trpc-stub")).routerOverrides,
  Link: ({ children, to, search }: { children: React.ReactNode; to: string; search?: Record<string, string> }) => (
    <a href={`${to}?${new URLSearchParams(search).toString()}`}>{children}</a>
  ),
}));

import { stub } from "@/test-utils/trpc-stub";
import { Route as InvoicesRoute } from "@/routes/invoices";

const Invoices = InvoicesRoute.options.component as ComponentType;

const line = (o: Record<string, unknown>) => ({
  id: "li-1", itemId: "item-7", itemName: "Steel Rod", description: null, quantity: "1",
  unitPrice: "100.00", taxPercent: "18", discountPercent: "0", totalAmount: "118.00",
  selectedUnit: null, itemUnit: "kg", ...o,
});

const invoice = (lineItems: unknown[]) => ({
  id: "inv-1", invoiceNumber: "INV-001", type: "sale", status: "sent",
  partyId: "p1", party: { id: "p1", name: "Acme Traders" },
  invoiceDate: new Date().toISOString(), dueDate: null, createdAt: new Date().toISOString(),
  subtotal: "100.00", taxAmount: "18.00", discountAmount: "0", totalAmount: "118.00",
  amountPaid: "0", totalAdjusted: "0", roundOff: "0", lineItems, relatedDocuments: [],
});

beforeEach(() => {
  stub.reset();
  stub.session.role = "admin";
});

describe("Invoice detail panel", () => {
  it("opens from ?id= and links item lines to /items?id=<itemId>", () => {
    const inv = invoice([line({}), line({ id: "li-2", itemId: null, itemName: "Custom charge" })]);
    stub.data["invoice.list"] = { data: [inv], total: 1 };
    stub.data["invoice.getById"] = inv;
    stub.search = { id: "inv-1" };
    render(<Invoices />);
    const panel = screen.getByRole("dialog", { name: "Invoice INV-001" });
    expect(within(panel).getByRole("link", { name: "Steel Rod" })).toHaveAttribute("href", "/items?id=item-7");
    expect(within(panel).getByText("Custom charge")).toBeInTheDocument();
    expect(within(panel).queryByRole("link", { name: "Custom charge" })).toBeNull();
  });

  it("selecting a row pushes ?id= to the URL (so back returns to the invoice)", () => {
    const inv = invoice([]);
    stub.data["invoice.list"] = { data: [inv], total: 1 };
    render(<Invoices />);
    fireEvent.click(screen.getByText("INV-001"));
    expect(stub.navigate).toHaveBeenCalledWith({ to: "/invoices", search: { id: "inv-1" }, replace: false });
  });

  it("the Download PDF menu is portalled outside the slide-over with fixed placement", () => {
    const inv = invoice([]);
    stub.data["invoice.list"] = { data: [inv], total: 1 };
    stub.data["invoice.getById"] = inv;
    stub.search = { id: "inv-1" };
    render(<Invoices />);
    const panel = screen.getByRole("dialog", { name: "Invoice INV-001" });
    fireEvent.click(within(panel).getByTitle("Download PDF"));
    const menu = screen.getByRole("menu");
    expect(panel.contains(menu)).toBe(false);
    expect(menu.style.position).toBe("fixed");
  });
});
