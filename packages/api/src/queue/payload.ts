/**
 * Payload (de)serialisation: zod validation plus encryption of the fields a
 * job lists in `encrypt` (AES-256-GCM via @hisaabo/db encryptField).
 */
import { encryptField, decryptField } from "@hisaabo/db";
import type { JobDefinition } from "./define.js";
import { PermanentError } from "./errors.js";

/** Validate a payload for dispatch and encrypt its sensitive fields. */
export function sealPayload<P>(def: JobDefinition<P>, payload: P): Record<string, unknown> {
  const parsed = def.payload.parse(payload) as Record<string, unknown>;
  const sealed = { ...parsed };
  for (const field of def.encrypt) {
    const value = sealed[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") throw new Error(`Encrypted payload field "${field}" must be a string`);
    sealed[field] = encryptField(value);
  }
  return sealed;
}

/** Decrypt and re-validate a stored payload. Any failure is permanent. */
export function openPayload<P>(def: JobDefinition<P>, stored: Record<string, unknown>): P {
  const opened = { ...stored };
  for (const field of def.encrypt) {
    const value = opened[field];
    if (typeof value !== "string") continue;
    try {
      opened[field] = decryptField(value);
    } catch {
      throw new PermanentError(`Cannot decrypt payload field "${field}"`);
    }
  }
  const result = def.payload.safeParse(opened);
  if (!result.success) throw new PermanentError(`Invalid payload for ${def.name}`);
  return result.data;
}
