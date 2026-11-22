/**
 * useWebMcp — mounts the Hisaabo tool catalog into the browser's model context.
 *
 * Registration is scoped to a business: every tool call sends `x-business-id`,
 * so re-registering on a business switch is what keeps the agent from writing
 * into the wrong books. Role and the user's agent-access preference gate it
 * for the same reason.
 *
 * Each registration gets its OWN tRPC client with the business id baked into its
 * headers (client.ts), and its abort signal travels in the context. Together
 * with the runtime's re-check after a confirmation, a call that was prepared for
 * business A can never be sent to business B, even if the user switched while a
 * dialog was open.
 *
 * Route changes deliberately do NOT re-register. Tearing down and rebuilding
 * a dozen tools on every navigation would make the agent's tool list flicker
 * mid-conversation, so `pathname`, `navigate`, `invalidate` and the user's
 * name are read through a ref: the context object exposes getters that always
 * see the latest render's values. The tRPC client is NOT one of them — it is
 * fixed per registration, on purpose.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createWebMcpClient } from "./client";
import { isAgentAccessEnabled, subscribeAgentAccess, type AgentPreferenceScope } from "./preferences";
import { isWebMcpAvailable, registerHisaaboTools } from "./runtime";
import { webMcpTools } from "./tools";
import type { WebMcpToolContext, WebMcpTrpcClient } from "./types";

export interface UseWebMcpInput {
  /**
   * Caller-side gate: signed in, tenant selected, past onboarding, and neither the
   * operator (WEBMCP_DISABLED) nor the organization owner has turned agents off.
   */
  enabled: boolean;
  /** Who is signed in and which organization is selected: the user's preference is stored per person per organization. */
  userId: string | null;
  tenantId: string | null;
  /** Builds the client one registration uses, pinned to a business. Defaults to the real HTTP client; tests inject a fake. */
  createClient?: (businessId: string) => WebMcpTrpcClient;
  /**
   * The business the app is showing right now, read at call time. Defaults to
   * the latest `businessId` prop; the root passes the same module-level value
   * the UI's own requests use.
   */
  getActiveBusinessId?: () => string | null;
  role: string | null;
  businessId: string | null;
  businessName: string | null;
  userName: string | null;
  pathname: string;
  navigate: (to: string, search?: Record<string, string>) => void;
  invalidate: () => Promise<void> | void;
}

export interface UseWebMcpResult {
  /** The browser exposes a model context (spec surface or polyfill). */
  available: boolean;
  /** Tools should be live: the caller's gate AND the user's preference. */
  enabled: boolean;
  registeredCount: number;
}

export function useWebMcp(input: UseWebMcpInput): UseWebMcpResult {
  const { enabled, role, businessId, userId, tenantId } = input;

  // Latest-render values for everything the context reads lazily. Updated in
  // an effect (never during render) so concurrent re-renders cannot tear it.
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });

  // The preference is read for THIS user and organization on every render
  // (useSyncExternalStore), never cached in state: when another person signs in
  // on the same browser there is no render in which they inherit the previous
  // person's "on".
  const scope = useMemo<AgentPreferenceScope | null>(() => (userId ? { userId, tenantId } : null), [userId, tenantId]);
  const subscribe = useCallback((onChange: () => void) => subscribeAgentAccess(scope, onChange), [scope]);
  const agentAccess = useSyncExternalStore(
    subscribe,
    () => isAgentAccessEnabled(scope),
    () => false,
  );

  const [registeredCount, setRegisteredCount] = useState(0);
  const available = isWebMcpAvailable();

  useEffect(() => {
    if (!enabled || !businessId) return;
    if (!isWebMcpAvailable() || !isAgentAccessEnabled(scope)) return;

    const controller = new AbortController();
    const client = (latest.current.createClient ?? createWebMcpClient)(businessId);
    const ctx: WebMcpToolContext = {
      client,
      signal: controller.signal,
      activeBusinessId: () =>
        latest.current.getActiveBusinessId ? latest.current.getActiveBusinessId() : latest.current.businessId,
      role,
      businessId,
      get businessName() {
        return latest.current.businessName;
      },
      get userName() {
        return latest.current.userName;
      },
      get pathname() {
        return latest.current.pathname;
      },
      navigate: (to, search) => latest.current.navigate(to, search),
      invalidate: () => latest.current.invalidate(),
    };

    let live = true;
    void registerHisaaboTools(webMcpTools, ctx, { signal: controller.signal })
      .then((result) => {
        if (live) setRegisteredCount(result.registered.length);
      })
      .catch(() => {
        if (live) setRegisteredCount(0);
      });

    return () => {
      live = false;
      controller.abort();
      setRegisteredCount(0);
    };
  }, [enabled, businessId, role, agentAccess, scope]);

  return { available, enabled: enabled && agentAccess, registeredCount };
}
