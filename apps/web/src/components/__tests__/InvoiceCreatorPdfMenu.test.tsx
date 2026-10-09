import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/trpc", async () => (await import("@/test-utils/trpc-stub")).trpcModule);

import { DownloadPDFButton } from "../InvoiceCreator";

describe("InvoiceCreator DownloadPDFButton menu", () => {
  it("renders the menu in a body portal with fixed (viewport-safe) placement", () => {
    const { container } = render(<DownloadPDFButton invoiceId="i1" invoiceNumber="INV-1" />);
    fireEvent.click(screen.getByRole("button", { name: /PDF/ }));
    const menu = screen.getByRole("menu");
    expect(container.contains(menu)).toBe(false);
    expect(menu.style.position).toBe("fixed");
    expect(screen.getAllByRole("menuitem").length).toBeGreaterThan(0);
  });
});
