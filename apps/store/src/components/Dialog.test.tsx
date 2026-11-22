// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Dialog } from "./Dialog";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("style");
});

function Page({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <main>
        <button onClick={() => setOpen(true)}>Open privacy policy</button>
        <a href="#elsewhere">Page link</a>
      </main>
      <div data-inert-exempt>
        <button>Dismiss notice</button>
      </div>
      {open && (
        <Dialog
          title="Privacy Policy"
          onClose={() => {
            onClose?.();
            setOpen(false);
          }}
        >
          <a href="#first">First link</a>
          <input aria-label="Name" />
          <button>Last button</button>
        </Dialog>
      )}
    </>
  );
}

async function openDialog() {
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "Open privacy policy" });
  await user.click(trigger);
  return { user, trigger };
}

describe("Dialog: semantics", () => {
  it("is a modal dialog named by its title", async () => {
    render(<Page />);
    await openDialog();
    const dialog = screen.getByRole("dialog", { name: "Privacy Policy" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("can be named by a heading it does not draw itself", () => {
    render(
      <Dialog labelledBy="own-title" onClose={() => {}}>
        <h2 id="own-title">Raw Forest Honey</h2>
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "Raw Forest Honey" })).toBeTruthy();
  });

  it("falls back to a plain label", () => {
    render(
      <Dialog label="Item" onClose={() => {}}>
        <p>x</p>
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "Item" })).toBeTruthy();
  });
});

describe("Dialog: Escape", () => {
  it("closes on Esc, wherever focus is", async () => {
    const onClose = vi.fn();
    render(<Page onClose={onClose} />);
    const { user } = await openDialog();
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Esc even when focus is on the page body", async () => {
    const onClose = vi.fn();
    render(<Page onClose={onClose} />);
    await openDialog();
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes only the topmost of stacked dialogs", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Dialog title="Cart" onClose={outer}>
          <button>a</button>
        </Dialog>
        <Dialog title="Phone" onClose={inner}>
          <button>b</button>
        </Dialog>
      </>,
    );
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("closes from the close button and from the backdrop, not from inside the panel", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <Dialog title="Terms" onClose={onClose}>
        <p>Body</p>
      </Dialog>,
    );
    await user.click(screen.getByText("Body"));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(container.querySelector(".dlg-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("Dialog: focus", () => {
  it("moves focus into the dialog on open", async () => {
    render(<Page />);
    await openDialog();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "First link" }));
  });

  it("honours an initial-focus target", () => {
    function WithTarget() {
      return (
        <Dialog title="Phone" onClose={() => {}}>
          <input aria-label="Mobile number" data-autofocus />
          <button>Send code</button>
        </Dialog>
      );
    }
    render(<WithTarget />);
    expect(document.activeElement).toBe(screen.getByLabelText("Mobile number"));
  });

  it("wraps Tab from the last control to the first, and Shift+Tab back", async () => {
    render(<Page />);
    const { user } = await openDialog();
    const dialog = screen.getByRole("dialog");
    const first = screen.getByRole("button", { name: "Close" });
    const last = screen.getByRole("button", { name: "Last button" });

    last.focus();
    await user.tab();
    expect(document.activeElement).toBe(first);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("never lets focus leave, however long you Tab", async () => {
    render(<Page />);
    const { user } = await openDialog();
    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 12; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement), `tab ${i + 1}`).toBe(true);
    }
    for (let i = 0; i < 12; i++) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement), `shift-tab ${i + 1}`).toBe(true);
    }
  });

  it("returns focus to the trigger on Esc", async () => {
    render(<Page />);
    const { user, trigger } = await openDialog();
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(trigger);
  });

  it("returns focus to the trigger on the close button", async () => {
    render(<Page />);
    const { user, trigger } = await openDialog();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(document.activeElement).toBe(trigger);
  });

  it("returns focus to the opener even when a child autofocuses itself on mount", async () => {
    function Phone() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Proceed to checkout</button>
          {open && (
            <Dialog title="Phone" onClose={() => setOpen(false)}>
              <input aria-label="Mobile number" autoFocus />
            </Dialog>
          )}
        </>
      );
    }
    const user = userEvent.setup();
    render(<Phone />);
    const trigger = screen.getByRole("button", { name: "Proceed to checkout" });
    await user.click(trigger);
    expect(document.activeElement).toBe(screen.getByLabelText("Mobile number"));
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(trigger);
  });

  it("hands focus back to the dialog below when the top one closes", async () => {
    function Stack() {
      const [phone, setPhone] = useState(false);
      return (
        <Dialog title="Cart" onClose={() => {}}>
          <button onClick={() => setPhone(true)}>Proceed to checkout</button>
          {phone && (
            <Dialog title="Phone" onClose={() => setPhone(false)}>
              <input aria-label="Mobile number" />
            </Dialog>
          )}
        </Dialog>
      );
    }
    const user = userEvent.setup();
    render(<Stack />);
    const proceed = screen.getByRole("button", { name: "Proceed to checkout" });
    await user.click(proceed);
    expect(screen.getByRole("dialog", { name: "Phone" }).contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Phone" })).toBeNull();
    expect(document.activeElement).toBe(proceed);
  });
});

