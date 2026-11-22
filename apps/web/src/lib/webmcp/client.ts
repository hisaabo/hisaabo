/**
 * The tRPC client WebMCP tools use — one per registration, pinned to one business.
 *
 * The app's shared client (`@/lib/trpc`) builds `x-business-id` from a module
 * level "current business" at the moment each request is sent. For a human that
 * is right: the UI and the header always agree. For an agent it is a race. A
 * tool call can be confirmed (or sit in a confirmation dialog) AFTER the user
 * switched business, and the request would then carry the NEW business id for a
 * write the user approved against the OLD one.
 *
 * This client has the id baked in when the registration is created, so a call
 * can only ever reach the business whose tools the agent was offered. It is a
 * separate, non-batching client on purpose: nothing it sends is merged into, or
 * shares headers with, a request the UI makes.
 *
 * Web only. The desktop shell authenticates with a Bearer token instead of the
 * cookie session, and WebMCP is never registered there (see isWebMcpAvailable).
 */

import { createTRPCClient, httpLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@hisaabo/api";
import { TRPC_URL } from "@/lib/trpc";
import type { WebMcpTrpcClient } from "./types";

/** The headers every WebMCP request carries. Pure, so tests can assert them without a network. */
export function webMcpRequestHeaders(businessId: string): Record<string, string> {
  return {
    "X-Requested-With": "hisaabo",
    "x-business-id": businessId,
  };
}

export function createWebMcpClient(businessId: string): WebMcpTrpcClient {
  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: TRPC_URL,
        transformer: superjson,
        headers: () => webMcpRequestHeaders(businessId),
        fetch: (url, options) => fetch(url, { ...options, credentials: "include" }),
      }),
    ],
  }) as unknown as WebMcpTrpcClient;
}
