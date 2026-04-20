import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, splitLink, httpLink } from "@trpc/client";
import { QueryClient, QueryCache } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "@hisaabo/api";
import { isDesktop } from "./isDesktop";
import { ensureAccessToken } from "./desktop-session";

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
  // Desktop uses Bearer-token auth (see apps/web/src/lib/desktop-session.ts
  // for the rationale — SameSite=Lax cookies can't span `tauri.localhost`
  // and `api.hisaabo.in`). Web keeps the HttpOnly cookie for XSS resistance.
  //
  // TWO-TOKEN FLOW (desktop):
  // `headers()` is async — tRPC supports this. On desktop we await
  // `ensureAccessToken()` which either returns a cached short-lived access
  // token (at_*) or transparently issues a new one using the keychain
  // refresh token. The result is placed in `Authorization: Bearer at_*`.
  // This means the keychain refresh token is NEVER sent for normal API
  // calls; it is only used by the `auth.issueAccessToken` endpoint inside
  // `ensureAccessToken()` via a direct fetch.
  const desktop = isDesktop();
  return {
    transformer: superjson,
    async headers() {
      const headers: Record<string, string> = {
        "X-Requested-With": "hisaabo",
      };
      if (currentBusinessId) {
        headers["x-business-id"] = currentBusinessId;
      }
      if (desktop) {
        // Signals the server to skip Turnstile. Spoofable by design — see
        // auth router for the trade-off documentation.
        headers["x-hisaabo-client"] = "desktop";
        // Await the access token — issues a new one transparently if
        // the cached one has expired or is within the 30s refresh window.
        const token = await ensureAccessToken();
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }
      }
      return headers;
    },
    fetch(url: URL | RequestInfo, options?: RequestInit) {
      // Only include cookies on web. Desktop is cross-origin to the API and
      // sends Bearer instead; including credentials would make the browser
      // demand CORS `Access-Control-Allow-Credentials: true` on every
      // response to `tauri.localhost` without any auth benefit.
      const credentials: RequestCredentials = desktop ? "omit" : "include";
      return fetch(url, { ...options, credentials });
    },
  };
}

const TRPC_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api/trpc`
  : "/api/trpc";

export function createTRPCClient() {
  return trpc.createClient({
    links: [
      // Mutations go through a non-batching link to avoid SuperJSON parse failures
      // when large mutation responses get combined with background query responses
      splitLink({
        condition: (op) => op.type === "mutation",
        true: httpLink({ url: TRPC_URL, ...commonOptions() }),
        false: httpBatchLink({ url: TRPC_URL, ...commonOptions() }),
      }),
    ],
  });
}

// Track whether we're already redirecting to avoid multiple redirects
let isRedirectingToLogin = false;

function handleAuthError(error: unknown) {
  if (isRedirectingToLogin) return;
  const trpcError = error as { data?: { code?: string } };
  if (trpcError?.data?.code === "UNAUTHORIZED") {
    isRedirectingToLogin = true;
    // Use sessionStorage so the login page can show a message
    sessionStorage.setItem("sessionExpired", "1");
    window.location.href = "/login";
  }
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30 seconds
      retry: (failureCount, error) => {
        // Don't retry UNAUTHORIZED — session is gone
        const trpcError = error as { data?: { code?: string } };
        if (trpcError?.data?.code === "UNAUTHORIZED") return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      onError: handleAuthError,
    },
  },
  queryCache: new QueryCache({
    onError: handleAuthError,
  }),
});
