/**
 * Re-establishes a tenant job's context in the worker (docs/architecture/
 * queue.md §5.2 rule 4). Nothing in the envelope is trusted beyond its ids:
 * the tenant must still be active, the business must still belong to it (the
 * lib/authz getBusinessAccess predicate), and the actor must still be a
 * member. Queries go straight to the DB — the worker runs no cache listener,
 * so the API's authz caches could be stale here.
 *
 * A failed check is a PermanentError (retrying cannot fix it); a DB error is
 * an ordinary error and is retried.
 */
import { eq, and } from "drizzle-orm";
import { controlDb, getTenantDb, tenants, tenantMembers, businesses, type TenantDatabase } from "@hisaabo/db";
import type { Envelope } from "./envelope.js";
import { PermanentError } from "./errors.js";

async function isMember(tenantId: string, userId: string): Promise<boolean> {
  const [row] = await controlDb
    .select({ id: tenantMembers.id })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
    .limit(1);
  return !!row;
}

export async function establishTenantContext(envelope: Envelope): Promise<{ db: TenantDatabase }> {
  const tenantId = envelope.tenantId;
  if (!tenantId) throw new PermanentError("Tenant job without tenantId");

  const [tenant] = await controlDb
    .select({ status: tenants.status })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant || tenant.status !== "active") throw new PermanentError("Organization is not active");

  const db = await getTenantDb(tenantId);

  if (envelope.businessId) {
    const [biz] = await db
      .select({ createdByUserId: businesses.createdByUserId })
      .from(businesses)
      .where(eq(businesses.id, envelope.businessId))
      .limit(1);
    if (!biz || !(await isMember(tenantId, biz.createdByUserId))) {
      throw new PermanentError("Business not found");
    }
  }

  if (envelope.actorUserId && !(await isMember(tenantId, envelope.actorUserId))) {
    throw new PermanentError("Actor is no longer a member of the organization");
  }

  return { db };
}
