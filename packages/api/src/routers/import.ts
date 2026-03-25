import { z } from "zod";
import { parties, items, invoices, invoiceItems, payments, paymentAllocations, businesses, bankAccounts, bankTransactions } from "@hisaabo/db";
import { eq, and, sql } from "drizzle-orm";
import { router, adminProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { calcLineItem, money } from "@hisaabo/shared";

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
      requireCan(ctx.ability, "manage", "Import");
      let created = 0;
      let skipped = 0;

      // Pre-fetch all existing party names for this business into a Set for O(1) lookup
      const existingPartyNames = new Set(
        (await ctx.db.select({ name: parties.name })
          .from(parties).where(eq(parties.businessId, ctx.businessId)))
          .map(r => r.name.toLowerCase())
      );

      const newParties = [];
      for (const p of input.parties) {
        // Check if party with same name already exists (case-insensitive)
        if (existingPartyNames.has(p.name.toLowerCase())) {
          skipped++;
          continue;
        }
        newParties.push({
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
        // Track the newly inserted name so subsequent duplicates in the same batch are caught
        existingPartyNames.add(p.name.toLowerCase());
        created++;
      }

      if (newParties.length > 0) {
        // Batch insert in chunks of 500 (PostgreSQL has a parameter limit)
        for (let i = 0; i < newParties.length; i += 500) {
          await ctx.db.insert(parties).values(newParties.slice(i, i + 500));
        }
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
      requireCan(ctx.ability, "manage", "Import");
      let created = 0;
      let skipped = 0;

      // Pre-fetch all existing item names for this business into a Set for O(1) lookup
      const existingItemNames = new Set(
        (await ctx.db.select({ name: items.name })
          .from(items).where(eq(items.businessId, ctx.businessId)))
          .map(r => r.name.toLowerCase())
      );

      const validUnits = ["pcs", "kg", "g", "l", "ml", "m", "cm", "ft", "in", "box", "dozen", "pair", "set", "other"] as const;
      type ValidUnit = (typeof validUnits)[number];

      const newItems = [];
      for (const item of input.items) {
        // Check if item with same name already exists (case-insensitive)
        if (existingItemNames.has(item.name.toLowerCase())) {
          skipped++;
          continue;
        }

        // Validate unit against enum — fall back to "other" for unknown values
        const unit: ValidUnit = (validUnits as readonly string[]).includes(item.unit)
          ? (item.unit as ValidUnit)
          : "other";

        newItems.push({
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
        // Track the newly inserted name so subsequent duplicates in the same batch are caught
        existingItemNames.add(item.name.toLowerCase());
        created++;
      }

      if (newItems.length > 0) {
        // Batch insert in chunks of 500 (PostgreSQL has a parameter limit)
        for (let i = 0; i < newItems.length; i += 500) {
          await ctx.db.insert(items).values(newItems.slice(i, i + 500));
        }
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
      requireCan(ctx.ability, "manage", "Import");
      let created = 0;
      let skipped = 0;
      const errors: string[] = [];

      // Pre-fetch reference data
      const allParties = await ctx.db.select({ id: parties.id, name: parties.name })
        .from(parties).where(eq(parties.businessId, ctx.businessId));
      const partyByName = new Map(allParties.map(p => [p.name.toLowerCase(), p.id]));

      const allItems = await ctx.db.select({ id: items.id, name: items.name })
        .from(items).where(eq(items.businessId, ctx.businessId));
      const itemByName = new Map(allItems.map(i => [i.name.toLowerCase(), i.id]));

      const existingNumbers = new Set(
        (await ctx.db.select({ n: invoices.invoiceNumber })
          .from(invoices).where(eq(invoices.businessId, ctx.businessId)))
          .map(r => r.n)
      );

      // ── Phase 1: Pre-validate and prepare all rows in memory ──
      const validInvoices: Array<{
        invoiceId: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        invoiceRow: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lineItemRows: any[];
        stockDeltas: Map<string, number>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        autoPaymentRow: any | null;
      }> = [];

      for (const inv of input.invoices) {
        const partyId = partyByName.get(inv.partyName.toLowerCase());
        if (!partyId) {
          errors.push(`Party "${inv.partyName}" not found for invoice ${inv.invoiceNumber}`);
          skipped++;
          continue;
        }

        if (existingNumbers.has(inv.invoiceNumber)) {
          skipped++;
          continue;
        }

        const invoiceDate = parseFlexibleDate(inv.invoiceDate);
        const dueDate = inv.dueDate ? parseFlexibleDate(inv.dueDate) : null;
        if (!invoiceDate) {
          errors.push(`Invalid date "${inv.invoiceDate}" for invoice ${inv.invoiceNumber}`);
          skipped++;
          continue;
        }

        const invoiceId = crypto.randomUUID();

        const invoiceRow = {
          id: invoiceId,
          businessId: ctx.businessId,
          partyId,
          type: inv.type,
          documentType: "invoice" as const,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate,
          dueDate,
          // Status starts as "sent" — payment allocation will update to paid/partial
          status: "sent" as const,
          subtotal: inv.subtotal,
          taxAmount: inv.taxAmount,
          discountAmount: inv.discountAmount,
          charges: inv.charges?.length ? inv.charges : null,
          additionalCharges: inv.charges?.length
            ? inv.charges.reduce((s, c) => s + money.toNumber(c.amount), 0).toFixed(2)
            : "0",
          roundOff: "0",
          totalAmount: inv.totalAmount,
          // amountPaid starts at 0 — built up by payment import allocation
          amountPaid: "0",
          notes: inv.notes || null,
          createdByUserId: ctx.user!.id,
          createdByName: inv.createdByName || ctx.user!.name,
          source: input.source,
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lineItemRows: any[] = [];
        const stockDeltas = new Map<string, number>();

        if (inv.lineItems?.length) {
          for (let idx = 0; idx < inv.lineItems.length; idx++) {
            const li = inv.lineItems[idx];
            const itemId = li.itemName ? (itemByName.get(li.itemName.toLowerCase()) ?? null) : null;

            const calc = calcLineItem({
              quantity: li.quantity || "1",
              unitPrice: li.unitPrice || "0",
              taxPercent: li.taxPercent || "0",
              discountPercent: li.discountPercent || "0",
            });

            lineItemRows.push({
              invoiceId,
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

            if (itemId) {
              const qty = money.toNumber(li.quantity || "1");
              stockDeltas.set(itemId, (stockDeltas.get(itemId) || 0) + qty);
            }
          }
        } else {
          lineItemRows.push({
            invoiceId,
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

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let autoPaymentRow: any | null = null;
        if (input.autoCreatePayments && money.isPositive(inv.amountPaid)) {
          const mode = normalizeMode(inv.paymentMode || input.defaultPaymentMode);
          autoPaymentRow = {
            businessId: ctx.businessId,
            partyId,
            invoiceId,
            paymentNumber: `IMP-${inv.invoiceNumber}`,
            amount: inv.amountPaid,
            discount: "0",
            mode,
            paymentDate: invoiceDate,
            notes: `Imported payment for ${inv.invoiceNumber}`,
            createdByUserId: ctx.user!.id,
            createdByName: inv.createdByName || ctx.user!.name,
            source: input.source,
          };
        }

        validInvoices.push({ invoiceId, invoiceRow, lineItemRows, stockDeltas, autoPaymentRow });
        existingNumbers.add(inv.invoiceNumber);
        created++;
      }

      // ── Phase 2: Batch insert in chunks of 100 ──
      const BATCH = 100;
      for (let i = 0; i < validInvoices.length; i += BATCH) {
        const batch = validInvoices.slice(i, i + BATCH);

        await ctx.db.transaction(async (tx) => {
          // Bulk insert invoices
          await tx.insert(invoices).values(batch.map(b => b.invoiceRow));

          // Bulk insert all line items for this batch
          const allLineItems = batch.flatMap(b => b.lineItemRows);
          if (allLineItems.length > 0) {
            for (let j = 0; j < allLineItems.length; j += 500) {
              await tx.insert(invoiceItems).values(allLineItems.slice(j, j + 500));
            }
          }

          // Aggregate stock deltas by direction
          const saleDeltas = new Map<string, number>();
          const purchaseDeltas = new Map<string, number>();
          for (const b of batch) {
            for (const [itemId, qty] of b.stockDeltas) {
              if (b.invoiceRow.type === "sale") {
                saleDeltas.set(itemId, (saleDeltas.get(itemId) || 0) + qty);
              } else {
                purchaseDeltas.set(itemId, (purchaseDeltas.get(itemId) || 0) + qty);
              }
            }
          }

          // Apply sale stock adjustments (subtract)
          for (const [itemId, totalQty] of saleDeltas) {
            await tx.update(items).set({
              stockQuantity: sql`${items.stockQuantity}::numeric - ${totalQty.toFixed(3)}::numeric`,
              updatedAt: new Date(),
            }).where(eq(items.id, itemId));
          }

          // Apply purchase stock adjustments (add)
          for (const [itemId, totalQty] of purchaseDeltas) {
            await tx.update(items).set({
              stockQuantity: sql`${items.stockQuantity}::numeric + ${totalQty.toFixed(3)}::numeric`,
              updatedAt: new Date(),
            }).where(eq(items.id, itemId));
          }

          // Bulk insert auto-payment records if any
          const autoPayments = batch.map(b => b.autoPaymentRow).filter(Boolean);
          if (autoPayments.length > 0) {
            await tx.insert(payments).values(autoPayments);
          }
        });
      }

      return { created, skipped, total: input.invoices.length, errors };
    }),

  // ── Import payments in batch — exact invoice linkage (CSV) or chronological (PDF) ─
  importPayments: adminProcedure
    .input(z.object({
      source: z.string().default("mybillbook"),
      // Invoice numbers that were marked "Paid" in the source system.
      // After C&B allocation, any of these still without full payment get auto-payments.
      paidInvoiceNumbers: z.array(z.string()).default([]),
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
      requireCan(ctx.ability, "manage", "Import");
      let created = 0;
      let skipped = 0;
      const errors: string[] = [];

      // Pre-fetch parties
      const allPartiesForPayments = await ctx.db
        .select({ id: parties.id, name: parties.name })
        .from(parties).where(eq(parties.businessId, ctx.businessId));
      const partyByName = new Map(
        allPartiesForPayments.map(p => [p.name.toLowerCase(), p.id])
      );

      // Pre-fetch all invoices with their current balances
      const allInvs = await ctx.db
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          totalAmount: invoices.totalAmount,
          amountPaid: invoices.amountPaid,
          partyId: invoices.partyId,
          status: invoices.status,
          documentType: invoices.documentType,
          invoiceDate: invoices.invoiceDate,
        })
        .from(invoices).where(eq(invoices.businessId, ctx.businessId));

      const invoiceByNumber = new Map(allInvs.map(inv => [inv.invoiceNumber, inv]));

      // Build per-party unpaid invoice list for chronological allocation
      const unpaidByParty = new Map<string, typeof allInvs>();
      for (const inv of allInvs) {
        if (inv.documentType !== "invoice") continue;
        if (inv.status === "paid" || inv.status === "cancelled") continue;
        const list = unpaidByParty.get(inv.partyId) || [];
        list.push(inv);
        unpaidByParty.set(inv.partyId, list);
      }
      // Sort each party's invoices by date for chronological allocation
      for (const list of unpaidByParty.values()) {
        list.sort((a, b) => new Date(a.invoiceDate).getTime() - new Date(b.invoiceDate).getTime());
      }

      // In-memory balance tracker — starts from DB state, updated as we allocate
      const balanceTracker = new Map<string, number>();
      for (const inv of allInvs) {
        balanceTracker.set(inv.id, money.toNumber(inv.totalAmount) - money.toNumber(inv.amountPaid));
      }

      // ── Phase 1: Pre-validate and simulate allocations in memory ──
      type PaymentRow = {
        id: string;
        paymentNumber: string;
        partyId: string;
        primaryInvoiceId: string | null;
        amount: string;
        mode: "cash" | "bank" | "upi" | "cheque" | "other";
        referenceNumber: string | null;
        paymentDate: Date;
        notes: string | null;
      };

      type InvoiceAllocation = {
        paymentId: string;
        invoiceId: string;
        allocAmount: number;
      };

      const validPayments: PaymentRow[] = [];
      const allAllocations: InvoiceAllocation[] = [];
      let autoNumberCount = 0;

      for (const pmt of input.payments) {
        const partyId = partyByName.get(pmt.partyName.toLowerCase());
        if (!partyId) {
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

        const paymentId = crypto.randomUUID();
        let primaryInvoiceId: string | null = null;
        let remaining = money.toNumber(pmt.amount);

        if (pmt.invoiceNumbers?.length) {
          // CSV path: allocate to the EXPLICITLY named invoices first
          for (const invNum of pmt.invoiceNumbers) {
            if (remaining <= 0) break;
            const inv = invoiceByNumber.get(invNum);
            if (!inv) continue;
            if (!primaryInvoiceId) primaryInvoiceId = inv.id;

            const balance = balanceTracker.get(inv.id) || 0;
            if (balance <= 0) continue;

            const allocAmt = Math.min(remaining, balance);
            allAllocations.push({ paymentId, invoiceId: inv.id, allocAmount: allocAmt });
            balanceTracker.set(inv.id, balance - allocAmt);
            remaining -= allocAmt;
          }
        }

        // If there's remaining amount (or no invoice numbers), allocate chronologically
        if (remaining > 0) {
          const partyInvs = unpaidByParty.get(partyId) || [];
          for (const inv of partyInvs) {
            if (remaining <= 0) break;
            const balance = balanceTracker.get(inv.id) || 0;
            if (balance <= 0) continue;

            const allocAmt = Math.min(remaining, balance);
            if (!primaryInvoiceId) primaryInvoiceId = inv.id;
            allAllocations.push({ paymentId, invoiceId: inv.id, allocAmount: allocAmt });
            balanceTracker.set(inv.id, balance - allocAmt);
            remaining -= allocAmt;
          }
        }

        const needsAutoNumber = !pmt.paymentNumber;
        if (needsAutoNumber) autoNumberCount++;

        validPayments.push({
          id: paymentId,
          paymentNumber: pmt.paymentNumber || "", // placeholder, assigned in batch
          partyId,
          primaryInvoiceId,
          amount: pmt.amount,
          mode: pmt.mode,
          referenceNumber: pmt.referenceNumber || null,
          paymentDate,
          notes: pmt.notes || null,
        });

        created++;
      }

      // ── Phase 2: Batch insert in one transaction ──
      if (validPayments.length > 0) {
        await ctx.db.transaction(async (tx) => {
          // Get counter for auto-numbered payments
          if (autoNumberCount > 0) {
            const [biz] = await tx
              .select({ prefix: businesses.paymentPrefix, nextNum: businesses.nextPaymentNumber })
              .from(businesses)
              .where(eq(businesses.id, ctx.businessId))
              .for("update");

            let counter = biz.nextNum;
            for (const p of validPayments) {
              if (!p.paymentNumber) {
                p.paymentNumber = `${biz.prefix}-${String(counter).padStart(5, "0")}`;
                counter++;
              }
            }

            await tx.update(businesses)
              .set({ nextPaymentNumber: counter })
              .where(eq(businesses.id, ctx.businessId));
          }

          // Bulk insert all payments in chunks of 500
          for (let i = 0; i < validPayments.length; i += 500) {
            const chunk = validPayments.slice(i, i + 500);
            await tx.insert(payments).values(chunk.map(p => ({
              id: p.id,
              businessId: ctx.businessId,
              partyId: p.partyId,
              invoiceId: p.primaryInvoiceId,
              paymentNumber: p.paymentNumber,
              amount: p.amount,
              discount: "0",
              mode: p.mode,
              referenceNumber: p.referenceNumber,
              paymentDate: p.paymentDate,
              notes: p.notes,
              createdByUserId: ctx.user!.id,
              createdByName: ctx.user!.name,
              source: input.source,
            })));
          }

          // Group allocations by invoiceId and sum
          const invoiceUpdates = new Map<string, number>();
          for (const alloc of allAllocations) {
            invoiceUpdates.set(alloc.invoiceId, (invoiceUpdates.get(alloc.invoiceId) || 0) + alloc.allocAmount);
          }

          // Apply one UPDATE per affected invoice
          for (const [invoiceId, totalAlloc] of invoiceUpdates) {
            await tx.execute(sql`
              UPDATE invoices SET
                amount_paid = amount_paid::numeric + ${totalAlloc.toFixed(2)}::numeric,
                status = CASE
                  WHEN (amount_paid::numeric + ${totalAlloc.toFixed(2)}::numeric) >= total_amount::numeric THEN 'paid'
                  WHEN (amount_paid::numeric + ${totalAlloc.toFixed(2)}::numeric) > 0 THEN 'partial'
                  ELSE status
                END,
                updated_at = NOW()
              WHERE id = ${invoiceId} AND business_id = ${ctx.businessId}
            `);
          }

          // Bulk insert payment allocation records
          if (allAllocations.length > 0) {
            const allocRows = allAllocations.map(a => ({
              paymentId: a.paymentId,
              invoiceId: a.invoiceId,
              amount: a.allocAmount.toFixed(2),
            }));
            for (let i = 0; i < allocRows.length; i += 500) {
              await tx.insert(paymentAllocations).values(allocRows.slice(i, i + 500));
            }
          }
        });
      }

      // ── Phase 3: Auto-create payments for direct-paid invoices ──
      // Invoices marked "Paid" in the source but not fully covered by C&B allocation.
      let directCreated = 0;

      if (input.paidInvoiceNumbers.length > 0) {
        const paidSet = new Set(input.paidInvoiceNumbers);

        // Re-fetch these invoices to get current amountPaid after C&B allocation
        const freshInvs = await ctx.db
          .select({
            id: invoices.id,
            invoiceNumber: invoices.invoiceNumber,
            partyId: invoices.partyId,
            totalAmount: invoices.totalAmount,
            amountPaid: invoices.amountPaid,
            invoiceDate: invoices.invoiceDate,
          })
          .from(invoices)
          .where(and(eq(invoices.businessId, ctx.businessId), eq(invoices.source, input.source)));

        // Filter to only "Paid" invoices with a shortfall, sorted REVERSE chronologically
        // (newest first — direct-paid invoices are more likely to be recent)
        const needsPayment = freshInvs
          .filter((inv) => {
            if (!paidSet.has(inv.invoiceNumber)) return false;
            const shortfall = money.toNumber(inv.totalAmount) - money.toNumber(inv.amountPaid);
            return shortfall > 0.01;
          })
          .sort((a, b) => new Date(b.invoiceDate).getTime() - new Date(a.invoiceDate).getTime());

        if (needsPayment.length > 0) {
          const [biz2] = await ctx.db
            .select({ prefix: businesses.paymentPrefix, nextNum: businesses.nextPaymentNumber })
            .from(businesses)
            .where(eq(businesses.id, ctx.businessId))
            .for("update");

          let counter2 = biz2.nextNum;
          const directPaymentRows = needsPayment.map((inv) => {
            const shortfall = money.sub(inv.totalAmount, inv.amountPaid);
            const paymentNumber = `${biz2.prefix}-${String(counter2).padStart(5, "0")}`;
            counter2++;
            return {
              id: crypto.randomUUID(),
              businessId: ctx.businessId,
              partyId: inv.partyId,
              invoiceId: inv.id,
              paymentNumber,
              amount: shortfall,
              discount: "0",
              mode: "cash" as const,
              paymentDate: inv.invoiceDate,
              notes: `Auto-created for direct-paid invoice ${inv.invoiceNumber}`,
              createdByUserId: ctx.user!.id,
              createdByName: ctx.user!.name,
              source: input.source,
            };
          });

          await ctx.db.update(businesses)
            .set({ nextPaymentNumber: counter2 })
            .where(eq(businesses.id, ctx.businessId));

          for (let i = 0; i < directPaymentRows.length; i += 500) {
            await ctx.db.insert(payments).values(directPaymentRows.slice(i, i + 500));
          }

          // Update amountPaid + status on these invoices
          for (const dp of directPaymentRows) {
            await ctx.db.execute(sql`
              UPDATE invoices SET
                amount_paid = amount_paid::numeric + ${dp.amount}::numeric,
                status = CASE
                  WHEN (amount_paid::numeric + ${dp.amount}::numeric) >= total_amount::numeric THEN 'paid'
                  WHEN (amount_paid::numeric + ${dp.amount}::numeric) > 0 THEN 'partial'
                  ELSE status
                END,
                updated_at = NOW()
              WHERE id = ${dp.invoiceId} AND business_id = ${ctx.businessId}
            `);
          }

          directCreated = directPaymentRows.length;
        }
      }

      return { created: created + directCreated, skipped, total: input.payments.length, errors, directCreated };
    }),

  // ── Create payments for directly-paid invoices that lack a payment record ──
  reconcileDirectPayments: adminProcedure
    .input(z.object({
      source: z.string().default("mybillbook"),
      excludeInvoiceIds: z.array(z.string()).default([]),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "manage", "Import");
      let created = 0;
      const errors: string[] = [];

      // Find all invoices with amountPaid > 0 that have NO linked payment
      // Find invoices with amountPaid > 0 that:
      // 1. Have no payment directly linked (invoice_id = this invoice)
      // 2. Were NOT allocated during the C&B payment import (excludeInvoiceIds)
      // These are genuinely "direct-paid" invoices in myBillBook with no separate payment record.
      const excludeIds = input.excludeInvoiceIds;
      const rows = (await ctx.db.execute(sql`
        SELECT i.id, i.invoice_number, i.party_id, i.amount_paid, i.invoice_date, i.type
        FROM invoices i
        WHERE i.business_id = ${ctx.businessId}
          AND i.document_type = 'invoice'
          AND i.amount_paid::numeric > 0
          AND i.source = ${input.source}
          AND NOT EXISTS (
            SELECT 1 FROM payments p
            WHERE p.business_id = ${ctx.businessId}
              AND p.invoice_id = i.id
          )
          ${excludeIds.length > 0 ? sql`AND i.id NOT IN (${sql.join(excludeIds.map(id => sql`${id}`), sql`,`)})` : sql``}
        ORDER BY i.invoice_date ASC
      `)) as unknown as Array<{
        id: string;
        invoice_number: string;
        party_id: string;
        amount_paid: string;
        invoice_date: Date;
        type: string;
      }>;

      if (rows.length === 0) {
        return { created: 0, total: 0, errors: [] };
      }

      // Get the payment counter
      const [biz] = await ctx.db
        .select({ prefix: businesses.paymentPrefix, nextNum: businesses.nextPaymentNumber })
        .from(businesses)
        .where(eq(businesses.id, ctx.businessId))
        .for("update");

      let counter = biz.nextNum;

      // Create a payment for each unmatched invoice
      const paymentRows = rows.map((inv) => {
        const paymentNumber = `${biz.prefix}-${String(counter).padStart(5, "0")}`;
        counter++;
        return {
          id: crypto.randomUUID(),
          businessId: ctx.businessId,
          partyId: inv.party_id,
          invoiceId: inv.id,
          paymentNumber,
          amount: inv.amount_paid,
          discount: "0",
          mode: "cash" as const,
          paymentDate: new Date(inv.invoice_date),
          notes: `Auto-created for direct-paid invoice ${inv.invoice_number}`,
          createdByUserId: ctx.user!.id,
          createdByName: ctx.user!.name,
          source: input.source,
        };
      });

      // Update counter
      await ctx.db.update(businesses)
        .set({ nextPaymentNumber: counter })
        .where(eq(businesses.id, ctx.businessId));

      // Batch insert in chunks
      for (let i = 0; i < paymentRows.length; i += 500) {
        await ctx.db.insert(payments).values(paymentRows.slice(i, i + 500));
      }

      created = paymentRows.length;

      return { created, total: rows.length, errors };
    }),

  // ── Ensure bank accounts exist by mode + import inter-account transfers ──
  importTransfers: adminProcedure
    .input(z.object({
      transfers: z.array(z.object({
        date: z.string(),
        amount: z.string(),
        fromMode: z.string(), // "cash", "bank", "upi"
        toMode: z.string(),
        notes: z.string().optional(),
        txnNo: z.string().optional(),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "manage", "Import");
      let created = 0;
      const errors: string[] = [];

      // Map mode → account type
      const modeToType: Record<string, "cash" | "savings" | "upi"> = {
        cash: "cash",
        bank: "savings",
        upi: "upi",
      };

      const modeToName: Record<string, string> = {
        cash: "Cash",
        bank: "Bank Account",
        upi: "UPI",
      };

      // Ensure accounts exist for each mode used in transfers
      const modesNeeded = new Set<string>();
      for (const t of input.transfers) {
        modesNeeded.add(t.fromMode);
        modesNeeded.add(t.toMode);
      }

      const existingAccounts = await ctx.db.select()
        .from(bankAccounts)
        .where(eq(bankAccounts.businessId, ctx.businessId));

      const accountByType = new Map(existingAccounts.map(a => [a.accountType, a]));

      // Auto-create missing accounts
      for (const mode of modesNeeded) {
        const acctType = modeToType[mode] || "savings";
        if (!accountByType.has(acctType)) {
          const [created] = await ctx.db.insert(bankAccounts).values({
            businessId: ctx.businessId,
            accountName: modeToName[mode] || mode,
            accountType: acctType,
            openingBalance: "0",
            currentBalance: "0",
            isDefault: acctType === "savings",
          }).returning();
          accountByType.set(acctType, created);
        }
      }

      // Process transfers
      for (const t of input.transfers) {
        const transferDate = parseFlexibleDate(t.date);
        if (!transferDate) {
          errors.push(`Invalid date "${t.date}" for transfer`);
          continue;
        }

        const fromType = modeToType[t.fromMode] || "savings";
        const toType = modeToType[t.toMode] || "savings";
        const fromAccount = accountByType.get(fromType);
        const toAccount = accountByType.get(toType);

        if (!fromAccount || !toAccount || fromAccount.id === toAccount.id) {
          errors.push(`Cannot transfer: ${t.fromMode} → ${t.toMode}`);
          continue;
        }

        await ctx.db.transaction(async (tx) => {
          const amount = t.amount;

          // Withdraw from source
          await tx.insert(bankTransactions).values({
            bankAccountId: fromAccount.id,
            businessId: ctx.businessId,
            type: "withdrawal",
            amount,
            description: t.notes || `Transfer to ${modeToName[t.toMode] || t.toMode}`,
            referenceType: "transfer",
            transactionDate: transferDate,
          });
          await tx.update(bankAccounts).set({
            currentBalance: sql`${bankAccounts.currentBalance}::numeric - ${amount}::numeric`,
            updatedAt: new Date(),
          }).where(eq(bankAccounts.id, fromAccount.id));

          // Deposit to destination
          await tx.insert(bankTransactions).values({
            bankAccountId: toAccount.id,
            businessId: ctx.businessId,
            type: "deposit",
            amount,
            description: t.notes || `Transfer from ${modeToName[t.fromMode] || t.fromMode}`,
            referenceType: "transfer",
            transactionDate: transferDate,
          });
          await tx.update(bankAccounts).set({
            currentBalance: sql`${bankAccounts.currentBalance}::numeric + ${amount}::numeric`,
            updatedAt: new Date(),
          }).where(eq(bankAccounts.id, toAccount.id));
        });

        created++;
      }

      // Return the account IDs so frontend knows what was created
      const accounts = Array.from(accountByType.entries()).map(([type, a]) => ({
        type,
        id: a.id,
        name: a.accountName,
      }));

      return { created, total: input.transfers.length, errors, accounts };
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
