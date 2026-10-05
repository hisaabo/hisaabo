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

// useCan — boolean shortcut for the common "show this button?" case.
// During the initial session load (role unknown) it returns `true` so the
// UI doesn't flash hidden affordances; the API still enforces the real rule.
export function useCan(action: Action, resource: Resource): boolean {
  const { data: session, isLoading } = trpc.auth.me.useQuery(undefined);
  if (isLoading || !session?.role) return true;
  return defineAbilityFor(session.role).can(action, resource);
}
