/**
 * useWebMcp — mounts the Hisaabo tool catalog into the browser's model context.
 *
 * Registration is scoped to a business: every tool call sends `x-business-id`,
 * so re-registering on a business switch is what keeps the agent from writing
 * into the wrong books. Role and the user's agent-access preference gate it
 * for the same reason.
 *
 * Route changes deliberately do NOT re-register. Tearing down and rebuilding
 * a dozen tools on every navigation would make the agent's tool list flicker
 * mid-conversation, so `pathname`, `navigate`, `invalidate` and the tRPC
 * client are read through a ref: the context object exposes getters that
 * always see the latest render's values.
 */

import { useEffect, useRef, useState } from "react";
import { isAgentAccessEnabled, subscribeAgentAccess } from "./preferences";
import { isWebMcpAvailable, registerHisaaboTools } from "./runtime";
import { webMcpTools } from "./tools";
import type { WebMcpToolContext, WebMcpTrpcClient } from "./types";

export interface UseWebMcpInput {
  /** Caller-side gate: signed in, tenant selected, past onboarding. */
  enabled: boolean;
  client: WebMcpTrpcClient;
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
  const { enabled, role, businessId } = input;

  // Latest-render values for everything the context reads lazily. Updated in
  // an effect (never during render) so concurrent re-renders cannot tear it.
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });

  const [agentAccess, setAgentAccess] = useState(() => isAgentAccessEnabled());
  useEffect(() => subscribeAgentAccess(setAgentAccess), []);

  const [registeredCount, setRegisteredCount] = useState(0);
  const available = isWebMcpAvailable();

  useEffect(() => {
    if (!enabled || !businessId) return;
    if (!isWebMcpAvailable() || !isAgentAccessEnabled()) return;

    const controller = new AbortController();
    const ctx: WebMcpToolContext = {
      get client() {
        return latest.current.client;
      },
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
  }, [enabled, businessId, role, agentAccess]);

  return { available, enabled: enabled && agentAccess, registeredCount };
}
