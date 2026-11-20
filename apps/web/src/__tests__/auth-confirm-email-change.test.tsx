/**
 * /auth/confirm-email-change — never changes anything by itself; the change is
 * applied only when the signed-in requester presses Confirm.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
}));
vi.mock("@/components/ui/Logo", () => ({ Logo: () => null }));

const mutate = vi.fn();
const invalidateMe = vi.fn();
const state = {
  session: { data: null as unknown, isLoading: false },
  mutationOpts: {} as { onSuccess?: () => Promise<void>; onError?: (e: Error) => void },
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ auth: { me: { invalidate: invalidateMe } } }),
    auth: {
      me: { useQuery: () => state.session },
      confirmEmailChange: {
        useMutation: (opts: typeof state.mutationOpts) => {
          state.mutationOpts = opts;
          return { mutate, isPending: false };
        },
      },
    },
  },
}));

import { Route } from "../routes/auth/confirm-email-change";
const Page = (Route as unknown as { component: () => React.ReactElement }).component;

const TOKEN = "2a9423c5-f74c-4b8d-ae86-69dcd0d3b306-O6dyYP1ALEctOdHyFi9hqoaIUfazpWM0";

describe("/auth/confirm-email-change", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.session = { data: { user: { email: "me@example.com" } }, isLoading: false };
    window.history.replaceState({}, "", `/auth/confirm-email-change?token=${TOKEN}`);
  });

  it("never auto-submits, even when signed in", () => {
    render(<Page />);
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Change sign-in email for me@example.com?" })).toBeInTheDocument();
  });

  it("signed in: Confirm submits the token from the link", () => {
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(mutate).toHaveBeenCalledWith({ token: TOKEN });
  });

  it("on success it refreshes the session and goes to settings", async () => {
    render(<Page />);
    await state.mutationOpts.onSuccess?.();
    expect(invalidateMe).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: "/settings" });
  });

  it("shows the server's message on error (e.g. a different account)", async () => {
    render(<Page />);
    const { act } = await import("@testing-library/react");
    act(() => state.mutationOpts.onError?.(new Error("This link confirms an email change for a different Hisaabo account.")));
    expect(await screen.findByRole("alert")).toHaveTextContent("different Hisaabo account");
  });

  it("signed out: asks to sign in to the requesting account and offers no confirm button", () => {
    state.session = { data: null, isLoading: false };
    render(<Page />);
    expect(screen.getByText(/Sign in to the account that requested this change/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Go to sign in" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/login" });
  });

  it("without a token there is nothing to confirm", () => {
    window.history.replaceState({}, "", "/auth/confirm-email-change");
    render(<Page />);
    expect(screen.getByText("Link not valid")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
  });

  it("strips the token from the URL", () => {
    render(<Page />);
    expect(window.location.search).toBe("");
  });
});
