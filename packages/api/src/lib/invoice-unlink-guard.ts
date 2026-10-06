import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { paymentAllocations } from "@hisaabo/db";
import { checkInvoiceUnlinkAllowed } from "@hisaabo/shared";
import type { TenantDatabase } from "../trpc.js";

type Tx = Pick<TenantDatabase, "select">;

// Must run inside the transaction that holds the invoice row lock, so a
// concurrent payment cannot slip in between the check and the delete/cancel.
export async function assertNoPaymentsOrActiveIrn(
  tx: Tx,
  action: "delete" | "cancel",
  doc: { id: string; amountPaid: string; irn: string | null; eInvoiceStatus: string | null },
): Promise<void> {
  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(paymentAllocations)
    .where(eq(paymentAllocations.invoiceId, doc.id));
  const message = checkInvoiceUnlinkAllowed(action, { ...doc, allocationCount: count });
  if (message) throw new TRPCError({ code: "BAD_REQUEST", message });
}
