/**
 * /auth/verify — DEPRECATED v0.9.x app handoff (remove in 0.11.0).
 *
 * Installed v0.9.x mobile/desktop apps request the magic link with
 * `source=mobile|desktop` and expect the page to open the app
 * (`hisaabo://verify?token=...`) instead of consuming the token in the browser.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  // createFileRoute("/x")(opts) -> opts, so `Route.component` is the page.
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
}));
vi.mock("@/components/ui/Logo", () => ({ Logo: () => null }));
vi.mock("@/lib/isDesktop", () => ({ isDesktop: () => false }));
vi.mock("@/lib/desktop-session", () => ({ saveDesktopToken: vi.fn() }));
vi.mock("@/lib/native-login", () => ({ peekNativeRequest: () => null }));

const mutate = vi.fn();
const state = { session: { data: null as unknown, isLoading: false } };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ invalidate: vi.fn(), auth: { me: { invalidate: vi.fn() } } }),
    auth: {
      me: { useQuery: () => state.session },
      verifyMagicLink: { useMutation: () => ({ mutate }) },
    },
  },
}));

import { Route } from "../routes/auth/verify";

const Page = (Route as unknown as { component: () => React.ReactElement }).component;

// UUID + "-" + 32 URL-safe chars, exactly the shape lib/magic-link.ts generates.
const TOKEN = "2a9423c5-f74c-4b8d-ae86-69dcd0d3b306-O6dyYP1ALEctOdHyFi9hqoaIUfazpWM0";

let hrefAssignments: string[];
const realLocation = window.location;

function setUrl(search: string) {
  window.history.replaceState({}, "", `/auth/verify${search}`);
}

describe("/auth/verify handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    state.session = { data: null, isLoading: false };
    hrefAssignments = [];
    // jsdom cannot navigate to a custom scheme; capture the assignment instead.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        get search() {
          return realLocation.search;
        },
        get href() {
          return realLocation.href;
        },
        set href(v: string) {
          hrefAssignments.push(v);
        },
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: realLocation });
  });

  it("source=mobile: verifies nothing on mount, shows the app button, and the click builds the exact deep link", async () => {
    setUrl(`?token=${TOKEN}&source=mobile`);
    render(<Page />);

    expect(screen.getByRole("heading", { name: "Continue in the Hisaabo app" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in here in the browser instead" })).toBeInTheDocument();
    await waitFor(() => expect(navigate).not.toHaveBeenCalled());
    expect(mutate).not.toHaveBeenCalled();
    // No auto-redirect.
    expect(hrefAssignments).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Open Hisaabo" }));
    expect(hrefAssignments).toEqual([`hisaabo://verify?token=${encodeURIComponent(TOKEN)}`]);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("source=desktop uses the desktop copy", () => {
    setUrl(`?token=${TOKEN}&source=desktop`);
    render(<Page />);
    expect(screen.getByRole("heading", { name: "Continue in the Hisaabo desktop app" })).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("does not check or confirm an existing session while in handoff", () => {
    state.session = { data: { user: { email: "a@b.com" } }, isLoading: false };
    setUrl(`?token=${TOKEN}&source=mobile`);
    render(<Page />);
    expect(screen.queryByText("You are already signed in")).toBeNull();
    expect(screen.getByRole("button", { name: "Open Hisaabo" })).toBeInTheDocument();
  });

  it("'Sign in here in the browser instead' runs the normal verification", async () => {
    setUrl(`?token=${TOKEN}&source=mobile`);
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in here in the browser instead" }));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith({ token: TOKEN }));
    expect(hrefAssignments).toEqual([]);
  });

  it("'browser instead' still asks for confirmation when a session already exists", async () => {
    state.session = { data: { user: { email: "a@b.com" } }, isLoading: false };
    setUrl(`?token=${TOKEN}&source=mobile`);
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in here in the browser instead" }));
    expect(await screen.findByText("You are already signed in")).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("no source: current behaviour, the token is verified immediately", async () => {
    setUrl(`?token=${TOKEN}`);
    render(<Page />);
    await waitFor(() => expect(mutate).toHaveBeenCalledWith({ token: TOKEN }));
    expect(screen.queryByRole("button", { name: "Open Hisaabo" })).toBeNull();
  });

  it("unknown or web source is not a handoff", async () => {
    for (const source of ["web", "evil", "MOBILE", ""]) {
      mutate.mockClear();
      setUrl(`?token=${TOKEN}&source=${source}`);
      const { unmount } = render(<Page />);
      await waitFor(() => expect(mutate).toHaveBeenCalledWith({ token: TOKEN }));
      expect(screen.queryByRole("button", { name: "Open Hisaabo" })).toBeNull();
      unmount();
    }
  });

  it("no source + existing session: still asks before replacing it", async () => {
    state.session = { data: { user: { email: "a@b.com" } }, isLoading: false };
    setUrl(`?token=${TOKEN}`);
    render(<Page />);
    expect(await screen.findByText("You are already signed in")).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("a malformed token with a source shows the error state and never builds a deep link", async () => {
    for (const bad of ["short", "a".repeat(129), "has space in it 0123456789", "bad;char=0123456789abcdef", "../../etc/passwd0123456789"]) {
      setUrl(`?token=${encodeURIComponent(bad)}&source=mobile`);
      const { unmount } = render(<Page />);
      expect(screen.getByText("Link expired or invalid")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Open Hisaabo" })).toBeNull();
      expect(mutate).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
      expect(hrefAssignments).toEqual([]);
      unmount();
    }
  });

  it("a handoff link without a token shows the existing 'No token' error", async () => {
    setUrl("?source=mobile");
    render(<Page />);
    expect(await screen.findByText("No token found in URL.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Hisaabo" })).toBeNull();
  });

  it("strips the token from the URL", () => {
    setUrl(`?token=${TOKEN}&source=mobile`);
    render(<Page />);
    expect(realLocation.search).toBe("");
  });
});
