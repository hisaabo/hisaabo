/**
 * Sign-in with and without a Turnstile site key.
 *
 * A production web build without VITE_TURNSTILE_SITE_KEY (self-hosted, no
 * Turnstile) must not open the challenge modal (it would only show an error and
 * block the form); the server enforces Turnstile only when its secret is set.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { isTurnstileConfigured } from "../lib/turnstile";

describe("isTurnstileConfigured", () => {
  it("is true when a site key is set (any mode)", () => {
    expect(isTurnstileConfigured({ VITE_TURNSTILE_SITE_KEY: "0x4AAA", PROD: true })).toBe(true);
    expect(isTurnstileConfigured({ VITE_TURNSTILE_SITE_KEY: "0x4AAA", PROD: false })).toBe(true);
  });

  it("is true in dev without a key (Cloudflare always-pass test key)", () => {
    expect(isTurnstileConfigured({ PROD: false })).toBe(true);
    expect(isTurnstileConfigured({ VITE_TURNSTILE_SITE_KEY: "", PROD: false })).toBe(true);
  });

  it("is false for a production build without a site key", () => {
    expect(isTurnstileConfigured({ PROD: true })).toBe(false);
    expect(isTurnstileConfigured({ VITE_TURNSTILE_SITE_KEY: "", PROD: true })).toBe(false);
  });
});

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
}));
vi.mock("@/lib/isDesktop", () => ({ isDesktop: () => false }));
vi.mock("@/components/auth/DesktopSignIn", () => ({ DesktopSignIn: () => null }));
vi.mock("@/components/auth/SignupHint", () => ({ SignupHint: () => null }));

const sendMagicLink = vi.fn();
const modal = { open: false, onVerified: null as null | ((t: string) => void) };
vi.mock("@/components/ui/TurnstileModal", () => ({
  TurnstileModal: (props: { open: boolean; onVerified: (t: string) => void }) => {
    modal.open = props.open;
    modal.onVerified = props.onVerified;
    return props.open ? <div data-testid="turnstile-modal" /> : null;
  },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ auth: { me: { invalidate: vi.fn() } } }),
    system: { config: { useQuery: () => ({ data: { signupOpen: true } }) } },
    auth: {
      sendMagicLink: { useMutation: () => ({ mutate: sendMagicLink, isPending: false }) },
      login: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

import { Route } from "../routes/login";
const LoginPage = (Route as unknown as { component: () => React.ReactElement }).component;

describe("login form Turnstile gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modal.open = false;
    modal.onVerified = null;
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function submitEmail() {
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("you@yourcompany.com"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send magic link/i }));
  }

  it("production build without a site key: no modal, the link is requested without a token", () => {
    vi.stubEnv("PROD", true);
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
    submitEmail();
    expect(screen.queryByTestId("turnstile-modal")).toBeNull();
    expect(sendMagicLink).toHaveBeenCalledWith({ email: "a@b.com", turnstileToken: undefined });
  });

  it("with a site key: the modal opens and the request waits for the token", () => {
    vi.stubEnv("PROD", true);
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "0x4AAAtestkey");
    submitEmail();
    expect(screen.getByTestId("turnstile-modal")).toBeInTheDocument();
    expect(sendMagicLink).not.toHaveBeenCalled();

    modal.onVerified?.("cf-token");
    expect(sendMagicLink).toHaveBeenCalledWith({ email: "a@b.com", turnstileToken: "cf-token" });
  });
});
