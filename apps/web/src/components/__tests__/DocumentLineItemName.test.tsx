import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, search, className }: { children: React.ReactNode; to: string; search?: Record<string, string>; className?: string }) => (
    <a href={`${to}?${new URLSearchParams(search).toString()}`} className={className}>{children}</a>
  ),
}));

import { DocumentLineItemName } from "../DocumentLineItemName";

describe("DocumentLineItemName", () => {
  it("links to the item detail route with the item id", () => {
    render(<DocumentLineItemName itemId="item-1" name="Steel Rod" />);
    expect(screen.getByRole("link", { name: "Steel Rod" })).toHaveAttribute("href", "/items?id=item-1");
  });

  it("renders plain text when the line has no item_id", () => {
    render(<DocumentLineItemName itemId={null} name="Custom charge" />);
    expect(screen.getByText("Custom charge")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
