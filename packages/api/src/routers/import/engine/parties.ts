import { parties } from "@hisaabo/db";
import { eq } from "drizzle-orm";
import type { TenantDatabase } from "../../../trpc.js";
import type { CanonicalParty } from "../types.js";

export async function runPartiesImport(
  db: TenantDatabase,
  businessId: string,
  _userId: string,
  source: string,
  canonicalParties: CanonicalParty[],
): Promise<{ created: number; skipped: number; total: number }> {
  let created = 0;
  let skipped = 0;

  // Pre-fetch all existing party names for this business into a Set for O(1) lookup
  const existingPartyNames = new Set(
    (await db.select({ name: parties.name })
      .from(parties).where(eq(parties.businessId, businessId)))
      .map(r => r.name.toLowerCase())
  );

  const newParties: (typeof parties.$inferInsert)[] = [];
  for (const p of canonicalParties) {
    if (existingPartyNames.has(p.name.toLowerCase())) {
      skipped++;
      continue;
    }
    newParties.push({
      businessId,
      name: p.name,
      type: p.type,
      phone: p.phone || null,
      email: p.email || null,
      gstin: p.gstin || null,
      pan: p.pan || null,
      openingBalance: p.openingBalance || "0",
      billingAddress: p.billingAddress || null,
      shippingAddress: p.shippingAddress || null,
      city: p.city || null,
      state: p.state || null,
      pincode: p.pincode || null,
      source,
    });
    // Track newly inserted name so duplicates in the same batch are caught
    existingPartyNames.add(p.name.toLowerCase());
    created++;
  }

  if (newParties.length > 0) {
    // Wrap all chunks in a single transaction so a mid-batch failure rolls
    // back all chunks rather than leaving partial data committed.
    await db.transaction(async (tx) => {
      for (let i = 0; i < newParties.length; i += 500) {
        await tx.insert(parties).values(newParties.slice(i, i + 500));
      }
    });
  }

  return { created, skipped, total: canonicalParties.length };
}
