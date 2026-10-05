/**
 * Shared boundary stubs for screen-level permission tests.
 *
 * Usage in a test file (jest hoists jest.mock; `require` inside the factory
 * is allowed):
 *
 *   jest.mock("../lib/trpc", () => require("../test-utils/trpc-stub").trpcModule);
 *   jest.mock("expo-router", () => require("../test-utils/trpc-stub").expoRouterModule);
 *   import { stub, renderScreen } from "../test-utils/trpc-stub";
 *
 * Every `trpc.<router>.<proc>.useQuery()` returns `stub.data["<router>.<proc>"]`;
 * `trpc.auth.me.useQuery()` returns a session for `stub.session.role`.
 * Every `useMutation().mutate(...)` call is recorded in
 * `stub.mutations["<router>.<proc>"]`.
 *
 * The stubbed hooks call a real React hook so hook ordering in the screen
 * under test matches production (React Query hooks). Without that, a hook
 * called after an early return would go unnoticed.
 */
import React, { useRef } from "react";
import { render } from "@testing-library/react-native";
import { ThemeProvider } from "../contexts/ThemeContext";

export const stub = {
  data: {} as Record<string, unknown>,
  session: { role: null as string | null, isLoading: false },
  mutations: {} as Record<string, unknown[]>,
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  params: {} as Record<string, string>,
  reset() {
    for (const k of Object.keys(this.data)) delete this.data[k];
    for (const k of Object.keys(this.mutations)) delete this.mutations[k];
    for (const k of Object.keys(this.params)) delete this.params[k];
    this.session.role = null;
    this.session.isLoading = false;
    this.router.push.mockReset();
    this.router.back.mockReset();
    this.router.replace.mockReset();
  },
};

const noop = () => Promise.resolve(undefined);
const utils = (): unknown =>
  new Proxy(noop, {
    get: (_t, prop) => (prop === "then" ? undefined : utils()),
    apply: () => Promise.resolve(undefined),
  });

function record(key: string, args: unknown) {
  (stub.mutations[key] ??= []).push(args);
}

const node = (path: string[]): unknown =>
  new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return undefined;
        const key = path.join(".");
        if (prop === "useQuery" || prop === "useInfiniteQuery") {
          return () => {
            useRef(null);
            if (key === "auth.me") {
              return {
                data: stub.session.role == null ? undefined : { role: stub.session.role, user: { id: "u1" } },
                isLoading: stub.session.isLoading,
              };
            }
            return {
              data: stub.data[key],
              isLoading: false,
              isFetching: false,
              isRefetching: false,
              isError: false,
              error: null,
              refetch: jest.fn(),
            };
          };
        }
        if (prop === "useMutation") {
          return () => {
            useRef(null);
            return {
              mutate: (args: unknown) => record(key, args),
              mutateAsync: (args: unknown) => {
                record(key, args);
                return Promise.resolve(undefined);
              },
              isPending: false,
            };
          };
        }
        if (prop === "useUtils" && path.length === 0) {
          return () => {
            useRef(null);
            return utils();
          };
        }
        return node([...path, String(prop)]);
      },
    },
  );

/** Replacement for the `src/lib/trpc` module. */
export const trpcModule = { trpc: node([]) };

/** Replacement for `expo-router`. */
const Stack = Object.assign(() => null, { Screen: () => null });
export const expoRouterModule = {
  useRouter: () => stub.router,
  useLocalSearchParams: () => stub.params,
  useFocusEffect: () => {},
  Stack,
  Link: ({ children }: { children: React.ReactNode }) => children,
};

/** Render a screen as `role`, inside the real ThemeProvider. */
export function renderScreen(role: string | null, Screen: React.ComponentType, opts: { loading?: boolean } = {}) {
  stub.session.role = role;
  stub.session.isLoading = opts.loading ?? false;
  return render(
    <ThemeProvider initialMode="dark">
      <Screen />
    </ThemeProvider>,
  );
}
