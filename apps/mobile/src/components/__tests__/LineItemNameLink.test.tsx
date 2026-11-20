import { fireEvent, screen } from "@testing-library/react-native";

jest.mock("../../lib/trpc", () => require("../../test-utils/trpc-stub").trpcModule);
jest.mock("expo-router", () => require("../../test-utils/trpc-stub").expoRouterModule);
jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);

import { stub, renderScreen } from "../../test-utils/trpc-stub";
import { LineItemNameLink } from "../LineItemNameLink";

beforeEach(() => stub.reset());

describe("LineItemNameLink", () => {
  it("pushes the item screen (so native back returns to the document) when tapped", () => {
    renderScreen("owner", () => <LineItemNameLink itemId="item-9" name="Steel Rod" />);
    fireEvent.press(screen.getByText("Steel Rod"));
    expect(stub.router.push).toHaveBeenCalledWith("/(app)/(items)/item-9");
  });

  it("is plain non-tappable text for free-text lines without an item id", () => {
    renderScreen("owner", () => <LineItemNameLink itemId={null} name="Custom charge" />);
    expect(screen.getByText("Custom charge")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
