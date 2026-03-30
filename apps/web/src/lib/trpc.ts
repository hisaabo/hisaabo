import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, splitLink, httpLink } from "@trpc/client";
import { QueryClient } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "@hisaabo/api";

// The explicit `as any` cast avoids TS2742 "inferred type cannot be named" error caused
// by tRPC's internal .d.mts paths resolving through hoisted node_modules.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const trpc: ReturnType<typeof createTRPCReact<AppRouter>> = createTRPCReact<AppRouter>() as any;

// Business ID stored in memory — set after user selects a business
let currentBusinessId: string | null = null;
export function setBusinessId(id: string | null) {
  currentBusinessId = id;
}
export function getBusinessId() {
  return currentBusinessId;
}

function commonOptions() {
  return {
    transformer: superjson,
    headers() {
      const headers: Record<string, string> = {};
      if (currentBusinessId) {
        headers["x-business-id"] = currentBusinessId;
      }
      return headers;
    },
    fetch(url: URL | RequestInfo, options?: RequestInit) {
      return fetch(url, { ...options, credentials: "include" as RequestCredentials });
    },
  };
}

export function createTRPCClient() {
  return trpc.createClient({
    links: [
      // Mutations go through a non-batching link to avoid SuperJSON parse failures
      // when large mutation responses get combined with background query responses
      splitLink({
        condition: (op) => op.type === "mutation",
        true: httpLink({ url: "/api/trpc", ...commonOptions() }),
        false: httpBatchLink({ url: "/api/trpc", ...commonOptions() }),
      }),
    ],
  });
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30 seconds
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
