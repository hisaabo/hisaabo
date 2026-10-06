import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  defineAbilityFor,
  type Action,
  type Resource,
  type Ability,
} from "@hisaabo/shared";

// useAbility — returns the CASL-equivalent ability for the current session.
// Wraps trpc.auth.me with a stable, memoised Ability instance. Pair it with
// `canModify` from @hisaabo/shared for per-record decisions (e.g. list rows).
export function useAbility(): Ability {
  const { data: session } = trpc.auth.me.useQuery(undefined);
  const role = session?.role ?? "";
  return useMemo(() => defineAbilityFor(role), [role]);
}

// useCan — boolean shortcut for "should I show this control?". Fails closed
// (false) while the session is loading or the role is unknown, per the
// role-based-ui ADR; the root layouts gate on session load so this is brief.
export function useCan(action: Action, resource: Resource): boolean {
  const { data: session } = trpc.auth.me.useQuery(undefined);
  if (!session?.role) return false;
  return defineAbilityFor(session.role).can(action, resource);
}
