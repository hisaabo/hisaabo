import { z } from "zod";

export const manifestSchema = z.object({
  format: z.literal("hisaabo-export"),
  formatVersion: z.literal(1),
  appVersion: z.string(),
  schemaChecksum: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  exportedAt: z.string().datetime(),
  sourceTenantId: z.string().uuid(),
  sourceTenantSlug: z.string(),
  businessIds: z.array(z.string().uuid()),
  rowCounts: z.record(z.string(), z.number().int().min(0)),
  files: z.record(
    z.string(),
    z.object({
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      rows: z.number().int().min(0),
      bytes: z.number().int().min(0),
    }),
  ),
  redacted: z.array(z.string()),
});

export type Manifest = z.infer<typeof manifestSchema>;
