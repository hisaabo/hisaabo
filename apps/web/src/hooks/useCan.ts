import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  defineAbilityFor,
  canModify,
  type Action,
  type Resource,
  type Ability,
  type EditAffordance,
} from "@hisaabo/shared";

// useAbility — returns the CASL-equivalent ability for the current session.
// Wraps trpc.auth.me with a stable, memoised Ability instance.
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

// useCanModify — combined permission + edit-window check for Edit/Delete
// buttons on Invoices and Payments. Returns an EditAffordance describing why
// the action is disabled so callers can render an explanatory tooltip.
export function useCanModify(
  action: "update" | "delete",
  resource: Resource,
  record?: { createdAt?: Date | string | number | null },
): EditAffordance {
  const ability = useAbility();
  return useMemo(
    () => canModify(ability, action, resource, record),
    [ability, action, resource, record?.createdAt],
  );
}
