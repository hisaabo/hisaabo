/**
 * The envelope every job's pg-boss `data` holds (docs/architecture/queue.md
 * §5.1). It is validated when dispatched and parsed again by the worker
 * before the handler runs, so a malformed row fails instead of executing.
 */
import { z } from "zod";

const uuid = z.string().uuid();

export const envelopeSchema = z.object({
  v: z.literal(1),
  scope: z.enum(["tenant", "system"]),
  tenantId: uuid.optional(),
  businessId: uuid.optional(),
  actorUserId: uuid.optional(),
  requestId: z.string().max(128).optional(),
  tags: z.array(z.string().max(64)).max(20),
  payload: z.record(z.unknown()),
}).strict().superRefine((e, ctx) => {
  if (e.scope === "tenant" && !e.tenantId) {
    ctx.addIssue({ code: "custom", message: "tenant-scoped job without tenantId", path: ["tenantId"] });
  }
  if (e.scope === "system" && (e.tenantId || e.businessId || e.actorUserId)) {
    ctx.addIssue({ code: "custom", message: "system job must not carry tenant context", path: ["scope"] });
  }
});

export type Envelope = z.infer<typeof envelopeSchema>;

export function parseEnvelope(data: unknown): Envelope {
  return envelopeSchema.parse(data);
}
