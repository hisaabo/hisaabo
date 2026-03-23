import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { QueryClient } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "@hisaabo/api";

export const trpc = createTRPCReact<AppRouter>();

// Business ID stored in memory — set after user selects a business
let currentBusinessId: string | null = null;
export function setBusinessId(id: string | null) {
  currentBusinessId = id;
}
export function getBusinessId() {
  return currentBusinessId;
}

export function createTRPCClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: "/api/trpc",
        transformer: superjson,
        headers() {
          const headers: Record<string, string> = {};
          if (currentBusinessId) {
            headers["x-business-id"] = currentBusinessId;
          }
          return headers;
        },
        fetch(url, options) {
          return fetch(url, { ...options, credentials: "include" });
        },
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
