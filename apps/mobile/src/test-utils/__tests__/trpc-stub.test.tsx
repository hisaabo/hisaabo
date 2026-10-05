/**
 * Contract tests for the shared tRPC / expo-router stub used by the
 * screen-level permission suites (src/__tests__/role-gating-*.test.tsx). If
 * the stub misbehaves, those suites could pass vacuously — so it is pinned.
 */
import { Text } from "react-native";
import { renderHook, render, screen } from "@testing-library/react-native";

jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);

import { stub, trpcModule, expoRouterModule, renderScreen } from "../trpc-stub";

// The stub is a proxy; type it loosely for these contract checks.
const trpc = trpcModule.trpc as any;

beforeEach(() => stub.reset());

describe("trpc-stub (mobile)", () => {
  it("returns canned query data keyed by router.procedure", () => {
    stub.data["item.getById"] = { id: "i1" };
    const { result } = renderHook(() => trpc.item.getById.useQuery({ id: "i1" }));
    expect(result.current.data).toEqual({ id: "i1" });
    expect(result.current.isLoading).toBe(false);
  });

  it("auth.me: no data without a role, a session with one", () => {
    expect(renderHook(() => trpc.auth.me.useQuery()).result.current.data).toBeUndefined();
    stub.session.role = "accountant";
    expect(renderHook(() => trpc.auth.me.useQuery()).result.current.data.role).toBe("accountant");
  });

  it("records mutate and mutateAsync calls per procedure", async () => {
    const { result } = renderHook(() => trpc.payment.delete.useMutation());
    result.current.mutate({ id: "a" });
    await result.current.mutateAsync({ id: "b" });
    expect(stub.mutations["payment.delete"]).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("useUtils returns callable, chainable invalidators that resolve", async () => {
    const { result } = renderHook(() => trpc.useUtils());
    await expect(result.current.invoice.list.invalidate()).resolves.toBeUndefined();
    expect(result.current.then).toBeUndefined(); // not mistaken for a promise
  });

  it("reset clears data, mutations, params, session and router mocks", () => {
    stub.data["x.y"] = 1;
    stub.mutations["x.y"] = [1];
    stub.params.id = "1";
    stub.session.role = "admin";
    stub.router.push("/somewhere");
    stub.reset();
    expect(stub.data).toEqual({});
    expect(stub.mutations).toEqual({});
    expect(stub.params).toEqual({});
    expect(stub.session).toEqual({ role: null, isLoading: false });
    expect(stub.router.push).not.toHaveBeenCalled();
  });

  it("expo-router replacement exposes router, params and inert components", () => {
    stub.params.id = "p1";
    expect(expoRouterModule.useRouter()).toBe(stub.router);
    expect(expoRouterModule.useLocalSearchParams()).toEqual({ id: "p1" });
    expect(stub.router.canGoBack()).toBe(true);
    expect(expoRouterModule.useFocusEffect()).toBeUndefined();
    expect(expoRouterModule.Stack()).toBeNull();
    expect(expoRouterModule.Stack.Screen()).toBeNull();
    render(<expoRouterModule.Link>{<Text>linked</Text>}</expoRouterModule.Link>);
    expect(screen.getByText("linked")).toBeTruthy();
  });

  it("renderScreen sets the role and loading state before rendering", () => {
    renderScreen("seller", () => <Text>screen</Text>, { loading: true });
    expect(stub.session).toEqual({ role: "seller", isLoading: true });
    expect(screen.getByText("screen")).toBeTruthy();
  });
});
