import { z } from "zod";
import { parties, items, invoices, invoiceItems, payments, businesses } from "@hisaabo/db";
import { eq, and, sql } from "drizzle-orm";
import { router, adminProcedure } from "../trpc.js";
import { calcLineItem } from "@hisaabo/shared";

export const importRouter = router({
  // ── Import parties in batch ─────────────────────────────────────────────
  importParties: adminProcedure
    .input(z.object({
      source: z.string().default("mybillbook"),
      parties: z.array(z.object({
        name: z.string().min(1),
        type: z.enum(["customer", "supplier"]).default("customer"),
        phone: z.string().optional(),
        email: z.string().optional(),
        gstin: z.string().optional(),
        pan: z.string().optional(),
        openingBalance: z.string().default("0"),
        billingAddress: z.string().optional(),
        shippingAddress: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        pincode: z.string().optional(),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      let created = 0;
      let skipped = 0;

      for (const p of input.parties) {
        // Check if party with same name already exists (case-insensitive)
        const [existing] = await ctx.db
          .select({ id: parties.id })
          .from(parties)
          .where(
            and(
              eq(parties.businessId, ctx.businessId),
              sql`LOWER(${parties.name}) = LOWER(${p.name})`
            )
          )
          .limit(1);

        if (existing) {
          skipped++;
          continue;
        }

        await ctx.db.insert(parties).values({
          businessId: ctx.businessId,
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
          source: input.source,
        });
        created++;
      }

      return { created, skipped, total: input.parties.length };
    }),

  // ── Import items in batch ───────────────────────────────────────────────
  importItems: adminProcedure
    .input(z.object({
      source: z.string().default("mybillbook"),
      items: z.array(z.object({
        name: z.string().min(1),
        itemType: z.enum(["product", "service"]).default("product"),
        salePrice: z.string().optional(),
        purchasePrice: z.string().optional(),
        taxPercent: z.string().default("0"),
        hsn: z.string().optional(),
        unit: z.string().default("pcs"),
        stockQuantity: z.string().default("0"),
        sku: z.string().optional(),
        category: z.string().optional(),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      let created = 0;
      let skipped = 0;

      for (const item of input.items) {
        // Check if item with same name already exists (case-insensitive)
        const [existing] = await ctx.db
          .select({ id: items.id })
          .from(items)
          .where(
            and(
              eq(items.businessId, ctx.businessId),
              sql`LOWER(${items.name}) = LOWER(${item.name})`
            )
          )
          .limit(1);

        if (existing) {
          skipped++;
          continue;
        }

        // Validate unit against enum — fall back to "other" for unknown values
        const validUnits = ["pcs", "kg", "g", "l", "ml", "m", "cm", "ft", "in", "box", "dozen", "pair", "set", "other"] as const;
        type ValidUnit = (typeof validUnits)[number];
        const unit: ValidUnit = (validUnits as readonly string[]).includes(item.unit)
          ? (item.unit as ValidUnit)
          : "other";

        await ctx.db.insert(items).values({
          businessId: ctx.businessId,
          name: item.name,
          itemType: item.itemType,
          salePrice: item.salePrice || null,
          purchasePrice: item.purchasePrice || null,
          taxPercent: item.taxPercent || "0",
          hsn: item.hsn || null,
          unit,
          stockQuantity: item.stockQuantity || "0",
          sku: item.sku || null,
          category: item.category || null,
          source: input.source,
        });
        created++;
      }

      return { created, skipped, total: input.items.length };
    }),

  // ── Import invoices in batch (with optional line items) ─────────────────
  importInvoices: adminProcedure
    .input(z.object({
      source: z.string().default("mybillbook"),
      autoCreatePayments: z.boolean().default(false),
      defaultPaymentMode: z.enum(["cash", "bank", "upi", "cheque", "other"]).default("cash"),
      invoices: z.array(z.object({
        invoiceNumber: z.string().min(1),
        invoiceDate: z.string(),
        dueDate: z.string().optional(),
        partyName: z.string().min(1),
        type: z.enum(["sale", "purchase"]).default("sale"),
        status: z.enum(["draft", "sent", "paid", "partial", "overdue", "cancelled"]).default("sent"),
        subtotal: z.string().default("0"),
        taxAmount: z.string().default("0"),
        discountAmount: z.string().default("0"),
        totalAmount: z.string(),
        amountPaid: z.string().default("0"),
        charges: z.array(z.object({ label: z.string(), amount: z.string() })).optional(),
        paymentMode: z.string().optional(),
        notes: z.string().optional(),
        createdByName: z.string().optional(),
        lineItems: z.array(z.object({
          itemName: z.string().optional(),
          description: z.string(),
          quantity: z.string().default("1"),
          unitPrice: z.string(),
          taxPercent: z.string().default("0"),
          discountPercent: z.string().default("0"),
        })).optional(),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      let created = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const inv of input.invoices) {
        // Find party by name (case-insensitive)
        const [party] = await ctx.db
          .select({ id: parties.id })
          .from(parties)
          .where(
            and(
              eq(parties.businessId, ctx.businessId),
              sql`LOWER(${parties.name}) = LOWER(${inv.partyName})`
            )
          )
          .limit(1);

        if (!party) {
          errors.push(`Party "${inv.partyName}" not found for invoice ${inv.invoiceNumber}`);
          skipped++;
          continue;
        }

        // Check if invoice number already exists for this business
        const [existing] = await ctx.db
          .select({ id: invoices.id })
          .from(invoices)
          .where(
            and(
              eq(invoices.businessId, ctx.businessId),
              eq(invoices.invoiceNumber, inv.invoiceNumber)
            )
          )
          .limit(1);

        if (existing) {
          skipped++;
          continue;
        }

        // Parse dates — handles Indian and ISO formats
        const invoiceDate = parseFlexibleDate(inv.invoiceDate);
        const dueDate = inv.dueDate ? parseFlexibleDate(inv.dueDate) : null;

        if (!invoiceDate) {
          errors.push(`Invalid date "${inv.invoiceDate}" for invoice ${inv.invoiceNumber}`);
          skipped++;
          continue;
        }

        await ctx.db.transaction(async (tx) => {
          const [createdInv] = await tx
            .insert(invoices)
            .values({
              businessId: ctx.businessId,
              partyId: party.id,
              type: inv.type,
              documentType: "invoice",
              invoiceNumber: inv.invoiceNumber,
              invoiceDate,
              dueDate,
              status: inv.status,
              subtotal: inv.subtotal,
              taxAmount: inv.taxAmount,
              discountAmount: inv.discountAmount,
              charges: inv.charges?.length ? inv.charges : null,
              additionalCharges: inv.charges?.length
                ? inv.charges.reduce((s, c) => s + parseFloat(c.amount), 0).toFixed(2)
                : "0",
              roundOff: "0",
              totalAmount: inv.totalAmount,
              amountPaid: inv.amountPaid,
              notes: inv.notes || null,
              createdByUserId: ctx.user!.id,
              createdByName: inv.createdByName || ctx.user!.name,
              source: input.source,
            })
            .returning();

          if (inv.lineItems?.length) {
            for (let idx = 0; idx < inv.lineItems.length; idx++) {
              const li = inv.lineItems[idx];

              // Try to resolve item by name
              let itemId: string | null = null;
              if (li.itemName) {
                const [foundItem] = await tx
                  .select({ id: items.id })
                  .from(items)
                  .where(
                    and(
                      eq(items.businessId, ctx.businessId),
                      sql`LOWER(${items.name}) = LOWER(${li.itemName})`
                    )
                  )
                  .limit(1);
                if (foundItem) itemId = foundItem.id;
              }

              const calc = calcLineItem({
                quantity: li.quantity || "1",
                unitPrice: li.unitPrice || "0",
                taxPercent: li.taxPercent || "0",
                discountPercent: li.discountPercent || "0",
              });

              await tx.insert(invoiceItems).values({
                invoiceId: createdInv.id,
                itemId,
                description: li.description || li.itemName || "Imported item",
                quantity: li.quantity,
                unitPrice: li.unitPrice,
                taxPercent: li.taxPercent || "0",
                taxAmount: calc.taxAmount,
                discountPercent: li.discountPercent || "0",
                totalAmount: calc.total,
                sortOrder: idx,
              });
            }
          } else {
            // No line items — create a single catch-all line item
            await tx.insert(invoiceItems).values({
              invoiceId: createdInv.id,
              itemId: null,
              description: `Imported: ${inv.invoiceNumber}`,
              quantity: "1",
              unitPrice: inv.totalAmount,
              taxPercent: "0",
              taxAmount: "0",
              discountPercent: "0",
              totalAmount: inv.totalAmount,
              sortOrder: 0,
            });
          }

          // Adjust stock for line items that have an itemId
          if (inv.lineItems?.length) {
            for (const li of inv.lineItems) {
              if (!li.itemName) continue;
              const [foundItem] = await tx
                .select({ id: items.id })
                .from(items)
                .where(
                  and(
                    eq(items.businessId, ctx.businessId),
                    sql`LOWER(${items.name}) = LOWER(${li.itemName})`
                  )
                )
                .limit(1);
              if (!foundItem) continue;

              const qty = parseFloat(li.quantity || "1");
              const baseQty = qty.toFixed(3);

              if (inv.type === "sale") {
                await tx.update(items).set({
                  stockQuantity: sql`${items.stockQuantity}::numeric - ${baseQty}::numeric`,
                  updatedAt: new Date(),
                }).where(eq(items.id, foundItem.id));
              } else if (inv.type === "purchase") {
                await tx.update(items).set({
                  stockQuantity: sql`${items.stockQuantity}::numeric + ${baseQty}::numeric`,
                  updatedAt: new Date(),
                }).where(eq(items.id, foundItem.id));
              }
            }
          }

          // Auto-create payment record when requested and amountPaid > 0
          if (input.autoCreatePayments && parseFloat(inv.amountPaid) > 0) {
            const mode = normalizeMode(inv.paymentMode || input.defaultPaymentMode);
            await tx.insert(payments).values({
              businessId: ctx.businessId,
              partyId: party.id,
              invoiceId: createdInv.id,
              paymentNumber: `IMP-${inv.invoiceNumber}`,
              amount: inv.amountPaid,
              discount: "0",
              mode,
              paymentDate: invoiceDate,
              notes: `Imported payment for ${inv.invoiceNumber}`,
              createdByUserId: ctx.user!.id,
              createdByName: inv.createdByName || ctx.user!.name,
              source: input.source,
            });
          }
        });

        created++;
      }

      return { created, skipped, total: input.invoices.length, errors };
    }),

  // ── Import payments in batch — exact invoice linkage (CSV) or chronological (PDF) ─
  importPayments: adminProcedure
    .input(z.object({
      source: z.string().default("mybillbook"),
      payments: z.array(z.object({
        paymentNumber: z.string().optional(),
        paymentDate: z.string(),
        partyName: z.string().min(1),
        amount: z.string(),
        mode: z.enum(["cash", "bank", "upi", "cheque", "other"]).default("cash"),
        referenceNumber: z.string().optional(),
        notes: z.string().optional(),
        invoiceNumbers: z.array(z.string()).optional(), // explicit invoice linkage from CSV
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      let created = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const pmt of input.payments) {
        // Find party by name (case-insensitive)
        const [party] = await ctx.db
          .select({ id: parties.id })
          .from(parties)
          .where(
            and(
              eq(parties.businessId, ctx.businessId),
              sql`LOWER(${parties.name}) = LOWER(${pmt.partyName})`
            )
          )
          .limit(1);

        if (!party) {
          errors.push(`Party "${pmt.partyName}" not found for payment`);
          skipped++;
          continue;
        }

        const paymentDate = parseFlexibleDate(pmt.paymentDate);
        if (!paymentDate) {
          errors.push(`Invalid date "${pmt.paymentDate}" for payment`);
          skipped++;
          continue;
        }

        await ctx.db.transaction(async (tx) => {
          // Atomically get and increment payment number counter
          const [biz] = await tx
            .select({
              prefix: businesses.paymentPrefix,
              nextNum: businesses.nextPaymentNumber,
            })
            .from(businesses)
            .where(eq(businesses.id, ctx.businessId))
            .for("update");

          const paymentNumber =
            pmt.paymentNumber ||
            `${biz.prefix}-${String(biz.nextNum).padStart(5, "0")}`;

          await tx
            .update(businesses)
            .set({ nextPaymentNumber: biz.nextNum + 1 })
            .where(eq(businesses.id, ctx.businessId));

          let remaining = parseFloat(pmt.amount);
          let primaryInvoiceId: string | null = null;

          if (pmt.invoiceNumbers?.length) {
            // CSV path: explicit invoice linkage — allocate to named invoices directly
            for (const invNum of pmt.invoiceNumbers) {
              if (remaining <= 0) break;

              const [inv] = await tx
                .select({
                  id: invoices.id,
                  totalAmount: invoices.totalAmount,
                  amountPaid: invoices.amountPaid,
                })
                .from(invoices)
                .where(
                  and(
                    eq(invoices.businessId, ctx.businessId),
                    eq(invoices.invoiceNumber, invNum),
                  )
                )
                .limit(1);

              if (!inv) continue;
              if (!primaryInvoiceId) primaryInvoiceId = inv.id;

              const balance = parseFloat(inv.totalAmount) - parseFloat(inv.amountPaid);
              const allocAmt = Math.min(remaining, Math.max(0, balance));
              if (allocAmt <= 0) continue;

              await tx
                .update(invoices)
                .set({
                  amountPaid: sql`${invoices.amountPaid}::numeric + ${allocAmt.toFixed(2)}::numeric`,
                  updatedAt: new Date(),
                })
                .where(eq(invoices.id, inv.id));

              const newPaid = parseFloat(inv.amountPaid) + allocAmt;
              const total = parseFloat(inv.totalAmount);
              const newStatus: "paid" | "partial" = newPaid >= total ? "paid" : "partial";
              await tx
                .update(invoices)
                .set({ status: newStatus })
                .where(eq(invoices.id, inv.id));

              remaining -= allocAmt;
            }
          } else {
            // PDF / fallback path: allocate chronologically across all unpaid invoices for this party
            const unpaidInvs = await tx
              .select({
                id: invoices.id,
                totalAmount: invoices.totalAmount,
                amountPaid: invoices.amountPaid,
              })
              .from(invoices)
              .where(
                and(
                  eq(invoices.businessId, ctx.businessId),
                  eq(invoices.partyId, party.id),
                  eq(invoices.documentType, "invoice"),
                  sql`${invoices.status} NOT IN ('paid', 'cancelled')`
                )
              )
              .orderBy(invoices.invoiceDate);

            for (const inv of unpaidInvs) {
              if (remaining <= 0) break;
              const balance =
                parseFloat(inv.totalAmount) - parseFloat(inv.amountPaid);
              if (balance <= 0) continue;

              const allocAmt = Math.min(remaining, balance);
              if (!primaryInvoiceId) primaryInvoiceId = inv.id;

              await tx
                .update(invoices)
                .set({
                  amountPaid: sql`${invoices.amountPaid}::numeric + ${allocAmt.toFixed(2)}::numeric`,
                  updatedAt: new Date(),
                })
                .where(eq(invoices.id, inv.id));

              const newPaid = parseFloat(inv.amountPaid) + allocAmt;
              const total = parseFloat(inv.totalAmount);
              const newStatus: "paid" | "partial" =
                newPaid >= total ? "paid" : "partial";
              await tx
                .update(invoices)
                .set({ status: newStatus })
                .where(eq(invoices.id, inv.id));

              remaining -= allocAmt;
            }
          }

          await tx.insert(payments).values({
            businessId: ctx.businessId,
            partyId: party.id,
            invoiceId: primaryInvoiceId,
            paymentNumber,
            amount: pmt.amount,
            discount: "0",
            mode: pmt.mode,
            referenceNumber: pmt.referenceNumber || null,
            paymentDate,
            notes: pmt.notes || null,
            createdByUserId: ctx.user!.id,
            createdByName: ctx.user!.name,
            source: input.source,
          });
        });

        created++;
      }

      return { created, skipped, total: input.payments.length, errors };
    }),
});

// ── Payment mode normaliser ──────────────────────────────────────────────────
function normalizeMode(raw: string): "cash" | "bank" | "upi" | "cheque" | "other" {
  const s = (raw || "").toLowerCase().trim();
  if (s === "cash") return "cash";
  if (s === "credit" || s === "bank" || s.includes("bank transfer") || s === "neft" || s === "rtgs" || s === "imps") return "bank";
  if (s === "upi" || s.includes("gpay") || s.includes("phonepe") || s.includes("paytm")) return "upi";
  if (s === "cheque" || s === "check") return "cheque";
  return "other";
}

// ── Date parsing helper ──────────────────────────────────────────────────────
// Handles: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, MM/DD/YYYY, "22 Mar 2026", ISO strings
function parseFlexibleDate(str: string): Date | null {
  if (!str || !str.trim()) return null;
  const s = str.trim();

  // ISO format: YYYY-MM-DD or full datetime
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const iso = new Date(s);
    if (!isNaN(iso.getTime())) return iso;
  }

  // DD/MM/YYYY or DD-MM-YYYY (Indian format — most common in myBillBook exports)
  const ddmmyyyy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    const d = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
    if (!isNaN(d.getTime())) return d;
  }

  // "22 Mar 2026" or "22-Mar-2026"
  const dMonY = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,})[\s-](\d{4})$/);
  if (dMonY) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
  }

  // Last resort — let JS try to parse it
  const fallback = new Date(s);
  if (!isNaN(fallback.getTime())) return fallback;

  return null;
}
