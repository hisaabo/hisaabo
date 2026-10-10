/**
 * Party detail panel is URL-driven (?id=, ?tab=) so browser Back from a
 * document opened out of the Ledger tab returns to the party with its ledger.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ComponentType } from "react";

vi.mock("@/lib/trpc", async () => (await import("@/test-utils/trpc-stub")).trpcModule);
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("@/test-utils/trpc-stub")).routerOverrides,
}));

import { stub } from "@/test-utils/trpc-stub";
import { Route as PartiesRoute } from "@/routes/parties";

const Parties = PartiesRoute.options.component as ComponentType;
const party = { id: "p1", name: "Acme Traders", type: "customer", phone: null, gstin: null, balance: "0" };

beforeEach(() => {
  stub.reset();
  stub.session.role = "admin";
  stub.data["party.list"] = { data: [party], total: 1 };
  stub.data["party.getById"] = party;
});

describe("Party detail panel URL state", () => {
  it("row click pushes ?id= to the URL", () => {
    render(<Parties />);
    fireEvent.click(screen.getByText("Acme Traders"));
    expect(stub.navigate).toHaveBeenCalledWith({ to: "/parties", search: { id: "p1" }, replace: false });
  });

  it("opens the panel from ?id= and restores the tab from ?tab=", () => {
    stub.search = { id: "p1", tab: "ledger" };
    render(<Parties />);
    expect(screen.getByRole("dialog", { name: "Acme Traders" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ledger" }).className).toContain("bg-brand-50");
    expect(screen.getByRole("button", { name: "Overview" }).className).not.toContain("bg-brand-50");
  });

  it("changing tab replaces the URL keeping the party id", () => {
    stub.search = { id: "p1" };
    render(<Parties />);
    fireEvent.click(screen.getByRole("button", { name: "Ledger" }));
    expect(stub.navigate).toHaveBeenCalledWith({ to: "/parties", search: { id: "p1", tab: "ledger" }, replace: true });
  });
});
