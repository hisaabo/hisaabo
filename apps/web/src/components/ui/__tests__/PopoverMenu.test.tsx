import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { computeMenuPosition, PopoverMenu } from "../PopoverMenu";

const viewport = { width: 1000, height: 700 };
const menu = { width: 172, height: 100 };

describe("computeMenuPosition", () => {
  it("opens below and right-aligned when there is room", () => {
    const p = computeMenuPosition({ top: 100, bottom: 130, left: 400, right: 430 }, menu, viewport);
    expect(p.placement).toBe("bottom");
    expect(p.top).toBe(134);
    expect(p.left).toBe(430 - 172);
  });

  it("flips above when the trigger sits near the bottom (slide-over footer)", () => {
    const p = computeMenuPosition({ top: 650, bottom: 680, left: 800, right: 830 }, menu, viewport);
    expect(p.placement).toBe("top");
    expect(p.top + menu.height).toBeLessThanOrEqual(650);
  });

  it("clamps horizontally inside the viewport", () => {
    const p = computeMenuPosition({ top: 100, bottom: 130, left: 0, right: 30 }, menu, viewport);
    expect(p.left).toBe(8);
    const q = computeMenuPosition({ top: 100, bottom: 130, left: 990, right: 1020 }, menu, viewport);
    expect(q.left + menu.width).toBeLessThanOrEqual(1000 - 8);
  });
});

describe("PopoverMenu", () => {
  it("renders in a portal on document.body with fixed positioning", () => {
    const ref = createRef<HTMLButtonElement>();
    const { container } = render(
      <div>
        <button ref={ref}>trigger</button>
        <PopoverMenu open onClose={() => {}} anchorRef={ref}>
          <button role="menuitem">A4</button>
        </PopoverMenu>
      </div>,
    );
    const menuEl = screen.getByRole("menu");
    expect(container.contains(menuEl)).toBe(false);
    expect(menuEl.style.position).toBe("fixed");
  });

  it("renders nothing when closed", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<PopoverMenu open={false} onClose={() => {}} anchorRef={ref}>x</PopoverMenu>);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
