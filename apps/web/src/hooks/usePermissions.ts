import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { canAccess, type Action, type Resource } from "@/lib/permissions";

/**
 * Reads the current session role and exposes a `can(action, resource)` helper
 * plus the raw role. Use this to gate action affordances (create / edit /
 * delete buttons) so read-only roles like `accountant` don't see controls they
 * can't use. The server still enforces every mutation.
 */
export function usePermissions() {
  const { data: session } = trpc.auth.me.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });
  const role = session?.role ?? null;

  return useMemo(
    () => ({
      role,
      can: (action: Action, resource: Resource) => canAccess(role, resource, action),
    }),
    [role],
  );
}
