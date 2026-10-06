import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsNav } from "../SettingsNav";

function labels(role: string | null | undefined): string[] {
  const { container, unmount } = render(<SettingsNav value="business" onChange={vi.fn()} role={role} />);
  // desktop nav and mobile strip both render; read the desktop one
  const out = Array.from(container.querySelectorAll("nav button")).map((b) => b.textContent ?? "");
  unmount();
  return out;
}

describe("SettingsNav role gating", () => {
  it.each(["owner", "superadmin", "admin"])("shows Team to %s", (role) => {
    expect(labels(role)).toContain("Team");
  });

  it.each(["seller_manager", "seller", "accountant", null, undefined])("hides Team from %s", (role) => {
    expect(labels(role)).not.toContain("Team");
  });

  it("keeps Sales Targets for seller managers", () => {
    render(<SettingsNav value="business" onChange={vi.fn()} role="seller_manager" />);
    expect(screen.getAllByText("Sales Targets").length).toBeGreaterThan(0);
  });
});
