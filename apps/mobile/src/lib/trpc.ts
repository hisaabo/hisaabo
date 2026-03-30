import { createTRPCReact } from "@trpc/react-query";
import {
  createTRPCClient as createVanillaClient,
  httpBatchLink,
  splitLink,
  httpLink,
} from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@hisaabo/api";
import { getTokenSync } from "./auth";
import { getApiUrl } from "./api-url";
import { useBusinessStore } from "../stores/business";

export const trpc = createTRPCReact<AppRouter>();

function commonOptions() {
  const url = `${getApiUrl()}/api/trpc`;
  return {
    url,
    transformer: superjson,
    headers() {
      const headers: Record<string, string> = {};
      const token = getTokenSync();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const businessId = useBusinessStore.getState().businessId;
      if (businessId) {
        headers["x-business-id"] = businessId;
      }
      return headers;
    },
  };
}

export function createTRPCClient() {
  return trpc.createClient({
    links: [
      splitLink({
        condition: (op) => op.type === "mutation",
        true: httpLink(commonOptions()),
        false: httpBatchLink(commonOptions()),
      }),
    ],
  });
}

/**
 * Vanilla (non-React) tRPC client for imperative calls outside the
 * component tree — e.g. verifying a session token from the root layout
 * before any providers are mounted.
 */
export const vanillaTRPC = createVanillaClient<AppRouter>({
  links: [
    httpLink({
      url: `${getApiUrl()}/api/trpc`,
      transformer: superjson,
      headers() {
        const headers: Record<string, string> = {};
        const token = getTokenSync();
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }
        return headers;
      },
    }),
  ],
});
