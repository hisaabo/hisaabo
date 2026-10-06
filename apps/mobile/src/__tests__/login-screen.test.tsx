import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

jest.mock("../lib/trpc", () => require("../test-utils/trpc-stub").trpcModule);
jest.mock("expo-router", () => require("../test-utils/trpc-stub").expoRouterModule);
jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
const mockStart = jest.fn(() => Promise.resolve());
jest.mock("../lib/native-login", () => ({ startNativeLogin: () => mockStart() }));

import { stub, renderScreen } from "../test-utils/trpc-stub";
import LoginScreen from "../../app/(auth)/login";

beforeEach(() => {
  stub.reset();
  mockStart.mockClear();
});

describe("mobile login screen", () => {
  it("offers only 'Continue in browser' and has no password or email inputs", () => {
    stub.data["system.config"] = { multiTenant: false, signupOpen: true };
    renderScreen(null, LoginScreen);
    expect(screen.getByText("Continue in browser")).toBeTruthy();
    expect(screen.queryByText(/password/i)).toBeNull();
    expect(screen.queryByText(/create account/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/password/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/email/i)).toBeNull();
    expect(screen.queryByText(/magic link/i)).toBeNull();
  });

  it("starts the native browser sign-in on press", async () => {
    renderScreen(null, LoginScreen);
    fireEvent.press(screen.getByText("Continue in browser"));
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
  });

  it("uses invite-only copy when signup is closed", () => {
    stub.data["system.config"] = { multiTenant: false, signupOpen: false };
    renderScreen(null, LoginScreen);
    expect(screen.getByText(/invited email/i)).toBeTruthy();
  });
});
