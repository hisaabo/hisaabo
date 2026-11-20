import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { getVisibleNavItems } from "@/lib/route-access";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

import { CommandPalette } from "../ui/CommandPalette";

// Mirrors the shape of navSections in routes/__root.tsx.
const nav = [
  { to: "/", label: "Dashboard", resource: "Report", action: "read" },
  { to: "/invoices", label: "Invoices", resource: "Invoice", action: "read" },
  { to: "/sales-returns", label: "Sales Returns", resource: "Invoice", action: "read" },
  { to: "/delivery-challans", label: "Delivery Challans", resource: "Invoice", action: "read" },
  { to: "/gst", label: "__REPORTS__", resource: "GstReport", action: "read" },
  { to: "/itc", label: "Input Tax Credit", resource: "ITC", action: "read", gstOnly: true },
] as const;

function renderPalette(isGstRegistered: boolean) {
  const navItems = getVisibleNavItems([...nav], () => true, isGstRegistered);
  return render(<CommandPalette open onClose={() => {}} navItems={navItems} />);
}

describe("CommandPalette", () => {
  it("lists Sales Returns and Delivery Challans", () => {
    renderPalette(true);
    expect(screen.getByText("Go to Sales Returns")).toBeInTheDocument();
    expect(screen.getByText("Go to Delivery Challans")).toBeInTheDocument();
    expect(screen.getByText("Go to Settings")).toBeInTheDocument();
  });

  it("shows Tax Reports (and no GST-only pages) for unregistered businesses", () => {
    renderPalette(false);
    expect(screen.getByText("Go to Tax Reports")).toBeInTheDocument();
    expect(screen.queryByText("Go to GST Returns")).not.toBeInTheDocument();
    expect(screen.queryByText("Go to Input Tax Credit")).not.toBeInTheDocument();
  });

  it("shows GST Returns for registered businesses", () => {
    renderPalette(true);
    expect(screen.getByText("Go to GST Returns")).toBeInTheDocument();
    expect(screen.getByText("Go to Input Tax Credit")).toBeInTheDocument();
  });
});
