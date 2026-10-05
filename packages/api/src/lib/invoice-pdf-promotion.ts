import { and, eq } from "drizzle-orm";
import { controlDb, tenantMembers } from "@hisaabo/db";
import { defineAbilityFor, mapDbRole } from "./permissions.js";

/**
 * Downloading the PDF of a draft sale invoice promotes it to "sent" (see
 * GET /api/invoices/:id/pdf in server.ts). That is a status change, so it
 * follows the same permission as `invoice.updateStatus`: update:Invoice.
 * A read-only role (e.g. accountant) still gets the PDF; the draft simply
 * stays a draft.
 */
export async function shouldPromoteDraftOnPdf(params: {
  invoice: { status: string; type: string; documentType: string };
  userId: string;
  tenantId: string;
}): Promise<boolean> {
  const { invoice, userId, tenantId } = params;
  // Only outgoing sale invoices still in draft; purchase bills, credit notes /
  // returns and already-progressed statuses are never promoted.
  if (invoice.status !== "draft" || invoice.type !== "sale" || invoice.documentType !== "invoice") {
    return false;
  }

  const [membership] = await controlDb
    .select({ role: tenantMembers.role })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
    .limit(1);
  if (!membership) return false;

  return defineAbilityFor({ userId, role: mapDbRole(membership.role) }).can("update", "Invoice");
}
