import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/components/ui/Logo", () => ({ Logo: () => null }));

const state = {
  session: { data: undefined as any, isLoading: false },
  info: { data: undefined as any, isLoading: false, isError: false },
  authorize: vi.fn(),
  authorizeOpts: {} as any,
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      me: { useQuery: () => state.session },
      nativeRequestInfo: { useQuery: () => state.info },
      nativeAuthorize: {
        useMutation: (opts: any) => {
          state.authorizeOpts = opts;
          return { mutate: state.authorize, isPending: false };
        },
      },
    },
  },
}));

import { NativeAuthPage } from "../NativeAuthPage";

const ID = "0b7e1f4a-6c1d-4f6e-9a55-3f0c2f6b9a11";

describe("NativeAuthPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState({}, "", `/auth/native?request=${ID}`);
    state.session = { data: { user: { email: "a@b.com" } }, isLoading: false };
    state.info = { data: { client: "desktop", expiresAt: new Date() }, isLoading: false, isError: false };
  });

  it("shows the consent screen for a signed-in user and cleans the URL", () => {
    render(<NativeAuthPage />);
    expect(screen.getByText(/Sign in to Hisaabo Desktop as a@b.com\?/)).toBeInTheDocument();
    expect(window.location.search).toBe("");
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });

  it("authorizes on Continue", () => {
    render(<NativeAuthPage />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(state.authorize).toHaveBeenCalledWith({ requestId: ID });
  });

  it("clears the handoff and says you can close the tab on Cancel", () => {
    render(<NativeAuthPage />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Sign-in cancelled")).toBeInTheDocument();
    expect(sessionStorage.getItem("nativeAuthRequest")).toBeNull();
  });

  it("stores the request and sends signed-out visitors through login", async () => {
    state.session = { data: null, isLoading: false };
    render(<NativeAuthPage />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/login" }));
    expect(sessionStorage.getItem("nativeAuthRequest")).toBe(ID);
  });

  it("resumes from the stored request after login (no query string)", () => {
    sessionStorage.setItem("nativeAuthRequest", ID);
    window.history.replaceState({}, "", "/auth/native");
    render(<NativeAuthPage />);
    expect(screen.getByText(/Sign in to Hisaabo Desktop/)).toBeInTheDocument();
  });

  it("shows an expired state for unknown requests", () => {
    state.info = { data: undefined, isLoading: false, isError: true };
    render(<NativeAuthPage />);
    expect(screen.getByText("Sign-in request expired")).toBeInTheDocument();
    expect(sessionStorage.getItem("nativeAuthRequest")).toBeNull();
  });

  it("shows an expired state when no request id is available", () => {
    window.history.replaceState({}, "", "/auth/native");
    render(<NativeAuthPage />);
    expect(screen.getByText("Sign-in request expired")).toBeInTheDocument();
  });

  it("shows the invalid state when authorization fails", async () => {
    render(<NativeAuthPage />);
    state.authorizeOpts.onError();
    await waitFor(() => expect(screen.getByText("Sign-in request expired")).toBeInTheDocument());
  });

  it("refuses to follow an unsafe redirect URL", async () => {
    render(<NativeAuthPage />);
    state.authorizeOpts.onSuccess({ redirectUrl: "javascript:alert(1)" });
    await waitFor(() => expect(screen.getByText("Sign-in request expired")).toBeInTheDocument());
  });
});
