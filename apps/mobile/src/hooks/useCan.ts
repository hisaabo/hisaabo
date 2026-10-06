import { useMemo } from "react";
import { trpc } from "../lib/trpc";
import {
  defineAbilityFor,
  canCreateDocumentType,
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

// useCan — boolean shortcut for "should I show this control?". Fails closed
// (false) while the session is loading or the role is unknown, per the
// role-based-ui ADR; the root layouts gate on session load so this is brief.
export function useCan(action: Action, resource: Resource): boolean {
  const { data: session } = trpc.auth.me.useQuery(undefined);
  if (!session?.role) return false;
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

// useCanCreateDocument — role gate for creating a document of `documentType` on
// the given sale/purchase side. Mirrors the API rule that sellers cannot create
// purchase-side documents (purchase invoices, purchase returns, debit notes).
// Requires create:Invoice as well; fails closed while the session loads.
export function useCanCreateDocument(
  documentType: string,
  side?: "sale" | "purchase",
): boolean {
  const { data: session } = trpc.auth.me.useQuery(undefined);
  if (!session?.role) return false;
  if (!defineAbilityFor(session.role).can("create", "Invoice")) return false;
  return canCreateDocumentType(session.role, documentType, side);
}
