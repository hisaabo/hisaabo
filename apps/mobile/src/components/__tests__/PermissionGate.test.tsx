import { Text } from "react-native";
import { fireEvent, screen } from "@testing-library/react-native";

jest.mock("../../lib/trpc", () => require("../../test-utils/trpc-stub").trpcModule);
jest.mock("expo-router", () => require("../../test-utils/trpc-stub").expoRouterModule);
jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);

import { stub, renderScreen } from "../../test-utils/trpc-stub";
import { PermissionGate } from "../PermissionGate";

const Guarded = () => (
  <PermissionGate action="create" resource="Expense">
    <Text>expense form</Text>
  </PermissionGate>
);

beforeEach(() => stub.reset());

describe("PermissionGate", () => {
  it("renders the screen for a role with the permission", () => {
    renderScreen("accountant", Guarded);
    expect(screen.getByText("expense form")).toBeTruthy();
    expect(screen.queryByTestId("permission-denied")).toBeNull();
  });

  it("renders a no-access state instead of the screen for a role without it", () => {
    renderScreen("seller", Guarded);
    expect(screen.queryByText("expense form")).toBeNull();
    expect(screen.getByTestId("permission-denied")).toBeTruthy();
    expect(screen.getByText("You don't have access to this")).toBeTruthy();
  });

  it("'Go back' leaves the screen", () => {
    renderScreen("seller", Guarded);
    fireEvent.press(screen.getByText("Go back"));
    expect(stub.router.back).toHaveBeenCalledTimes(1);
  });

  it("does not flash the no-access state while the session is still loading", () => {
    renderScreen(null, Guarded, { loading: true });
    expect(screen.getByText("expense form")).toBeTruthy();
  });
});
