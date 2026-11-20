import { useSyncExternalStore } from "react";
import { trpc, getBusinessId, subscribeBusinessId } from "@/lib/trpc";

type BusinessLike = { gstRegistrationType?: string | null; gstin?: string | null } | null | undefined;

/**
 * GST status as the sidebar computes it. An unknown business (still loading)
 * counts as registered so GST labels don't flash on first render.
 */
export function isGstRegisteredBusiness(business: BusinessLike): boolean {
  return business?.gstRegistrationType !== "unregistered" || !!business?.gstin;
}

/** The business id sent in x-business-id; re-renders on business switch. */
export function useActiveBusinessId(): string | null {
  return useSyncExternalStore(subscribeBusinessId, getBusinessId, getBusinessId);
}

/**
 * The business the user is currently working in — NOT `businesses[0]`, which
 * is only the default before a switch. Falls back to the first business until
 * the root layout has selected one.
 */
export function useActiveBusiness() {
  const { data: businesses, isLoading } = trpc.business.list.useQuery();
  const activeId = useActiveBusinessId();
  const business = businesses?.find((b) => b.id === activeId) ?? businesses?.[0];
  return {
    business,
    businessId: business?.id ?? null,
    businesses,
    isLoading,
    isGstRegistered: isGstRegisteredBusiness(business),
  };
}
