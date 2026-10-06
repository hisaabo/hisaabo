import React from "react";
import { render, waitFor, screen } from "@testing-library/react-native";

const store: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn((k: string) => Promise.resolve(store[k] ?? null)),
  setItemAsync: jest.fn((k: string, v: string) => {
    store[k] = v;
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((k: string) => {
    delete store[k];
    return Promise.resolve();
  }),
}));
jest.mock("expo-constants", () => ({ default: { expoConfig: null } }));

const mockExchange = jest.fn();
const mockStart = jest.fn();
jest.mock("../lib/trpc", () => ({
  vanillaTRPC: {
    auth: {
      nativeStart: { mutate: (...a: unknown[]) => mockStart(...a) },
      nativeExchange: { mutate: (...a: unknown[]) => mockExchange(...a) },
    },
  },
}));

const mockOpen = jest.fn();
const mockDismiss = jest.fn();
jest.mock("expo-web-browser", () => ({
  openBrowserAsync: (...a: unknown[]) => mockOpen(...a),
  dismissBrowser: (...a: unknown[]) => mockDismiss(...a),
}));

const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  router: { replace: (...a: unknown[]) => mockReplace(...a) },
  useLocalSearchParams: () => mockParams,
}));

import NativeCallbackScreen from "../../app/auth/native/callback";
import { startNativeLogin } from "../lib/native-login";
import { useAuthStore } from "../stores/auth";

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  jest.clearAllMocks();
  useAuthStore.setState({ token: null });
  mockStart.mockResolvedValue({
    requestId: "req-1",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  });
});

async function begin() {
  await startNativeLogin();
  return JSON.parse(store["nativeAuthPending"]) as { state: string; verifier: string };
}

describe("native sign-in", () => {
  it("starts with mobile client, S256 challenge and the app-link redirect, then opens the browser", async () => {
    const { state, verifier } = await begin();
    const arg = mockStart.mock.calls[0][0];
    expect(arg.client).toBe("mobile");
    expect(arg.redirectUri).toBe("https://app.hisaabo.in/auth/native/callback");
    expect(arg.codeChallengeMethod).toBe("S256");
    expect(arg.state).toBe(state);
    expect(arg.codeChallenge).toHaveLength(43);
    expect(verifier).toHaveLength(43);
    expect(mockOpen).toHaveBeenCalledWith("https://app.hisaabo.in/auth/native?request=req-1");
  });

  it("rejects a state mismatch without calling nativeExchange and clears the pending request", async () => {
    await begin();
    mockParams = { code: "abc", state: "wrong-state-wrong-state" };
    render(<NativeCallbackScreen />);
    await waitFor(() => expect(screen.getByText("Sign-in failed")).toBeTruthy());
    expect(mockExchange).not.toHaveBeenCalled();
    expect(useAuthStore.getState().token).toBeNull();
    expect(store["nativeAuthPending"]).toBeUndefined();
  });

  it("exchanges code with the verifier, stores the token and routes home", async () => {
    const { state, verifier } = await begin();
    mockExchange.mockResolvedValue({ sessionToken: "tok-1", user: { name: "Asha" } });
    mockParams = { code: "the-code", state };
    render(<NativeCallbackScreen />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/(app)/(home)"));
    expect(mockExchange).toHaveBeenCalledWith({
      requestId: "req-1",
      code: "the-code",
      codeVerifier: verifier,
    });
    expect(useAuthStore.getState().token).toBe("tok-1");
    expect(mockDismiss).toHaveBeenCalled();
  });

  it("honours a pending invite and incomplete profiles", async () => {
    const first = await begin();
    store["pendingInviteToken"] = "inv-9";
    mockExchange.mockResolvedValue({ sessionToken: "tok-2", user: { name: null } });
    mockParams = { code: "c", state: first.state };
    const view = render(<NativeCallbackScreen />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/invite/inv-9"));
    view.unmount();

    delete store["pendingInviteToken"];
    mockReplace.mockClear();
    const second = await begin();
    mockParams = { code: "c", state: second.state };
    render(<NativeCallbackScreen />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/(auth)/complete-profile"));
  });

  it("shows an error when the exchange fails", async () => {
    const { state } = await begin();
    mockExchange.mockRejectedValue(new Error("Invalid or expired sign-in request"));
    mockParams = { code: "c", state };
    render(<NativeCallbackScreen />);
    await waitFor(() => expect(screen.getByText("Sign-in failed")).toBeTruthy());
    expect(useAuthStore.getState().token).toBeNull();
  });
});
