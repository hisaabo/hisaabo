/**
 * Shared boundary stubs for page-level permission tests.
 *
 * Usage in a test file:
 *
 *   vi.mock("@/lib/trpc", async () => (await import("@/test-utils/trpc-stub")).trpcModule);
 *   vi.mock("@tanstack/react-router", async (importOriginal) => ({
 *     ...(await importOriginal<object>()),
 *     ...(await import("@/test-utils/trpc-stub")).routerOverrides,
 *   }));
 *   import { stub } from "@/test-utils/trpc-stub";
 *
 * Every `trpc.<router>.<proc>.useQuery()` returns `stub.data["<router>.<proc>"]`;
 * `trpc.auth.me.useQuery()` returns a session for `stub.session.role`.
 * Every `useMutation().mutate(...)` call is recorded in
 * `stub.mutations["<router>.<proc>"]`.
 *
 * The stubbed hooks call a real React hook so hook ordering in the component
 * under test matches production (React Query hooks). Without that, a hook
 * called after an early return would go unnoticed.
 */
import { useRef } from "react";
import { vi } from "vitest";

export const stub = {
  /** Canned `useQuery` data keyed by tRPC path, e.g. "party.list". */
  data: {} as Record<string, unknown>,
  /** Session returned by `auth.me`. `undefined` role = no session data at all. */
  session: { role: null as string | null | undefined, isLoading: false },
  /** Arguments of every `mutate`/`mutateAsync` call, keyed by tRPC path. */
  mutations: {} as Record<string, unknown[]>,
  navigate: vi.fn() as (...args: unknown[]) => void,
  pathname: "/",
  search: {} as Record<string, unknown>,
  reset() {
    for (const k of Object.keys(this.data)) delete this.data[k];
    for (const k of Object.keys(this.mutations)) delete this.mutations[k];
    this.session.role = null;
    this.session.isLoading = false;
    this.navigate = vi.fn();
    this.pathname = "/";
    this.search = {};
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
                data:
                  stub.session.role === undefined
                    ? undefined
                    : {
                        user: { id: "u1", name: "Test User", email: "test@example.com" },
                        tenantId: "t1",
                        tenantName: "Test Org",
                        role: stub.session.role,
                        needsProfile: false,
                      },
                isLoading: stub.session.isLoading,
                isFetching: false,
              };
            }
            return {
              data: stub.data[key],
              isLoading: false,
              isFetching: false,
              isError: false,
              error: null,
              refetch: vi.fn(),
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
              variables: undefined,
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

/** Replacement for the `@/lib/trpc` module. */
export const trpcModule = {
  trpc: node([]),
  getBusinessId: () => "biz-1",
  setBusinessId: vi.fn(),
  subscribeBusinessId: () => () => {},
  queryClient: { invalidateQueries: vi.fn(), clear: vi.fn() },
};

/** Overrides for `@tanstack/react-router` navigation hooks. */
export const routerOverrides = {
  useNavigate: () => (...args: unknown[]) => stub.navigate(...args),
  useSearch: () => stub.search,
  useLocation: () => ({ pathname: stub.pathname }),
  Outlet: () => null,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
};
