/**
 * BrowserAgentSection — WebMCP user switch
 *
 * Covers:
 * - Default ON (no stored preference) and reading a stored "off"
 * - Toggling flips aria-checked and persists to localStorage
 * - Turning it back on clears the stored value
 * - The unsupported note appears only when the browser has no modelContext,
 *   and the switch stays usable either way
 * - The helper label is associated with the switch (accessible name)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { BrowserAgentSection } from "../BrowserAgentSection";
import { WEBMCP_PREF_KEY } from "@/lib/webmcp/preferences";

/** Fake the WebMCP surface jsdom does not have. */
function setModelContextSupport(supported: boolean) {
  if (supported) {
    Object.defineProperty(document, "modelContext", {
      value: { registerTool: async () => {} },
      configurable: true,
    });
  } else {
    Reflect.deleteProperty(document, "modelContext");
  }
}

beforeEach(() => {
  localStorage.clear();
  setModelContextSupport(false);
});

afterEach(() => {
  setModelContextSupport(false);
  localStorage.clear();
});

describe("BrowserAgentSection", () => {
  it("renders the section heading and helper text", () => {
    render(<BrowserAgentSection />);

    expect(screen.getByText("Browser AI agents")).toBeInTheDocument();
    expect(
      screen.getByText(/AI features built into Chrome or Edge can read your data/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Stored per browser\./i)).toBeInTheDocument();
  });

  it("defaults to on when nothing is stored", () => {
    render(<BrowserAgentSection />);

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("reflects a stored 'off' preference", () => {
    localStorage.setItem(WEBMCP_PREF_KEY, "off");

    render(<BrowserAgentSection />);

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("turning it off flips aria-checked and persists to localStorage", () => {
    render(<BrowserAgentSection />);
    const toggle = screen.getByRole("switch");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(localStorage.getItem(WEBMCP_PREF_KEY)).toBe("off");
  });

  it("turning it back on clears the stored value", () => {
    localStorage.setItem(WEBMCP_PREF_KEY, "off");
    render(<BrowserAgentSection />);
    const toggle = screen.getByRole("switch");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(localStorage.getItem(WEBMCP_PREF_KEY)).toBeNull();
  });

  it("shows the unsupported note when the browser has no modelContext, and the switch still works", () => {
    render(<BrowserAgentSection />);

    expect(
      screen.getByText("Your browser does not support WebMCP yet."),
    ).toBeInTheDocument();

    const toggle = screen.getByRole("switch");
    expect(toggle).not.toBeDisabled();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("hides the unsupported note when document.modelContext exists", () => {
    setModelContextSupport(true);

    render(<BrowserAgentSection />);

    expect(
      screen.queryByText("Your browser does not support WebMCP yet."),
    ).not.toBeInTheDocument();
  });

  it("labels the switch for assistive technology", () => {
    render(<BrowserAgentSection />);

    expect(
      screen.getByRole("switch", { name: /Allow this browser.s AI agent to use Hisaabo/i }),
    ).toBeInTheDocument();
  });
});
