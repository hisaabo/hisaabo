/**
 * authorization-coverage.test.ts — CI fence for cross-tenant authorization.
 *
 * WHY THIS FILE EXISTS:
 * The pen-test "Multi-Tenant IDOR / Authorization Test Checklist" recommends an
 * automated test that fails CI whenever a new id-accepting procedure is registered
 * without passing through the ownership middleware. This is that test.
 *
 * It introspects the live appRouter and asserts that EVERY procedure whose input
 * carries a client-supplied identifier (a field named `id` or ending in `Id`)
 * either:
 *   (a) passes through the `hasBusinessAccess` middleware — which scopes ctx to a
 *       validated businessId, the foundation of per-handler businessId WHERE
 *       clauses — OR
 *   (b) is listed in EXEMPT below with a one-line justification of how it is
 *       otherwise authorized (session / user / tenant-membership / role).
 *
 * A NEW id-accepting procedure that does neither fails this test, forcing the
 * author to make a conscious authorization decision (and, for business-data
 * endpoints, to add a behavioural IDOR test in
 * integration/idor-authorization.test.ts).
 *
 * This is a pure-introspection test: it builds no database rows. Importing the
 * router instantiates DB clients lazily (postgres.js connects on first query),
 * so no live database is required.
 */

import { describe, it, expect } from "vitest";
import { appRouter } from "../router.js";
import { businessProcedure } from "../trpc.js";

// ── Procedures that legitimately accept an id but do NOT pass through
//    hasBusinessAccess. Each entry documents how it is authorized instead.
//    Keep this list minimal; every entry is verified against its handler.
const EXEMPT: Record<string, string> = {
  // ── Control plane: scoped by session / user / tenant-membership / role ──
  "apiKey.revoke": "DELETE scoped by id + userId + tenantId",
  "auth.revokeSession": "DELETE scoped by sessionId + userId",
  "tenant.acceptById": "invitation matched to caller's own email",
  "tenant.select": "verifies caller is a member of the target tenant",
  "tenant.removeMember": "tenant-scoped (ctx.tenantId) + owner/admin role gate",
  "tenant.updateMemberRole": "tenant-scoped (ctx.tenantId) + owner/admin role gate",
  "tenant.revokeInvitation": "tenant-scoped (ctx.tenantId) + owner/admin role gate",
  "selfExport.request": "verifies caller is owner of the target tenant",
  "selfImport.request": "verifies caller is owner of the target tenant",

  // ── Business-entity ops: take the business id from input (not the
  //    x-business-id header) so they run on tenantProcedure. Ownership is
  //    enforced via lib/tenant-businesses.ts (createdByUserId ∈ tenant members),
  //    mirroring hasBusinessAccess. Behavioural coverage lives in
  //    integration/business-isolation.test.ts. ──
  "business.getById": "tenant-ownership scope on businesses.createdByUserId",
  "business.update": "tenant-ownership scope on businesses.createdByUserId",
  "business.uploadLogo": "tenant-ownership scope on businesses.createdByUserId",
  "business.deleteLogo": "tenant-ownership scope on businesses.createdByUserId",
  "business.setPosEnabled": "tenant-ownership scope on businesses.createdByUserId",
  "business.ensureWalkInParty": "assertBusinessInTenant() guard before seeding",
};

// ── Introspection helpers ───────────────────────────────────────────────────

// The last middleware added to businessProcedure is hasBusinessAccess; every
// procedure built from businessProcedure/authorizedProcedure shares this exact
// reference in its middleware chain.
const businessMiddlewares = (businessProcedure as unknown as { _def: { middlewares: unknown[] } })._def.middlewares;
const hasBusinessAccessMw = businessMiddlewares[businessMiddlewares.length - 1];

type AnyProc = { _def: { type: string; inputs?: unknown[]; middlewares: unknown[] } };
const procedures = (appRouter as unknown as { _def: { procedures: Record<string, AnyProc> } })._def.procedures;

/** Unwrap zod effect/optional/nullable/default wrappers down to the core type. */
function unwrapZod(schema: unknown): any {
  let s: any = schema;
  for (let i = 0; i < 10 && s; i++) {
    const tn = s?._def?.typeName;
    if (tn === "ZodEffects") s = s._def.schema;
    else if (tn === "ZodOptional" || tn === "ZodNullable" || tn === "ZodDefault") s = s._def.innerType;
    else break;
  }
  return s;
}

/** Union of top-level input field names across all of a procedure's input schemas. */
function inputFieldNames(p: AnyProc): string[] {
  const keys = new Set<string>();
  for (const inp of p._def.inputs ?? []) {
    const s = unwrapZod(inp);
    if (s?._def?.typeName === "ZodObject") {
      const shape = typeof s._def.shape === "function" ? s._def.shape() : s.shape;
      for (const k of Object.keys(shape ?? {})) keys.add(k);
    }
  }
  return [...keys];
}

const ID_FIELD = /^id$|Id$/;
function acceptsClientId(p: AnyProc): boolean {
  return inputFieldNames(p).some((k) => ID_FIELD.test(k));
}
function throughBusinessAccess(p: AnyProc): boolean {
  return p._def.middlewares.includes(hasBusinessAccessMw);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("authorization coverage — every id-accepting procedure is ownership-guarded", () => {
  it("no id-accepting procedure bypasses hasBusinessAccess without an EXEMPT justification", () => {
    const offenders: string[] = [];
    for (const [name, p] of Object.entries(procedures)) {
      if (!acceptsClientId(p)) continue;
      if (throughBusinessAccess(p)) continue;
      if (name in EXEMPT) continue;
      offenders.push(`${name} [${p._def.type}] ids: ${inputFieldNames(p).filter((k) => ID_FIELD.test(k)).join(", ")}`);
    }

    expect(
      offenders,
      [
        "Found id-accepting tRPC procedure(s) that neither pass through hasBusinessAccess",
        "nor are listed in EXEMPT. Each accepts a client-supplied identifier and is a",
        "potential cross-tenant IDOR. Fix by EITHER:",
        "  • building it on businessProcedure/authorizedProcedure (preferred for",
        "    business-scoped data), AND adding a behavioural test in",
        "    integration/idor-authorization.test.ts; OR",
        "  • if it is authorized another way (session/user/tenant/role), add it to",
        "    EXEMPT in this file with a one-line justification.",
        "",
        "Offending procedures:",
        ...offenders.map((o) => `  - ${o}`),
      ].join("\n"),
    ).toEqual([]);
  });

  it("EXEMPT has no stale entries (every entry still exists, accepts an id, and bypasses hasBusinessAccess)", () => {
    const stale: string[] = [];
    for (const name of Object.keys(EXEMPT)) {
      const p = procedures[name];
      if (!p) { stale.push(`${name} (no longer exists)`); continue; }
      if (!acceptsClientId(p)) { stale.push(`${name} (no longer accepts a client id)`); continue; }
      if (throughBusinessAccess(p)) { stale.push(`${name} (now passes through hasBusinessAccess — remove from EXEMPT)`); continue; }
    }
    expect(stale, `Stale EXEMPT entries — clean these up:\n${stale.map((s) => `  - ${s}`).join("\n")}`).toEqual([]);
  });

  it("sanity: the hasBusinessAccess middleware reference was resolved", () => {
    // Guards against a refactor that changes the businessProcedure chain shape
    // and silently makes throughBusinessAccess() always false.
    expect(typeof hasBusinessAccessMw).toBe("function");
    expect(businessMiddlewares.length).toBe(4); // csrf, isAuthenticated, hasTenantAccess, hasBusinessAccess
  });
});
