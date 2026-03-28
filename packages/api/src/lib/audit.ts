import { auditLog } from "@hisaabo/db";
import type { TenantDatabase } from "../trpc.js";

export async function logAudit(
  db: TenantDatabase,
  params: {
    businessId: string;
    userId: string;
    action: string;       // e.g., "invoice.create", "payment.delete"
    entityType: string;   // e.g., "invoice", "payment"
    entityId?: string | null;
    metadata?: Record<string, unknown>;
    ipAddress?: string | null;
  }
) {
  try {
    await db.insert(auditLog).values({
      businessId: params.businessId,
      userId: params.userId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId || null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      ipAddress: params.ipAddress || null,
    });
  } catch (err) {
    // Never let audit logging break the main operation
    console.error("[audit] Failed to write audit log:", err);
  }
}
