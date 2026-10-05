import { useMemo } from "react";
import { trpc } from "../lib/trpc";
import {
  defineAbilityFor,
  canModify,
  type Action,
  type Resource,
  type Ability,
  type ModifyAffordance,
  type ModifiableRecord,
} from "@hisaabo/shared";

// useAbility — returns the ability for the current session, mirroring the
// API's CASL ruleset. Single source of truth lives in @hisaabo/shared.
export function useAbility(): Ability {
  const { data: session } = trpc.auth.me.useQuery(undefined);
  const role = session?.role ?? "";
  return useMemo(() => defineAbilityFor(role), [role]);
}

// useCan — boolean shortcut for "should I render this button?".
// While the session is loading we return `true` so the UI doesn't flash
// hidden affordances. The API still enforces the real rule on submit.
export function useCan(action: Action, resource: Resource): boolean {
  const { data: session, isLoading } = trpc.auth.me.useQuery(undefined);
  if (isLoading || !session?.role) return true;
  return defineAbilityFor(session.role).can(action, resource);
}

// useCanModify — role permission plus the API's record-level rule for one
// record (a seller_manager may delete only unpaid invoices up to 2 hours old).
export function useCanModify(
  action: "update" | "delete",
  resource: Resource,
  record?: ModifiableRecord,
): ModifyAffordance {
  const ability = useAbility();
  const createdAt = record?.createdAt;
  const status = record?.status;
  return useMemo(
    () => canModify(ability, action, resource, { createdAt, status }),
    [ability, action, resource, createdAt, status],
  );
}