describe("Dialog: the page behind", () => {
  it("makes everything outside inert, except what is exempt, and restores it", async () => {
    render(<Page />);
    const { user } = await openDialog();
    const main = screen.getByRole("main", { hidden: true });
    const notice = screen.getByText("Dismiss notice", { selector: "button" }).parentElement!;
    expect(main.hasAttribute("inert")).toBe(true);
    expect(notice.hasAttribute("inert")).toBe(false);
    await user.keyboard("{Escape}");
    expect(main.hasAttribute("inert")).toBe(false);
  });

  it("locks body scroll while open and unlocks when the last dialog closes", () => {
    const { rerender } = render(
      <>
        <Dialog title="A" onClose={() => {}}>
          <p>a</p>
        </Dialog>
        <Dialog title="B" onClose={() => {}}>
          <p>b</p>
        </Dialog>
      </>,
    );
    expect(document.documentElement.style.overflow).toBe("hidden");
    rerender(
      <Dialog title="A" onClose={() => {}}>
        <p>a</p>
      </Dialog>,
    );
    // B is gone but A is still open: still locked.
    expect(document.documentElement.style.overflow).toBe("hidden");
    rerender(<></>);
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("pads the root by the scrollbar's width, so hiding the scrollbar moves nothing", () => {
    const html = document.documentElement;
    // A browser that gives the scrollbar's 8px to the layout once overflow is hidden.
    const rect = vi.spyOn(html, "getBoundingClientRect").mockImplementation(
      () => ({ width: html.style.overflow === "hidden" ? 1440 : 1432 }) as DOMRect,
    );
    const { unmount } = render(
      <Dialog title="A" onClose={() => {}}>
        <p>a</p>
      </Dialog>,
    );
    expect(html.style.paddingRight).toBe("8px");
    unmount();
    expect(html.style.paddingRight).toBe("");
    rect.mockRestore();
  });

  it("adds no padding when the layout keeps its width (scrollbar-gutter honoured, or overlay scrollbars)", () => {
    const html = document.documentElement;
    const rect = vi.spyOn(html, "getBoundingClientRect").mockImplementation(() => ({ width: 1432 }) as DOMRect);
    const { unmount } = render(
      <Dialog title="A" onClose={() => {}}>
        <p>a</p>
      </Dialog>,
    );
    expect(html.style.paddingRight).toBe("");
    unmount();
    rect.mockRestore();
  });

  it("restores a root style it did not set", () => {
    document.documentElement.style.overflow = "scroll";
    const { unmount } = render(
      <Dialog title="A" onClose={() => {}}>
        <p>a</p>
      </Dialog>,
    );
    expect(document.documentElement.style.overflow).toBe("hidden");
    unmount();
    expect(document.documentElement.style.overflow).toBe("scroll");
  });
});
