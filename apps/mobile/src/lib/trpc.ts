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

/**
 * Build the common tRPC link options — URL, transformer, and headers.
 *
 * WHY `X-Requested-With: hisaabo` IS UNCONDITIONAL:
 * The API enforces a CSRF check on every cookie-authenticated POST
 * (`packages/api/src/lib/csrf-middleware.ts` and the matching tRPC
 * middleware in `packages/api/src/trpc.ts`). Any request without this
 * header that also carries a `session_id` cookie is rejected with a
 * 403.
 *
 * React Native's native HTTP stack (URLSession / OkHttp) maintains a
 * per-app cookie jar that replays any `Set-Cookie` the API ever sent
 * — including the `session_id` cookie from `auth.verifyMagicLink` —
 * on every subsequent request, even though this JS layer never
 * touches cookies. Without the header the second mobile POST would
 * be rejected and the tRPC client would report "Unable to transform
 * response from server" (because the Hono `{error: "…"}` shape is
 * not a valid superjson error envelope).
 *
 * Exported for tests (see `__tests__/trpc-headers.test.ts`).
 */
export function commonOptions() {
  const url = `${getApiUrl()}/api/trpc`;
  return {
    url,
    transformer: superjson,
    headers() {
      const headers: Record<string, string> = {
        "X-Requested-With": "hisaabo",
      };
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
        const headers: Record<string, string> = {
          // Required by the API CSRF middleware — see `commonOptions`
          // above for the full explanation. Must be set even on the
          // vanilla client because the very first call it makes
          // (`auth.me` on app launch) can replay a stale native
          // cookie jar entry.
          "X-Requested-With": "hisaabo",
        };
        const token = getTokenSync();
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }
        return headers;
      },
    }),
  ],
});
