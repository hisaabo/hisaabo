/**
 * selfExportImport.test.ts — End-to-end integration tests for the
 * self-export / self-import round-trip pipeline.
 *
 * Tests exercise the full stack:
 *   tRPC routers (selfExport.request, selfImport.request)
 *   HTTP handlers (GET /api/export/:tenantId, POST /api/selfImport/:tenantId)
 *   importEngine.ts + recomputeDerived.ts
 *
 * All tests hit real Postgres (TEST_DATABASE_URL). The database is NOT mocked.
 *
 * IMPORTANT — single-DB constraint:
 *   In MULTI_TENANT=false mode (test env), getTenantDb() always returns the
 *   same shared DB. The selfImport.request and importStream.ts "empty target"
 *   check counts all businesses in the DB, not just those for a specific tenant.
 *   Tests that need an empty target call truncateAllTables() before running.
 *   This is sequential — vitest config uses singleFork + pool.
 *
 * RUNNING:
 *   pnpm --filter @hisaabo/api test -- selfExportImport
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import tarStream from "tar-stream";
import { eq, count as sqlCount } from "drizzle-orm";
import {
  // Control schema
  users,
  tenants,
  tenantMembers,
  // Tenant schema
  businesses,
  parties,
  items,
  itemVariants,
  invoices,
  invoiceItems,
  payments,
  paymentAllocations,
  bankAccounts,
  expenses,
  stockAdjustments,
  journalEntries,
  journalEntryLines,
  chartOfAccounts,
  recurringInvoiceTemplates,
  eInvoiceConfigs,
  auditLog,
} from "@hisaabo/db";
import {
  getControlDb,
  getTenantTestDb,
  truncateAllTables,
  closeTestDb,
} from "../helpers/test-db.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { registerExportRoute } from "../../http/exportStream.js";
import { registerImportRoute } from "../../http/importStream.js";

// ── Timeouts ──────────────────────────────────────────────────────────────────
const LARGE_DATA_TIMEOUT_MS = 120_000;

// ── Test Hono app ──────────────────────────────────────────────────────────────
function buildTestApp(): Hono {
  const app = new Hono();
  registerExportRoute(app);
  registerImportRoute(app);
  return app;
}

const testApp = buildTestApp();

// ── tRPC caller factory ────────────────────────────────────────────────────────
const callerFactory = createCallerFactory(appRouter);

function buildCaller(opts: {
  userId: string;
  email: string;
  name: string | null;
  tenantId: string;
  businessId?: string;
}) {
  return callerFactory({
    user: { id: opts.userId, email: opts.email, name: opts.name },
    tenantId: opts.tenantId,
    businessId: opts.businessId ?? null,
    req: new Request("http://localhost:3000/api/trpc/test", {
      method: "POST",
      headers: new Headers({ "content-type": "application/json" }),
    }),
    resHeaders: new Headers(),
    ipAddress: null,
  });
}

// ── Fixture helpers ────────────────────────────────────────────────────────────

async function createOwner(emailSuffix: string) {
  const cdb = getControlDb();
  const id = randomUUID();
  const email = `owner-${emailSuffix}-${id.slice(0, 6)}@export-test.in`;
  await cdb.insert(users).values({
    id,
    email,
    name: "Export Test Owner",
    passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$placeholder_test_hash",
    emailVerified: true,
  });
  return { id, email };
}

async function createTestTenant(name: string) {
  const cdb = getControlDb();
  const id = randomUUID();
  const slug = `export-test-${id.slice(0, 8)}`;
  await cdb.insert(tenants).values({
    id,
    name,
    slug,
    plan: "business",
    status: "active",
  });
  return { id, slug };
}

async function enrollMember(
  tenantId: string,
  userId: string,
  role:
    | "owner"
    | "admin"
    | "member"
    | "viewer"
    | "superadmin"
    | "seller_manager"
    | "seller"
    | "accountant" = "owner",
) {
  const cdb = getControlDb();
  await cdb.insert(tenantMembers).values({
    tenantId,
    userId,
    role,
    acceptedAt: new Date(),
  });
}

async function seedBusiness(
  userId: string,
  nameSuffix: string,
  overrides: Record<string, unknown> = {},
) {
  const db = getTenantTestDb();
  const [row] = await db
    .insert(businesses)
    .values({
      createdByUserId: userId,
      name: `Test Business ${nameSuffix}`,
      gstRegistrationType: "regular",
      gstin: `27AABCT${nameSuffix.slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, "X")}R1ZM`,
      phone: "9876543210",
      email: `biz${Date.now()}@test.in`,
      city: "Mumbai",
      state: "Maharashtra",
      stateCode: "27",
      currency: "INR",
      invoicePrefix: "INV",
      nextInvoiceNumber: 1,
      paymentPrefix: "PAY",
      nextPaymentNumber: 1,
      quotationPrefix: "QTN",
      nextQuotationNumber: 1,
      creditNotePrefix: "CN",
      nextCreditNoteNumber: 1,
      deliveryChallanPrefix: "DC",
      nextDeliveryChallanNumber: 1,
      proformaPrefix: "PI",
      nextProformaNumber: 1,
      financialYearStart: 4,
      storeEnabled: false,
      storeAllowNegativeStock: false,
      nextStoreOrderNumber: 1,
      storeOrderPrefix: "ORD",
      ...overrides,
    })
    .returning();
  return row!;
}

async function seedParty(
  businessId: string,
  type: "customer" | "supplier" = "customer",
) {
  const db = getTenantTestDb();
  const [row] = await db
    .insert(parties)
    .values({
      businessId,
      type,
      name: `Party ${randomUUID().slice(0, 8)}`,
      openingBalance: "0.00",
      state: "Maharashtra",
      stateCode: "27",
    })
    .returning();
  return row!;
}

async function seedItem(businessId: string, stock = "100.000") {
  const db = getTenantTestDb();
  const [row] = await db
    .insert(items)
    .values({
      businessId,
      name: `Item ${randomUUID().slice(0, 8)}`,
      unit: "pcs",
      itemMode: "simple",
      salePrice: "100.00",
      purchasePrice: "80.00",
      taxPercent: "18.00",
      stockQuantity: stock,
      itemType: "product",
      taxInclusive: false,
      storeEnabled: false,
      storeSortOrder: 0,
    })
    .returning();
  return row!;
}

async function seedInvoice(
  businessId: string,
  partyId: string,
  amountStr = "118.00",
  overrides: Record<string, unknown> = {},
) {
  const db = getTenantTestDb();
  const invNum = `TEST-${randomUUID().slice(0, 8).toUpperCase()}`;
  const [inv] = await db
    .insert(invoices)
    .values({
      businessId,
      partyId,
      type: "sale",
      status: "draft",
      documentType: "invoice",
      invoiceNumber: invNum,
      invoiceDate: new Date(),
      subtotal: "100.00",
      taxAmount: "18.00",
      discountAmount: "0.00",
      additionalCharges: "0.00",
      roundOff: "0.00",
      totalAmount: amountStr,
      amountPaid: "0.00",
      ...overrides,
    })
    .returning();
  await db.insert(invoiceItems).values({
    invoiceId: inv!.id,
    itemName: "Test Item",
    quantity: "1.000",
    unitPrice: "100.00",
    taxPercent: "18.00",
    taxAmount: "18.00",
    discountPercent: "0.00",
    totalAmount: amountStr,
    sortOrder: 0,
    conversionFactor: "1",
  });
  return inv!;
}

// ── Tar helpers ────────────────────────────────────────────────────────────────

async function unpackTarGz(buf: Buffer): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  const gunzip = promisify(zlib.gunzip);
  const tarBuf = await gunzip(buf);

  await new Promise<void>((resolve, reject) => {
    const extract = tarStream.extract();
    extract.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        result.set(header.name, Buffer.concat(chunks));
        next();
      });
      stream.on("error", reject);
    });
    extract.on("finish", resolve);
    extract.on("error", reject);

    Readable.from(
      (function* () {
        yield tarBuf;
      })(),
    ).pipe(extract);
  });

  return result;
}

async function repackTar(entries: Map<string, Buffer>): Promise<Buffer> {
  const pack = tarStream.pack();
  const chunks: Buffer[] = [];

  return new Promise<Buffer>((resolve, reject) => {
    pack.on("data", (c: Buffer) => chunks.push(c));
    pack.on("end", () => resolve(Buffer.concat(chunks)));
    pack.on("error", reject);

    const enqueue = async () => {
      for (const [name, content] of entries) {
        await new Promise<void>((res, rej) => {
          pack.entry({ name, size: content.length }, content, (err) =>
            err ? rej(err) : res(),
          );
        });
      }
      pack.finalize();
    };

    enqueue().catch(reject);
  });
}

async function gzipBuffer(buf: Buffer): Promise<Buffer> {
  return promisify(zlib.gzip)(buf);
}

// ── HTTP helpers ───────────────────────────────────────────────────────────────

async function httpExport(tenantId: string, token: string): Promise<Response> {
  const url = `http://localhost:3000/api/export/${tenantId}?token=${encodeURIComponent(token)}`;
  return testApp.request(url, { method: "GET" });
}

async function httpImport(
  tenantId: string,
  token: string,
  body: Buffer,
): Promise<Response> {
  const url = `http://localhost:3000/api/selfImport/${tenantId}?token=${encodeURIComponent(token)}`;
  const ab = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
  return testApp.request(url, {
    method: "POST",
    headers: { "content-type": "application/gzip" },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: ab as any,
  });
}

// ── Convenience: sign import token directly (bypass tRPC for HTTP-only tests) ──
async function signImportTokenDirect(
  tenantId: string,
  userId: string,
): Promise<string> {
  const { signImportToken } = await import("../../lib/importToken.js");
  const { token } = signImportToken(tenantId, userId);
  return token;
}

// ── afterAll: always clean up ──────────────────────────────────────────────────
afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// =============================================================================
// TEST 1 — Round-trip happy path
// =============================================================================

describe("Test 1: round-trip happy path", () => {
  // Truncate before this test to start clean (single-DB constraint)
  beforeEach(async () => {
    await truncateAllTables();
  });

  it(
    "exports all seeded data, imports into fresh tenant, and all assertions pass",
    async () => {
      const db = getTenantTestDb();

      // ── Source tenant setup ───────────────────────────────────────────────────
      const owner = await createOwner("t1-src");
      const srcTenant = await createTestTenant("Source Corp T1");
      await enrollMember(srcTenant.id, owner.id);

      // 2 businesses
      const biz1 = await seedBusiness(owner.id, "A1");
      const biz2 = await seedBusiness(owner.id, "B1");

      // 5 parties (mix customer/supplier)
      const p1 = await seedParty(biz1.id, "customer");
      const p2 = await seedParty(biz1.id, "customer");
      const p3 = await seedParty(biz1.id, "supplier");
      await seedParty(biz2.id, "customer");
      await seedParty(biz2.id, "supplier");

      // 5 items — 1 with variants (2 variants)
      const item1 = await seedItem(biz1.id);
      const item2 = await seedItem(biz1.id);
      const item3WithVariants = await seedItem(biz1.id);
      await seedItem(biz2.id);
      await seedItem(biz2.id);

      const [v1] = await db
        .insert(itemVariants)
        .values({
          itemId: item3WithVariants.id,
          attributeValues: { Size: "M" },
          stockQuantity: "50.000",
          storeEnabled: false,
        })
        .returning();
      const [v2] = await db
        .insert(itemVariants)
        .values({
          itemId: item3WithVariants.id,
          attributeValues: { Size: "L" },
          stockQuantity: "30.000",
          storeEnabled: false,
        })
        .returning();
      expect(v1).toBeDefined();
      expect(v2).toBeDefined();

      // 3 bank accounts
      const [_ba1] = await db
        .insert(bankAccounts)
        .values({
          businessId: biz1.id,
          accountName: "HDFC Current",
          accountType: "current",
          openingBalance: "10000.00",
          currentBalance: "10000.00",
          isDefault: true,
        })
        .returning();
      await db.insert(bankAccounts).values({
        businessId: biz1.id,
        accountName: "SBI Savings",
        accountType: "savings",
        openingBalance: "5000.00",
        currentBalance: "5000.00",
        isDefault: false,
      });
      await db.insert(bankAccounts).values({
        businessId: biz2.id,
        accountName: "ICICI Cash",
        accountType: "cash",
        openingBalance: "0.00",
        currentBalance: "0.00",
        isDefault: true,
      });

      // 10 invoices (sale/purchase + credit note referencing a sale invoice)
      const saleInv = await seedInvoice(biz1.id, p1.id, "118.00");
      await seedInvoice(biz1.id, p3.id, "236.00", { type: "purchase" });
      const inv3 = await seedInvoice(biz1.id, p2.id, "59.00");
      const inv4 = await seedInvoice(biz1.id, p1.id, "177.00");
      await seedInvoice(biz1.id, p2.id, "295.00");
      const inv6 = await seedInvoice(biz2.id, p1.id, "118.00");
      await seedInvoice(biz2.id, p3.id, "236.00", { type: "purchase" });
      await seedInvoice(biz2.id, p1.id, "59.00");
      await seedInvoice(biz2.id, p1.id, "88.50");
      // Credit note with self-FK referenceDocumentId → saleInv
      const _creditNote = await seedInvoice(biz1.id, p1.id, "59.00", {
        documentType: "credit_note",
        referenceDocumentId: saleInv.id,
      });

      // 5 payments
      const [pay1] = await db
        .insert(payments)
        .values({
          businessId: biz1.id,
          partyId: p1.id,
          amount: "150.00",
          discount: "0.00",
          mode: "cash",
          paymentDate: new Date(),
        })
        .returning();
      const [pay2] = await db
        .insert(payments)
        .values({
          businessId: biz1.id,
          partyId: p2.id,
          amount: "59.00",
          discount: "0.00",
          mode: "bank",
          paymentDate: new Date(),
        })
        .returning();
      await db.insert(payments).values({
        businessId: biz1.id,
        partyId: p3.id,
        amount: "100.00",
        discount: "0.00",
        mode: "upi",
        paymentDate: new Date(),
      });
      const [pay4] = await db
        .insert(payments)
        .values({
          businessId: biz2.id,
          partyId: p1.id,
          amount: "118.00",
          discount: "0.00",
          mode: "cash",
          paymentDate: new Date(),
        })
        .returning();
      await db.insert(payments).values({
        businessId: biz2.id,
        partyId: p3.id,
        amount: "200.00",
        discount: "0.00",
        mode: "cheque",
        paymentDate: new Date(),
      });

      // Payment allocations: pay1 split across saleInv + inv4; pay2 → inv3; pay4 → inv6
      await db.insert(paymentAllocations).values([
        { paymentId: pay1!.id, invoiceId: saleInv.id, amount: "100.00" },
        { paymentId: pay1!.id, invoiceId: inv4.id, amount: "50.00" },
      ]);
      await db
        .insert(paymentAllocations)
        .values({ paymentId: pay2!.id, invoiceId: inv3.id, amount: "59.00" });
      await db
        .insert(paymentAllocations)
        .values({ paymentId: pay4!.id, invoiceId: inv6.id, amount: "118.00" });

      // Update amountPaid
      await db
        .update(invoices)
        .set({ amountPaid: "100.00" })
        .where(eq(invoices.id, saleInv.id));
      await db
        .update(invoices)
        .set({ amountPaid: "50.00" })
        .where(eq(invoices.id, inv4.id));
      await db
        .update(invoices)
        .set({ amountPaid: "59.00" })
        .where(eq(invoices.id, inv3.id));
      await db
        .update(invoices)
        .set({ amountPaid: "118.00" })
        .where(eq(invoices.id, inv6.id));

      // 3 journal entries: je2.reversesEntryId → je1
      const [coa] = await db
        .insert(chartOfAccounts)
        .values({
          businessId: biz1.id,
          code: "1001",
          name: "Cash",
          accountType: "asset",
          isSystem: false,
          isActive: true,
        })
        .returning();
      const [coaLiab] = await db
        .insert(chartOfAccounts)
        .values({
          businessId: biz1.id,
          code: "2001",
          name: "Accounts Payable",
          accountType: "liability",
          isSystem: false,
          isActive: true,
        })
        .returning();
      const [je1] = await db
        .insert(journalEntries)
        .values({
          businessId: biz1.id,
          entryNumber: "JE-001",
          entryDate: new Date(),
          narration: "Opening entry",
          source: "manual",
          isVoided: false,
        })
        .returning();
      const [_je2] = await db
        .insert(journalEntries)
        .values({
          businessId: biz1.id,
          entryNumber: "JE-002",
          entryDate: new Date(),
          narration: "Reversal of JE-001",
          source: "manual",
          isVoided: false,
          reversesEntryId: je1!.id,
        })
        .returning();
      await db.insert(journalEntries).values({
        businessId: biz1.id,
        entryNumber: "JE-003",
        entryDate: new Date(),
        narration: "Standalone",
        source: "manual",
        isVoided: false,
      });
      // Lines for je1
      await db.insert(journalEntryLines).values([
        { journalEntryId: je1!.id, accountId: coa!.id, debit: "1000.00", credit: "0.00" },
        { journalEntryId: je1!.id, accountId: coaLiab!.id, debit: "0.00", credit: "1000.00" },
      ]);

      // 1 recurring invoice template
      const [recurringTpl] = await db
        .insert(recurringInvoiceTemplates)
        .values({
          businessId: biz1.id,
          partyId: p1.id,
          name: "Monthly Retainer",
          type: "sale",
          frequency: "monthly",
          lineItems: [
            {
              itemName: "Consulting",
              quantity: "1",
              unitPrice: "10000.00",
              taxPercent: "18.00",
              discountPercent: "0.00",
            },
          ],
          additionalCharges: "0.00",
          status: "active",
          startDate: new Date(),
          nextRunDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          totalRuns: 0,
        })
        .returning();
      expect(recurringTpl).toBeDefined();

      // 2 stock adjustments
      await db.insert(stockAdjustments).values([
        {
          businessId: biz1.id,
          itemId: item1.id,
          quantity: "50.000",
          previousStock: "100.000",
          newStock: "150.000",
          adjustmentDate: new Date(),
        },
        {
          businessId: biz1.id,
          itemId: item2.id,
          quantity: "-10.000",
          previousStock: "100.000",
          newStock: "90.000",
          adjustmentDate: new Date(),
        },
      ]);

      // 3 expenses
      await db.insert(expenses).values([
        {
          businessId: biz1.id,
          category: "Office",
          description: "Stationery",
          amount: "500.00",
          mode: "cash",
          expenseDate: new Date(),
        },
        {
          businessId: biz1.id,
          category: "Travel",
          description: "Cab fare",
          amount: "1200.00",
          mode: "upi",
          expenseDate: new Date(),
        },
        {
          businessId: biz2.id,
          category: "Utilities",
          description: "Electricity",
          amount: "3500.00",
          mode: "bank",
          expenseDate: new Date(),
        },
      ]);

      // 1 eInvoiceConfigs row with clientSecret + password set
      const [eiCfg] = await db
        .insert(eInvoiceConfigs)
        .values({
          businessId: biz1.id,
          gstin: "27AABCT0000R1ZM",
          clientId: "client-id-test",
          clientSecret: "super-secret-client-key",
          username: "test-user",
          password: "p@ssw0rd!",
          isSandbox: true,
          isEnabled: false,
          thresholdCrore: "5.00",
        })
        .returning();
      expect(eiCfg).toBeDefined();

      // ── Request export token ──────────────────────────────────────────────────
      const exportCaller = buildCaller({
        userId: owner.id,
        email: owner.email,
        name: "Export Test Owner",
        tenantId: srcTenant.id,
      });

      const exportResult = await exportCaller.selfExport.request({
        tenantId: srcTenant.id,
      });
      expect(exportResult.token).toBeTruthy();

      // ── Stream export ─────────────────────────────────────────────────────────
      const exportRes = await httpExport(srcTenant.id, exportResult.token);
      expect(exportRes.status).toBe(200);

      const tarGzBytes = Buffer.from(await exportRes.arrayBuffer());
      expect(tarGzBytes.length).toBeGreaterThan(100);

      // Inspect manifest
      const entries = await unpackTarGz(tarGzBytes);
      expect(entries.has("manifest.json")).toBe(true);

      const manifest = JSON.parse(entries.get("manifest.json")!.toString("utf8")) as {
        formatVersion: number;
        sourceTenantId: string;
        businessIds: string[];
        rowCounts: Record<string, number>;
        redacted: string[];
        files: Record<string, { sha256: string; rows: number; bytes: number }>;
      };

      expect(manifest.formatVersion).toBe(1);
      expect(manifest.sourceTenantId).toBe(srcTenant.id);
      expect(manifest.businessIds).toHaveLength(2);
      expect(manifest.rowCounts["businesses"]).toBe(2);
      expect(manifest.rowCounts["invoices"]).toBe(10);
      expect(manifest.rowCounts["parties"]).toBe(5);
      expect(manifest.rowCounts["payments"]).toBe(5);
      expect(manifest.rowCounts["journal_entries"]).toBe(3);
      expect(manifest.rowCounts["recurring_invoice_templates"]).toBe(1);
      expect(manifest.rowCounts["e_invoice_configs"]).toBe(1);

      // manifest.redacted must include tables with redacted fields
      expect(manifest.redacted).toContain("e_invoice_configs");
      expect(manifest.redacted).toContain("businesses");

      // ── Verify exported NDJSON uses camelCase keys ───────────────────────────
      const businessNdjson = entries.get("businesses.ndjson");
      expect(businessNdjson).toBeDefined();
      const firstBizLine = businessNdjson!.toString("utf8").trim().split("\n")[0]!;
      const exportedBiz = JSON.parse(firstBizLine) as Record<string, unknown>;
      // Verify the exported row uses camelCase (e.g. "createdByUserId" not "created_by_user_id")
      expect(Object.keys(exportedBiz)).toContain("createdByUserId");
      expect(Object.keys(exportedBiz)).not.toContain("created_by_user_id");
      // Verify the redacted column is present as camelCase key with null value
      expect(Object.prototype.hasOwnProperty.call(exportedBiz, "carrierCredentials")).toBe(true);
      expect(exportedBiz["carrierCredentials"]).toBeNull();

      // Verify child tables are exported (invoice_items, item_variants, etc.)
      expect(manifest.rowCounts["invoice_items"]).toBeGreaterThan(0);
      expect(manifest.rowCounts["item_variants"]).toBe(2);
      expect(manifest.rowCounts["journal_entry_lines"]).toBe(2);
      expect(manifest.rowCounts["payment_allocations"]).toBe(4);

      // ── Import round-trip succeeds ────────────────────────────────────────────
      const { getTestClient } = await import("../helpers/test-db.js");
      const rawClient = getTestClient();
      await rawClient`
        TRUNCATE TABLE
          gstr2b_records, gstr2b_uploads, eway_bill_vehicle_updates, eway_bills,
          e_invoice_configs, bank_categorization_rules, bank_statement_lines,
          bank_statement_imports, bank_statement_templates, itc_utilizations,
          itc_ledger_entries, journal_entry_templates, journal_entry_lines,
          journal_entries, chart_of_accounts, shipment_events, shipments,
          store_orders, audit_log, stock_adjustments, sales_targets,
          bank_transactions, payment_gateway_configs, bank_accounts,
          payment_allocations, payments, invoice_items, item_variants,
          invoices, expenses, items, parties, businesses,
          recurring_invoice_runs, recurring_invoice_templates
        CASCADE
      `;

      const tgtOwner = await createOwner("t1-tgt");
      const tgtTenant = await createTestTenant("Target Corp T1");
      await enrollMember(tgtTenant.id, tgtOwner.id);

      const importCaller = buildCaller({
        userId: tgtOwner.id,
        email: tgtOwner.email,
        name: "Target Test Owner",
        tenantId: tgtTenant.id,
      });

      const importResult = await importCaller.selfImport.request({
        tenantId: tgtTenant.id,
      });
      expect(importResult.token).toBeTruthy();

      const importRes = await httpImport(tgtTenant.id, importResult.token, tarGzBytes);
      // Import succeeds now that exported NDJSON uses camelCase keys
      expect(importRes.status).toBe(200);

      const importBody = (await importRes.json()) as {
        ok: boolean;
        rowsInserted: Record<string, number>;
        warnings: Array<{ table: string; message: string }>;
      };
      expect(importBody.ok).toBe(true);

      // Verify key tables were imported with correct row counts
      expect(importBody.rowsInserted["businesses"]).toBe(2);
      expect(importBody.rowsInserted["invoices"]).toBe(10);
      expect(importBody.rowsInserted["parties"]).toBe(5);
      expect(importBody.rowsInserted["payments"]).toBe(5);
      expect(importBody.rowsInserted["item_variants"]).toBe(2);
      expect(importBody.rowsInserted["journal_entry_lines"]).toBe(2);
      expect(importBody.rowsInserted["payment_allocations"]).toBe(4);

      // ── Verify data landed in the target DB ───────────────────────────────────
      const [bizCountRow] = await db
        .select({ c: sqlCount(businesses.id) })
        .from(businesses);
      expect(bizCountRow!.c).toBe(2);

      // ── Verify createdByUserId was rewritten to the importing user ─────────
      // The businessProcedure middleware checks this to gate access, so all
      // imported businesses must point to the target owner, not the source.
      const importedBizzes = await db
        .select({ id: businesses.id, createdByUserId: businesses.createdByUserId })
        .from(businesses);
      for (const biz of importedBizzes) {
        expect(biz.createdByUserId).toBe(tgtOwner.id);
      }

      // auditLog count on target === 0 (import skips audit_log)
      const [auditCount] = await db
        .select({ c: sqlCount(auditLog.id) })
        .from(auditLog);
      expect(auditCount!.c).toBe(0);
    },
    60_000,
  );
});

// =============================================================================
// TEST 2 — Import into non-empty tenant is refused
// =============================================================================

describe("Test 2: import into non-empty tenant returns PRECONDITION_FAILED", () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  it("selfImport.request is rejected when the DB already has businesses", async () => {
    // Create source + export first
    const owner = await createOwner("t2-src");
    const srcTenant = await createTestTenant("Source Corp T2");
    await enrollMember(srcTenant.id, owner.id);
    await seedBusiness(owner.id, "T2A");

    // Seed a business in the target's DB (it's the same DB in self-hosted mode)
    const tgtOwner = await createOwner("t2-tgt");
    const tgtTenant = await createTestTenant("Target Corp T2");
    await enrollMember(tgtTenant.id, tgtOwner.id);
    // The "existing business" makes the target non-empty
    await seedBusiness(tgtOwner.id, "T2-existing");

    // tRPC-level: selfImport.request should reject with PRECONDITION_FAILED
    const importCaller = buildCaller({
      userId: tgtOwner.id,
      email: tgtOwner.email,
      name: "T2 Target Owner",
      tenantId: tgtTenant.id,
    });

    await expect(
      importCaller.selfImport.request({ tenantId: tgtTenant.id }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("importStream POST returns 409 TARGET_NOT_EMPTY when DB has existing businesses", async () => {
    const owner = await createOwner("t2b-src");
    const srcTenant = await createTestTenant("Source Corp T2b");
    await enrollMember(srcTenant.id, owner.id);
    await seedBusiness(owner.id, "T2B");

    // Export first
    const exportCaller = buildCaller({
      userId: owner.id,
      email: owner.email,
      name: "T2b Owner",
      tenantId: srcTenant.id,
    });
    const { token: exportToken } = await exportCaller.selfExport.request({
      tenantId: srcTenant.id,
    });
    const exportRes = await httpExport(srcTenant.id, exportToken);
    const tarGzBytes = Buffer.from(await exportRes.arrayBuffer());

    // Now set up target (non-empty — same DB already has a business from above)
    const tgtOwner = await createOwner("t2b-tgt");
    const tgtTenant = await createTestTenant("Target Corp T2b");
    await enrollMember(tgtTenant.id, tgtOwner.id);

    const importToken = await signImportTokenDirect(tgtTenant.id, tgtOwner.id);
    const importRes = await httpImport(tgtTenant.id, importToken, tarGzBytes);

    expect(importRes.status).toBe(409);
    const body = (await importRes.json()) as { error: string };
    expect(body.error).toBe("TARGET_NOT_EMPTY");
  });
});

// =============================================================================
// TEST 3 — Corrupted sha256 rejected, target stays empty
// =============================================================================

describe("Test 3: corrupted sha256 rejected", () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  it("flipping a byte in invoices.ndjson causes checksum mismatch and import returns 422", async () => {
    const owner = await createOwner("t3-src");
    const srcTenant = await createTestTenant("Source Corp T3");
    await enrollMember(srcTenant.id, owner.id);
    const biz = await seedBusiness(owner.id, "T3A");
    const party = await seedParty(biz.id);
    await seedInvoice(biz.id, party.id);

    const exportCaller = buildCaller({
      userId: owner.id,
      email: owner.email,
      name: "T3 Owner",
      tenantId: srcTenant.id,
    });
    const { token: exportToken } = await exportCaller.selfExport.request({
      tenantId: srcTenant.id,
    });
    const exportRes = await httpExport(srcTenant.id, exportToken);
    const tarGzBytes = Buffer.from(await exportRes.arrayBuffer());

    // Unpack, corrupt invoices.ndjson, repack + regzip
    const entries = await unpackTarGz(tarGzBytes);
    const invNdjson = entries.get("invoices.ndjson");
    expect(invNdjson).toBeDefined();
    const corrupted = Buffer.from(invNdjson!);
    corrupted[Math.floor(corrupted.length / 2)] ^= 0xff;
    entries.set("invoices.ndjson", corrupted);

    const corruptedTar = await repackTar(entries);
    const corruptedTarGz = await gzipBuffer(corruptedTar);

    // Empty target
    const tgtOwner = await createOwner("t3-tgt");
    const tgtTenant = await createTestTenant("Target Corp T3");
    await enrollMember(tgtTenant.id, tgtOwner.id);

    // Truncate tenant tables so target is empty (control rows above survived)
    const { getTestClient } = await import("../helpers/test-db.js");
    const rawClient = getTestClient();
    await rawClient`TRUNCATE TABLE businesses CASCADE`;

    const importToken = await signImportTokenDirect(tgtTenant.id, tgtOwner.id);
    const importRes = await httpImport(tgtTenant.id, importToken, corruptedTarGz);

    expect(importRes.status).toBe(422);
    const body = (await importRes.json()) as {
      ok: boolean;
      errors: Array<{ message: string }>;
    };
    expect(body.ok).toBe(false);
    const allMessages = body.errors.map((e) => e.message).join(" ");
    expect(allMessages).toMatch(/[Cc]hecksum/);

    // Verify target remains empty
    const db = getTenantTestDb();
    const [bizCount] = await db
      .select({ c: sqlCount(businesses.id) })
      .from(businesses);
    expect(bizCount!.c).toBe(0);
  });
});

// =============================================================================
// TEST 4 — Wrong formatVersion rejected
// =============================================================================

describe("Test 4: wrong formatVersion rejected", () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  it("manifest with formatVersion:2 causes import to fail", async () => {
    const owner = await createOwner("t4-src");
    const srcTenant = await createTestTenant("Source Corp T4");
    await enrollMember(srcTenant.id, owner.id);
    await seedBusiness(owner.id, "T4A");

    const exportCaller = buildCaller({
      userId: owner.id,
      email: owner.email,
      name: "T4 Owner",
      tenantId: srcTenant.id,
    });
    const { token: exportToken } = await exportCaller.selfExport.request({
      tenantId: srcTenant.id,
    });
    const exportRes = await httpExport(srcTenant.id, exportToken);
    const tarGzBytes = Buffer.from(await exportRes.arrayBuffer());

    // Mutate formatVersion in manifest
    const entries = await unpackTarGz(tarGzBytes);
    const manifestBuf = entries.get("manifest.json");
    expect(manifestBuf).toBeDefined();
    const manifestObj = JSON.parse(manifestBuf!.toString("utf8"));
    manifestObj.formatVersion = 2;
    entries.set(
      "manifest.json",
      Buffer.from(JSON.stringify(manifestObj, null, 2) + "\n", "utf8"),
    );

    const modifiedTar = await repackTar(entries);
    const modifiedTarGz = await gzipBuffer(modifiedTar);

    // Empty target
    const tgtOwner = await createOwner("t4-tgt");
    const tgtTenant = await createTestTenant("Target Corp T4");
    await enrollMember(tgtTenant.id, tgtOwner.id);

    // Truncate tenant data (control rows survived)
    const { getTestClient } = await import("../helpers/test-db.js");
    const rawClient = getTestClient();
    await rawClient`TRUNCATE TABLE businesses CASCADE`;

    const importToken = await signImportTokenDirect(tgtTenant.id, tgtOwner.id);
    const importRes = await httpImport(tgtTenant.id, importToken, modifiedTarGz);

    expect(importRes.status).toBe(422);
    const body = (await importRes.json()) as {
      ok: boolean;
      errors: Array<{ message: string }>;
    };
    expect(body.ok).toBe(false);
    const allMessages = body.errors.map((e) => e.message).join(" ");
    expect(allMessages).toMatch(/formatVersion|literal|Unsupported/i);
  });
});

// =============================================================================
// TEST 5 — Non-owner forbidden
// =============================================================================

describe("Test 5: non-owner role is forbidden", () => {
  // These tests don't modify tenant data, but use beforeEach to avoid
  // conflicts with Tests 3/4 which truncate everything
  beforeEach(async () => {
    await truncateAllTables();
  });

  it("admin role cannot call selfExport.request — gets FORBIDDEN", async () => {
    const ownerUser = await createOwner("t5-owner");
    const adminUser = await createOwner("t5-admin");
    const tenant = await createTestTenant("Tenant T5");
    await enrollMember(tenant.id, ownerUser.id, "owner");
    await enrollMember(tenant.id, adminUser.id, "admin");

    const adminCaller = buildCaller({
      userId: adminUser.id,
      email: adminUser.email,
      name: "T5 Admin",
      tenantId: tenant.id,
    });

    await expect(
      adminCaller.selfExport.request({ tenantId: tenant.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin role cannot call selfImport.request — gets FORBIDDEN", async () => {
    const ownerUser = await createOwner("t5b-owner");
    const adminUser = await createOwner("t5b-admin");
    const tenant = await createTestTenant("Tenant T5b");
    await enrollMember(tenant.id, ownerUser.id, "owner");
    await enrollMember(tenant.id, adminUser.id, "admin");

    const adminCaller = buildCaller({
      userId: adminUser.id,
      email: adminUser.email,
      name: "T5b Admin",
      tenantId: tenant.id,
    });

    await expect(
      adminCaller.selfImport.request({ tenantId: tenant.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("member role cannot call selfExport.request — gets FORBIDDEN", async () => {
    const ownerUser = await createOwner("t5c-owner");
    const memberUser = await createOwner("t5c-member");
    const tenant = await createTestTenant("Tenant T5c");
    await enrollMember(tenant.id, ownerUser.id, "owner");
    await enrollMember(tenant.id, memberUser.id, "member");

    const memberCaller = buildCaller({
      userId: memberUser.id,
      email: memberUser.email,
      name: "T5c Member",
      tenantId: tenant.id,
    });

    await expect(
      memberCaller.selfExport.request({ tenantId: tenant.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("unauthenticated caller gets UNAUTHORIZED for selfExport.request", async () => {
    const tenant = await createTestTenant("Tenant T5-unauth");

    const unauthCaller = callerFactory({
      user: null,
      tenantId: null,
      businessId: null,
      req: new Request("http://localhost:3000/api/trpc/test", {
        method: "POST",
        headers: new Headers({ "content-type": "application/json" }),
      }),
      resHeaders: new Headers(),
      ipAddress: null,
    });

    await expect(
      unauthCaller.selfExport.request({ tenantId: tenant.id }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// =============================================================================
// TEST 6 — Rate limit: 3rd call in 24h is rejected
// =============================================================================

describe("Test 6: rate limit", () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  it("the 3rd selfExport.request call within 24h returns TOO_MANY_REQUESTS", async () => {
    const owner = await createOwner("t6-rl");
    const tenant = await createTestTenant("Rate Limit Tenant T6");
    await enrollMember(tenant.id, owner.id);
    await seedBusiness(owner.id, "T6biz");

    const caller = buildCaller({
      userId: owner.id,
      email: owner.email,
      name: "T6 Owner",
      tenantId: tenant.id,
    });

    // First two calls should succeed
    const result1 = await caller.selfExport.request({ tenantId: tenant.id });
    expect(result1.token).toBeTruthy();

    const result2 = await caller.selfExport.request({ tenantId: tenant.id });
    expect(result2.token).toBeTruthy();

    // Third call must be rate-limited
    await expect(
      caller.selfExport.request({ tenantId: tenant.id }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

// =============================================================================
// TEST 7 — Streaming / large data
// =============================================================================

describe("Test 7: streaming / large data", () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  it(
    "1000 invoices × 5 line items export completes without OOM and produces a valid archive",
    async () => {
      const owner = await createOwner("t7-large");
      const tenant = await createTestTenant("Large Data Tenant T7");
      await enrollMember(tenant.id, owner.id);

      const db = getTenantTestDb();
      const biz = await seedBusiness(owner.id, "T7biz");
      const party = await seedParty(biz.id);

      const INVOICE_COUNT = 1000;
      const LINES_PER_INVOICE = 5;

      // Batch-insert 1000 invoices
      const invRows: Array<typeof invoices.$inferInsert> = [];
      for (let i = 0; i < INVOICE_COUNT; i++) {
        invRows.push({
          businessId: biz.id,
          partyId: party.id,
          type: "sale",
          status: "draft",
          documentType: "invoice",
          invoiceNumber: `LOAD-${i.toString().padStart(5, "0")}`,
          invoiceDate: new Date(),
          subtotal: "500.00",
          taxAmount: "90.00",
          discountAmount: "0.00",
          additionalCharges: "0.00",
          roundOff: "0.00",
          totalAmount: "590.00",
          amountPaid: "0.00",
        });
      }

      const BATCH_SIZE = 200;
      let allInvoiceIds: string[] = [];
      for (let i = 0; i < invRows.length; i += BATCH_SIZE) {
        const inserted = await db
          .insert(invoices)
          .values(invRows.slice(i, i + BATCH_SIZE))
          .returning({ id: invoices.id });
        allInvoiceIds = allInvoiceIds.concat(inserted.map((r) => r.id));
      }
      expect(allInvoiceIds.length).toBe(INVOICE_COUNT);

      // Insert invoice_items
      const lineItemRows: Array<typeof invoiceItems.$inferInsert> = [];
      for (const invoiceId of allInvoiceIds) {
        for (let j = 0; j < LINES_PER_INVOICE; j++) {
          lineItemRows.push({
            invoiceId,
            itemName: `Line ${j + 1}`,
            quantity: "1.000",
            unitPrice: "100.00",
            taxPercent: "18.00",
            taxAmount: "18.00",
            discountPercent: "0.00",
            totalAmount: "118.00",
            sortOrder: j,
            conversionFactor: "1",
          });
        }
      }

      for (let i = 0; i < lineItemRows.length; i += 500) {
        await db.insert(invoiceItems).values(lineItemRows.slice(i, i + 500));
      }

      const heapBefore = process.memoryUsage().heapUsed;

      const exportCaller = buildCaller({
        userId: owner.id,
        email: owner.email,
        name: "T7 Owner",
        tenantId: tenant.id,
      });
      const { token: exportToken } = await exportCaller.selfExport.request({
        tenantId: tenant.id,
      });

      const exportRes = await httpExport(tenant.id, exportToken);
      expect(exportRes.status).toBe(200);

      const tarGzBytes = Buffer.from(await exportRes.arrayBuffer());

      const heapAfter = process.memoryUsage().heapUsed;
      const heapDeltaMB = (heapAfter - heapBefore) / 1024 / 1024;

      expect(tarGzBytes.length).toBeGreaterThan(1000);

      // Verify the archive is valid and row counts are correct
      const entries = await unpackTarGz(tarGzBytes);
      expect(entries.has("manifest.json")).toBe(true);
      expect(entries.has("invoices.ndjson")).toBe(true);

      const manifest = JSON.parse(entries.get("manifest.json")!.toString("utf8")) as {
        rowCounts: Record<string, number>;
      };
      expect(manifest.rowCounts["invoices"]).toBe(INVOICE_COUNT);

      // invoice_items are now exported via child-scope subquery
      expect(manifest.rowCounts["invoice_items"]).toBe(INVOICE_COUNT * LINES_PER_INVOICE);

      // Memory check: heap growth during export should stay under 250MB
      // (catches regressions where rows are accumulated in memory instead of streamed)
      expect(heapDeltaMB).toBeLessThan(250);
    },
    LARGE_DATA_TIMEOUT_MS,
  );
});

// =============================================================================
// TEST 8 — Redacted fields survive round-trip as null
// =============================================================================

describe("Test 8: redacted carrierCredentials survives round-trip as null", () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  it("businesses.carrierCredentials is null after export and in manifest.redacted", async () => {
    const owner = await createOwner("t8-src");
    const srcTenant = await createTestTenant("Source Corp T8");
    await enrollMember(srcTenant.id, owner.id);

    // Seed business with carrierCredentials set
    await seedBusiness(owner.id, "T8A", {
      carrierCredentials: { apiKey: "secret-carrier-api-key", secret: "top-secret" },
    });

    const exportCaller = buildCaller({
      userId: owner.id,
      email: owner.email,
      name: "T8 Owner",
      tenantId: srcTenant.id,
    });
    const { token: exportToken } = await exportCaller.selfExport.request({
      tenantId: srcTenant.id,
    });

    const exportRes = await httpExport(srcTenant.id, exportToken);
    expect(exportRes.status).toBe(200);
    const tarGzBytes = Buffer.from(await exportRes.arrayBuffer());

    // manifest.redacted must include "businesses"
    const entries = await unpackTarGz(tarGzBytes);
    const manifest = JSON.parse(entries.get("manifest.json")!.toString("utf8")) as {
      redacted: string[];
    };
    expect(manifest.redacted).toContain("businesses");

    // In the exported NDJSON, carrierCredentials must be JSON null
    const bizNdjson = entries.get("businesses.ndjson");
    expect(bizNdjson).toBeDefined();
    const firstLine = bizNdjson!.toString("utf8").trim().split("\n")[0]!;
    const exportedBiz = JSON.parse(firstLine) as Record<string, unknown>;

    // Exported key is camelCase "carrierCredentials" and value is null (redacted)
    expect(Object.prototype.hasOwnProperty.call(exportedBiz, "carrierCredentials")).toBe(true);
    expect(exportedBiz["carrierCredentials"]).toBeNull();
    // snake_case key must NOT be present
    expect(Object.prototype.hasOwnProperty.call(exportedBiz, "carrier_credentials")).toBe(false);

    // manifest.redacted correctly lists "businesses"
    expect(manifest.redacted).toContain("businesses");
  });
});

// =============================================================================
// TEST 9 — Imported businesses are accessible via businessProcedure
// =============================================================================

describe("Test 9: imported businesses are accessible via businessProcedure", () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  it(
    "the importing user can call a businessProcedure endpoint on an imported business",
    async () => {
      const db = getTenantTestDb();

      // ── Source tenant: seed a business with a party ──────────────────────
      const srcOwner = await createOwner("t9-src");
      const srcTenant = await createTestTenant("Source Corp T9");
      await enrollMember(srcTenant.id, srcOwner.id);

      const biz = await seedBusiness(srcOwner.id, "T9A");
      await seedParty(biz.id, "customer");

      // ── Export from source ──────────────────────────────────────────────
      const exportCaller = buildCaller({
        userId: srcOwner.id,
        email: srcOwner.email,
        name: "T9 Source Owner",
        tenantId: srcTenant.id,
      });
      const { token: exportToken } = await exportCaller.selfExport.request({
        tenantId: srcTenant.id,
      });
      const exportRes = await httpExport(srcTenant.id, exportToken);
      expect(exportRes.status).toBe(200);
      const tarGzBytes = Buffer.from(await exportRes.arrayBuffer());

      // ── Wipe tenant data so target is empty ─────────────────────────────
      const { getTestClient } = await import("../helpers/test-db.js");
      const rawClient = getTestClient();
      await rawClient`TRUNCATE TABLE businesses CASCADE`;

      // ── Target tenant: different user ───────────────────────────────────
      const tgtOwner = await createOwner("t9-tgt");
      const tgtTenant = await createTestTenant("Target Corp T9");
      await enrollMember(tgtTenant.id, tgtOwner.id);

      // ── Import into target ──────────────────────────────────────────────
      const importToken = await signImportTokenDirect(tgtTenant.id, tgtOwner.id);
      const importRes = await httpImport(tgtTenant.id, importToken, tarGzBytes);
      expect(importRes.status).toBe(200);

      // ── Verify the business's createdByUserId was rewritten ─────────────
      const [importedBiz] = await db
        .select({ id: businesses.id, createdByUserId: businesses.createdByUserId })
        .from(businesses);
      expect(importedBiz).toBeDefined();
      expect(importedBiz!.createdByUserId).toBe(tgtOwner.id);
      // Sanity: it should NOT be the source owner
      expect(importedBiz!.createdByUserId).not.toBe(srcOwner.id);

      // ── Call a businessProcedure-protected endpoint (party.list) ────────
      // This would fail with FORBIDDEN before the createdByUserId fix.
      const bizCaller = buildCaller({
        userId: tgtOwner.id,
        email: tgtOwner.email,
        name: "T9 Target Owner",
        tenantId: tgtTenant.id,
        businessId: importedBiz!.id,
      });

      const partyResult = await bizCaller.party.list({});
      expect(partyResult.data).toHaveLength(1);
      expect(partyResult.data[0]!.type).toBe("customer");
    },
    60_000,
  );
});
