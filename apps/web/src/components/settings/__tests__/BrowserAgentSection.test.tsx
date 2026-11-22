/**
 * BrowserAgentSection — WebMCP user switch
 *
 * Covers:
 * - Default OFF (no stored preference); only an explicit "on" enables it
 * - Toggling flips aria-checked and persists under the person's own key
 * - Another person on the same browser starts from off
 * - The operator kill switch and the organization owner's switch override the
 *   personal one and say why
 * - Not available in the desktop shell
 * - The unsupported note appears only when the browser has no modelContext,
 *   and the switch stays usable either way
 * - The helper label is associated with the switch (accessible name)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { BrowserAgentSection } from "../BrowserAgentSection";
import { OrgBrowserAgentPolicy } from "../OrgBrowserAgentPolicy";
import { agentPreferenceKey, LEGACY_WEBMCP_PREF_KEY, type AgentPreferenceScope } from "@/lib/webmcp/preferences";

const ASHA: AgentPreferenceScope = { userId: "user-asha", tenantId: "tenant-1" };
const RAVI: AgentPreferenceScope = { userId: "user-ravi", tenantId: "tenant-1" };

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
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  localStorage.clear();
});

describe("BrowserAgentSection", () => {
  it("renders the section heading and helper text", () => {
    render(<BrowserAgentSection scope={ASHA} />);

    expect(screen.getByText("Browser AI agents")).toBeInTheDocument();
    expect(
      screen.getByText(/AI features built into Chrome or Edge can read your data/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/someone else who signs in here starts with it off/i)).toBeInTheDocument();
  });

  it("defaults to off when nothing is stored", () => {
    render(<BrowserAgentSection scope={ASHA} />);

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("reflects a stored explicit 'on' preference for this person", () => {
    localStorage.setItem(agentPreferenceKey(ASHA), "on");

    render(<BrowserAgentSection scope={ASHA} />);

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("does not show another person's 'on' on the same browser", () => {
    localStorage.setItem(agentPreferenceKey(ASHA), "on");

    render(<BrowserAgentSection scope={RAVI} />);

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("ignores the old browser-wide key", () => {
    localStorage.setItem(LEGACY_WEBMCP_PREF_KEY, "on");

    render(<BrowserAgentSection scope={ASHA} />);

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("turning it on flips aria-checked and persists an explicit value under this person's key", () => {
    render(<BrowserAgentSection scope={ASHA} />);
    const toggle = screen.getByRole("switch");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(localStorage.getItem(agentPreferenceKey(ASHA))).toBe("on");
    expect(localStorage.getItem(agentPreferenceKey(RAVI))).toBeNull();
    expect(localStorage.getItem(LEGACY_WEBMCP_PREF_KEY)).toBeNull();
  });

  it("turning it back off clears the stored value", () => {
    localStorage.setItem(agentPreferenceKey(ASHA), "on");
    render(<BrowserAgentSection scope={ASHA} />);
    const toggle = screen.getByRole("switch");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(localStorage.getItem(agentPreferenceKey(ASHA))).toBeNull();
  });

  it("shows the unsupported note when the browser has no modelContext, and the switch still works", () => {
    render(<BrowserAgentSection scope={ASHA} />);

    expect(
      screen.getByText("Your browser does not support WebMCP yet."),
    ).toBeInTheDocument();

    const toggle = screen.getByRole("switch");
    expect(toggle).not.toBeDisabled();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("hides the unsupported note when document.modelContext exists", () => {
    setModelContextSupport(true);

    render(<BrowserAgentSection scope={ASHA} />);

    expect(
      screen.queryByText("Your browser does not support WebMCP yet."),
    ).not.toBeInTheDocument();
  });

  it("labels the switch for assistive technology", () => {
    render(<BrowserAgentSection scope={ASHA} />);

    expect(
      screen.getByRole("switch", { name: /Allow this browser.s AI agent to use Hisaabo/i }),
    ).toBeInTheDocument();
  });

  it("cannot be switched on while the session is still loading (no scope)", () => {
    render(<BrowserAgentSection scope={null} />);
    const toggle = screen.getByRole("switch");
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(localStorage.length).toBe(0);
  });
});

describe("BrowserAgentSection — overrides from the operator and the organization owner", () => {
  it("shows off, disabled and explained when the operator turned agents off for the server", () => {
    localStorage.setItem(agentPreferenceKey(ASHA), "on");

    render(<BrowserAgentSection scope={ASHA} operatorDisabled />);

    const toggle = screen.getByRole("switch");
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/turned off for this server by its administrator/i)).toBeInTheDocument();
    // The stored personal choice is untouched, it just has no effect while the policy stands.
    expect(localStorage.getItem(agentPreferenceKey(ASHA))).toBe("on");
  });

  it("shows off, disabled and explained when the organization owner turned agents off", () => {
    render(<BrowserAgentSection scope={ASHA} orgDisabled />);

    const toggle = screen.getByRole("switch");
    expect(toggle).toBeDisabled();
    expect(screen.getByText(/turned off for your organization by its owner/i)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(localStorage.getItem(agentPreferenceKey(ASHA))).toBeNull();
  });

  it("says the operator's switch wins when both are set", () => {
    render(<BrowserAgentSection scope={ASHA} operatorDisabled orgDisabled />);
    expect(screen.getByText(/by its administrator/i)).toBeInTheDocument();
    expect(screen.queryByText(/by its owner/i)).not.toBeInTheDocument();
  });

  it("is not available in the desktop app", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    setModelContextSupport(true);

    render(<BrowserAgentSection scope={ASHA} />);

    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByText(/not available in the desktop app/i)).toBeInTheDocument();
  });
});

describe("OrgBrowserAgentPolicy (the owner's switch)", () => {
  it("shows on when agents are allowed, and turning it off reports disabled=true", () => {
    const changes: boolean[] = [];
    render(<OrgBrowserAgentPolicy disabled={false} onChange={(d) => changes.push(d)} />);
    const toggle = screen.getByRole("switch", { name: /Allow members to use browser AI agents/i });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    expect(changes).toEqual([true]);
  });

  it("shows off when agents are disabled, and turning it on reports disabled=false", () => {
    const changes: boolean[] = [];
    render(<OrgBrowserAgentPolicy disabled onChange={(d) => changes.push(d)} />);
    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(changes).toEqual([false]);
  });

  it("is disabled while saving and notes when the operator has already turned agents off", () => {
    render(<OrgBrowserAgentPolicy disabled={false} saving operatorDisabled onChange={() => {}} />);
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByText(/administrator has turned browser AI agents off for everyone/i)).toBeInTheDocument();
  });
});
