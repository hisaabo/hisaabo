import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { Context, Next } from "hono";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { eq, and, gt, lt, gte, lte, inArray, sql } from "drizzle-orm";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import path from "node:path";
import QRCode from "qrcode";
import { appRouter } from "./router.js";
import { createContext } from "./context.js";
import type { InvoicePDFData } from "./lib/invoice-pdf.js";
import { generateLedgerPDF } from "./lib/ledger-pdf.js";
import { controlDb, getTenantDb, invoices, invoiceItems, items, itemVariants, parties, businesses, sessions, tenants, magicLinkTokens, bankAccounts, storeOrders, payments } from "@hisaabo/db";
import { calcLineItem, calcInvoiceTotals, money } from "@hisaabo/shared";

const app = new Hono();

// ── Security headers ───────────────────────────────────────────
app.use("*", secureHeaders());

// ── CORS ───────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173").split(",");

app.use("*", cors({
  origin: allowedOrigins,
  credentials: true,
  allowHeaders: ["Content-Type", "x-business-id", "Authorization"],
  allowMethods: ["GET", "POST", "OPTIONS"],
  maxAge: 86400,
}));

// ── Safe IP extraction ─────────────────────────────────────────
// x-forwarded-for is client-controlled when not behind a trusted proxy.
// Trusting it directly allows anyone to spoof their IP and bypass rate limits.
// Cloudflare's cf-connecting-ip is stripped of spoofed values by the CDN layer.
// When behind a reverse proxy we take the LAST entry in x-forwarded-for
// (appended by the proxy itself), not the first (which the client can forge).
function getClientIp(c: Context): string {
  // Cloudflare provides the real client IP — trust it unconditionally
  const cfIp = c.req.header("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  // Behind a reverse proxy take the LAST entry — the proxy's own addition
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  return "unknown";
}

// ── Rate limiting (in-memory, per IP, origin-aware) ───────────
// Same-origin (.hisaabo.in) requests get higher limits (own apps).
// External/third-party origins get strict limits.
// Unauthenticated external requests get the lowest tier.
const rateMap = new Map<string, { count: number; reset: number }>();

const CORS_ORIGINS = (process.env.CORS_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);

function isSameOrigin(c: Context): boolean {
  const origin = c.req.header("origin") || "";
  // Same-origin: no Origin header (server-side calls), or matches configured CORS origins
  if (!origin) return true;
  if (CORS_ORIGINS.some((allowed) => origin === allowed)) return true;
  // Match *.hisaabo.in subdomains
  if (/^https?:\/\/([a-z0-9-]+\.)?hisaabo\.in$/i.test(origin)) return true;
  return false;
}

// Rate limits per minute:
// Same-origin authenticated: 120 (normal app usage)
// Same-origin unauthenticated: 60 (login attempts, public pages)
// External authenticated: 60 (API consumers with valid session)
// External unauthenticated: 10 (prevent abuse from unknown sources)
app.use("/api/trpc/*", async (c: Context, next: Next) => {
  const ip = getClientIp(c);
  const hasSession = c.req.header("cookie")?.includes("session_id=")
    || c.req.header("authorization")?.startsWith("Bearer ");
  const sameOrigin = isSameOrigin(c);

  let limit: number;
  let tier: string;
  if (sameOrigin && hasSession) { limit = 120; tier = "same-auth"; }
  else if (sameOrigin) { limit = 60; tier = "same-anon"; }
  else if (hasSession) { limit = 60; tier = "ext-auth"; }
  else { limit = 10; tier = "ext-anon"; }

  const key = `${tier}:${ip}`;
  const now = Date.now();
  const entry = rateMap.get(key);
  if (!entry || now > entry.reset) {
    rateMap.set(key, { count: 1, reset: now + 60_000 });
  } else if (entry.count >= limit) {
    c.header("Retry-After", "60");
    return c.json({ error: "Too many requests" }, 429);
  } else {
    entry.count++;
  }
  await next();
});

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateMap) {
    if (now > entry.reset) rateMap.delete(key);
  }
}, 5 * 60_000).unref();

// ── Health check ───────────────────────────────────────────────
app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));
// ONCE health check — lenient during PG handover (rolling deploy)
app.get("/up", async (c) => {
  try {
    await controlDb.execute(sql`SELECT 1`);
    return c.text("OK", 200);
  } catch {
    // During rolling deploy, PG may be transitioning between containers.
    // Allow 30s grace period for the handover to complete.
    if (process.uptime() < 30) {
      return c.text("WARMING", 200);
    }
    return c.text("PG_DOWN", 503);
  }
});

async function generatePDFInWorker(data: any, format: "a5" | "a4" | "thermal"): Promise<Buffer> {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const jsPath = path.resolve(dir, "lib/pdf-worker.js");
  const fs = await import("node:fs");

  if (fs.existsSync(jsPath)) {
    // Production: built .js worker exists, run in a worker thread
    return new Promise((resolve, reject) => {
      const worker = new Worker(jsPath, { workerData: { data, format } });
      worker.on("message", resolve);
      worker.on("error", reject);
      worker.on("exit", (code) => {
        if (code !== 0) reject(new Error(`PDF worker exited with code ${code}`));
      });
    });
  }

  // Dev: no built worker, run in-process (tsx doesn't support worker threads well)
  const { generateInvoicePDF } = await import("./lib/invoice-pdf.js");
  return new Promise((resolve, reject) => {
    const doc = generateInvoicePDF(data, format);
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

// ── Shared auth helper for non-tRPC endpoints ─────────────────
function getSessionIdFromRequest(req: Request): string | null {
  const cookies = req.headers.get("cookie") || "";
  const match = cookies.match(/(?:^|;\s*)session_id=([^;]*)/);
  if (match) return decodeURIComponent(match[1]);
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

// ── PDF Download endpoint ──────────────────────────────────────
app.get("/api/invoices/:id/pdf", async (c) => {
  const invoiceId = c.req.param("id");
  const rawFormat = c.req.query("format") || "a5";
  // Accept legacy "a5-landscape" param from older clients and remap to "a5"
  const format = (rawFormat === "a5-landscape" ? "a5" : rawFormat) as "a5" | "a4" | "thermal";

  // Auth check — look up session in control DB
  const sessionId = getSessionIdFromRequest(c.req.raw);
  if (!sessionId) return c.json({ error: "Unauthorized" }, 401);

  const [sessionRow] = await controlDb
    .select({ userId: sessions.userId, tenantId: sessions.tenantId })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!sessionRow) return c.json({ error: "Unauthorized" }, 401);
  if (!sessionRow.tenantId) return c.json({ error: "No organization selected" }, 400);

  // Verify tenant is active
  const [tenant] = await controlDb.select({ status: tenants.status })
    .from(tenants).where(eq(tenants.id, sessionRow.tenantId)).limit(1);
  if (!tenant || tenant.status !== "active") return c.json({ error: "Organization suspended" }, 403);

  const businessId = c.req.header("x-business-id");
  if (!businessId) return c.json({ error: "No business selected" }, 400);

  // Get tenant DB for invoice data
  const db = await getTenantDb(sessionRow.tenantId);

  // Verify the business exists in this tenant (prevents cross-tenant access)
  const [bizCheck] = await db.select({ id: businesses.id })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!bizCheck) return c.json({ error: "Business not found" }, 403);

  // Fetch invoice with party and business
  const [invoice] = await db.select().from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.businessId, businessId))).limit(1);
  if (!invoice) return c.json({ error: "Invoice not found" }, 404);

  const [party] = await db.select().from(parties).where(eq(parties.id, invoice.partyId)).limit(1);
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  const lineItems = await db.select().from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, invoiceId)).orderBy(invoiceItems.sortOrder);

  // Fetch HSN codes for linked items
  const itemIds = lineItems.map(li => li.itemId).filter(Boolean) as string[];
  const itemHsns = itemIds.length > 0
    ? await db.select({ id: items.id, hsn: items.hsn }).from(items).where(inArray(items.id, itemIds))
    : [];
  const hsnMap = new Map(itemHsns.map(i => [i.id, i.hsn || ""]));

  // Fetch bank accounts for payment info on invoice
  const bizBankAccounts = await db.select().from(bankAccounts)
    .where(eq(bankAccounts.businessId, businessId))
    .orderBy(bankAccounts.isDefault);

  // Find UPI account and primary bank account
  const upiAccount = bizBankAccounts.find(a => a.accountType === "upi");
  const bankAccount = bizBankAccounts.find(a => a.accountType === "savings" || a.accountType === "current")
    || bizBankAccounts.find(a => a.isDefault);

  // Generate UPI QR code if UPI account exists and invoice is a sale with remaining balance
  let upiQrDataUrl: string | undefined;
  const upiId = upiAccount?.accountNumber; // UPI ID stored in accountNumber for UPI type
  if (upiId && invoice.type === "sale") {
    const balance = parseFloat(invoice.totalAmount) - parseFloat(invoice.amountPaid);
    if (balance > 0) {
      const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(biz.name)}&am=${balance.toFixed(2)}&cu=INR&tn=${encodeURIComponent(invoice.invoiceNumber)}`;
      upiQrDataUrl = await QRCode.toDataURL(upiUrl, { width: 200, margin: 1 });
    }
  }

  const pdfData: InvoicePDFData = {
    businessName: biz.name,
    businessLegalName: biz.legalName || undefined,
    businessGstin: biz.gstin || undefined,
    businessPan: biz.pan || undefined,
    businessPhone: biz.phone || undefined,
    businessEmail: biz.email || undefined,
    businessAddress: biz.address || undefined,
    businessCity: biz.city || undefined,
    businessState: biz.state || undefined,
    businessPincode: biz.pincode || undefined,
    partyName: party.name,
    partyPhone: party.phone || undefined,
    partyEmail: party.email || undefined,
    partyGstin: party.gstin || undefined,
    partyBillingAddress: party.billingAddress || undefined,
    partyCity: party.city || undefined,
    partyState: party.state || undefined,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate.toISOString(),
    dueDate: invoice.dueDate?.toISOString(),
    type: invoice.type,
    lineItems: lineItems.map((li) => ({
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      taxPercent: li.taxPercent,
      taxAmount: li.taxAmount,
      discountPercent: li.discountPercent,
      totalAmount: li.totalAmount,
    })),
    subtotal: invoice.subtotal,
    taxAmount: invoice.taxAmount,
    discountAmount: invoice.discountAmount,
    totalAmount: invoice.totalAmount,
    amountPaid: invoice.amountPaid,
    notes: invoice.notes || undefined,
    termsAndConditions: invoice.termsAndConditions || undefined,
    bankAccountName: bankAccount?.accountName || undefined,
    bankAccountNumber: bankAccount?.accountNumber || undefined,
    bankIfsc: bankAccount?.ifsc || undefined,
    bankName: bankAccount?.bankName || undefined,
    upiId: upiId || undefined,
    upiQrDataUrl,
    gstRegistrationType: biz.gstRegistrationType || "unregistered",
    businessStateCode: biz.stateCode || undefined,
    partyStateCode: party.stateCode || undefined,
    lineItemHsn: lineItems.map(li => li.itemId ? (hsnMap.get(li.itemId) || "") : ""),
  };

  const pdfBuffer = await generatePDFInWorker(pdfData, format);
  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoice.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf"`,
    },
  });
});

// ── Party Ledger PDF endpoint ─────────────────────────────────
// GET /api/parties/:id/ledger.pdf?from=...&to=...
app.get("/api/parties/:id/ledger.pdf", async (c) => {
  const partyId = c.req.param("id");

  // Auth check — same pattern as invoice PDF
  const sessionId = getSessionIdFromRequest(c.req.raw);
  if (!sessionId) return c.json({ error: "Unauthorized" }, 401);

  const [sessionRow] = await controlDb
    .select({ userId: sessions.userId, tenantId: sessions.tenantId })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!sessionRow) return c.json({ error: "Unauthorized" }, 401);
  if (!sessionRow.tenantId) return c.json({ error: "No organization selected" }, 400);

  const [tenant] = await controlDb.select({ status: tenants.status })
    .from(tenants).where(eq(tenants.id, sessionRow.tenantId)).limit(1);
  if (!tenant || tenant.status !== "active") return c.json({ error: "Organization suspended" }, 403);

  const businessId = c.req.header("x-business-id");
  if (!businessId) return c.json({ error: "No business selected" }, 400);

  const db = await getTenantDb(sessionRow.tenantId);

  // Verify the business exists in this tenant (prevents cross-tenant access)
  const [bizOwnerCheck] = await db.select({ id: businesses.id })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!bizOwnerCheck) return c.json({ error: "Business not found" }, 403);

  // Validate party belongs to this business
  const [party] = await db.select().from(parties)
    .where(and(eq(parties.id, partyId), eq(parties.businessId, businessId)))
    .limit(1);
  if (!party) return c.json({ error: "Party not found" }, 404);

  const [biz] = await db.select().from(businesses)
    .where(eq(businesses.id, businessId)).limit(1);
  if (!biz) return c.json({ error: "Business not found" }, 404);

  // Parse optional date range query params
  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");
  const fromDate = fromParam ? new Date(fromParam) : null;
  const toDate = toParam ? new Date(toParam) : null;

  // Build conditions for invoices and payments
  const invoiceConditions = [
    eq(invoices.partyId, partyId),
    eq(invoices.businessId, businessId),
    eq(invoices.documentType, "invoice"),
  ] as Parameters<typeof and>[0][];
  const paymentConditions = [
    eq(payments.partyId, partyId),
    eq(payments.businessId, businessId),
  ] as Parameters<typeof and>[0][];

  if (fromDate) {
    invoiceConditions.push(gte(invoices.invoiceDate, fromDate));
    paymentConditions.push(gte(payments.paymentDate, fromDate));
  }
  if (toDate) {
    invoiceConditions.push(lte(invoices.invoiceDate, toDate));
    paymentConditions.push(lte(payments.paymentDate, toDate));
  }

  const [partyInvoices, partyPayments] = await Promise.all([
    db.select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      date: invoices.invoiceDate,
      type: invoices.type,
      totalAmount: invoices.totalAmount,
      status: invoices.status,
    }).from(invoices).where(and(...invoiceConditions as [any, ...any[]])).orderBy(invoices.invoiceDate),
    db.select({
      id: payments.id,
      paymentNumber: payments.paymentNumber,
      date: payments.paymentDate,
      amount: payments.amount,
      mode: payments.mode,
    }).from(payments).where(and(...paymentConditions as [any, ...any[]])).orderBy(payments.paymentDate),
  ]);

  // Build ledger entries (same logic as ledgerReport tRPC procedure)
  const entries = [
    ...partyInvoices.map(inv => ({
      date: inv.date as Date,
      type: "invoice" as const,
      number: inv.invoiceNumber,
      description: inv.type === "sale" ? "Sale Invoice" : "Purchase Invoice",
      debit: inv.type === "sale" ? inv.totalAmount : "0",
      credit: inv.type === "sale" ? "0" : inv.totalAmount,
    })),
    ...partyPayments.map(pmt => ({
      date: pmt.date as Date,
      type: "payment" as const,
      number: pmt.paymentNumber || "",
      description: `Payment (${pmt.mode})`,
      debit: party.type === "supplier" ? pmt.amount : "0",
      credit: party.type === "supplier" ? "0" : pmt.amount,
    })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let runningBalance = party.openingBalance;
  const entriesWithBalance = entries.map(e => {
    runningBalance = money.add(money.sub(runningBalance, e.credit), e.debit);
    return { ...e, runningBalance };
  });

  const totalDebit = money.sum(entries.map(e => e.debit));
  const totalCredit = money.sum(entries.map(e => e.credit));
  const closingBalance = money.add(money.sub(party.openingBalance, totalCredit), totalDebit);

  const pdfBuffer = await generateLedgerPDF({
    businessName: biz.name,
    partyName: party.name,
    partyType: party.type,
    openingBalance: party.openingBalance,
    fromDate: fromParam || null,
    toDate: toParam || null,
    entries: entriesWithBalance,
    summary: { totalDebit, totalCredit, closingBalance },
  });

  const safePartyName = party.name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="ledger-${safePartyName}.pdf"`,
    },
  });
});

// ── Public Store API ─────────────────────────────────────────
// Slug resolution cache: slug → { tenantId, businessId, expires }
const slugCache = new Map<string, { tenantId: string; businessId: string; expires: number }>();

// ── Cloudflare Turnstile verification ────────────────────────
async function verifyTurnstile(token: string, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[turnstile] CRITICAL: TURNSTILE_SECRET_KEY not set in production!");
      return false;
    }
    return true; // Allow in dev
  }

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret,
      response: token,
      remoteip: ip || undefined,
    }),
  });
  const data = await res.json() as { success: boolean };
  return data.success;
}

// Rate limit for order placement: phone → { count, reset }
const orderRateMap = new Map<string, { count: number; reset: number }>();

// Clean stale order rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of orderRateMap) {
    if (now > entry.reset) orderRateMap.delete(key);
  }
}, 5 * 60_000).unref();

async function resolveStoreSlug(slug: string): Promise<{ tenantId: string; businessId: string } | null> {
  // Validate slug format
  if (!slug || !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) return null;

  const now = Date.now();
  const cached = slugCache.get(slug);
  if (cached && now < cached.expires) {
    return { tenantId: cached.tenantId, businessId: cached.businessId };
  }

  const isMultiTenant = process.env.MULTI_TENANT === "true";

  if (!isMultiTenant) {
    // Self-hosted: single tenant DB — query directly
    const db = await getTenantDb("single");
    const [biz] = await db.select({ id: businesses.id })
      .from(businesses)
      .where(and(eq(businesses.storeSlug, slug), eq(businesses.storeEnabled, true)))
      .limit(1);

    if (!biz) return null;

    const resolved = { tenantId: "single", businessId: biz.id };
    slugCache.set(slug, { ...resolved, expires: now + 5 * 60_000 });
    return resolved;
  }

  // Multi-tenant: scan all active tenants to find the business with this slug
  const activeTenants = await controlDb
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.status, "active"));

  for (const tenant of activeTenants) {
    try {
      const db = await getTenantDb(tenant.id);
      const [biz] = await db.select({ id: businesses.id })
        .from(businesses)
        .where(and(eq(businesses.storeSlug, slug), eq(businesses.storeEnabled, true)))
        .limit(1);

      if (biz) {
        const resolved = { tenantId: tenant.id, businessId: biz.id };
        slugCache.set(slug, { ...resolved, expires: now + 5 * 60_000 });
        return resolved;
      }
    } catch {
      // Skip tenants with DB connectivity issues
    }
  }

  return null;
}

// Helper: get tenant DB for a resolved slug context
async function getStoreDb(tenantId: string) {
  // In self-hosted, tenantId is always "single"
  const isMultiTenant = process.env.MULTI_TENANT === "true";
  return getTenantDb(isMultiTenant ? tenantId : "single");
}

// GET /store/:slug/catalog.json — public item catalog
app.get("/store/:slug/catalog.json", async (c) => {
  const slug = c.req.param("slug");
  const resolved = await resolveStoreSlug(slug);
  if (!resolved) return c.json({ error: "Store not found" }, 404);

  const db = await getStoreDb(resolved.tenantId);

  const [biz] = await db.select({
    id: businesses.id,
    name: businesses.name,
    storeTagline: businesses.storeTagline,
    storeAccentColor: businesses.storeAccentColor,
    storeMinOrderAmount: businesses.storeMinOrderAmount,
    storeDeliveryNote: businesses.storeDeliveryNote,
    storeWhatsappNumber: businesses.storeWhatsappNumber,
    storeAllowNegativeStock: businesses.storeAllowNegativeStock,
    currency: businesses.currency,
    phone: businesses.phone,
    email: businesses.email,
    city: businesses.city,
    state: businesses.state,
    address: businesses.address,
  }).from(businesses)
    .where(and(eq(businesses.id, resolved.businessId), eq(businesses.storeEnabled, true)))
    .limit(1);

  if (!biz) return c.json({ error: "Store not found" }, 404);

  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "24", 10)));
  const category = c.req.query("category");
  const search = c.req.query("search");
  const offset = (page - 1) * limit;

  const conditions = [
    eq(items.businessId, resolved.businessId),
    eq(items.storeEnabled, true),
  ];
  if (category) conditions.push(eq(sql`COALESCE(${items.storeCategory}, ${items.category})`, category));
  if (search) conditions.push(sql`${items.name} ILIKE ${"%" + search + "%"}`);

  // NEVER expose: purchasePrice, exact stockQuantity, hsn, sku, or internal business fields
  const [catalog, [{ total }]] = await Promise.all([
    db.select({
      id: items.id,
      name: items.name,
      description: sql<string | null>`COALESCE(${items.storeDescription}, ${items.description})`,
      price: sql<string | null>`COALESCE(${items.storePrice}, ${items.salePrice})`,
      unit: items.unit,
      category: sql<string | null>`COALESCE(${items.storeCategory}, ${items.category})`,
      taxPercent: items.taxPercent,
      taxInclusive: items.taxInclusive,
      inStock: sql<boolean>`(${items.stockQuantity})::numeric > 0`,
      stockQty: items.stockQuantity,
      sortOrder: items.storeSortOrder,
      itemMode: items.itemMode,
      unitVariants: items.unitVariants,
      variantAttributes: items.variantAttributes,
    }).from(items)
      .where(and(...conditions))
      .orderBy(items.storeSortOrder, items.name)
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(items)
      .where(and(...conditions)),
  ]);

  // Fetch store-enabled variants for any variant-mode items in this page
  const variantItemIds = catalog
    .filter((i) => i.itemMode === "variants")
    .map((i) => i.id);

  const variantRows = variantItemIds.length > 0
    ? await db.select({
        id: itemVariants.id,
        itemId: itemVariants.itemId,
        attributeValues: itemVariants.attributeValues,
        salePrice: itemVariants.salePrice,
        storePrice: itemVariants.storePrice,
        stockQuantity: itemVariants.stockQuantity,
        storeEnabled: itemVariants.storeEnabled,
      }).from(itemVariants)
        .where(and(
          inArray(itemVariants.itemId, variantItemIds),
          eq(itemVariants.storeEnabled, true),
        ))
    : [];

  // Group variants by parent item
  const variantsByItem = new Map<string, typeof variantRows>();
  for (const v of variantRows) {
    const arr = variantsByItem.get(v.itemId) || [];
    arr.push(v);
    variantsByItem.set(v.itemId, arr);
  }

  const categories = [...new Set(
    catalog.map((i) => i.category).filter(Boolean) as string[]
  )];

  // When allowNegativeStock is on, out-of-stock items show as "low stock" instead of hidden
  const allowNeg = biz.storeAllowNegativeStock;
  const transformedItems = catalog
    .filter((item) => {
      // Variant items must have at least one store-enabled variant to appear
      if (item.itemMode === "variants") {
        const variants = variantsByItem.get(item.id);
        return variants && variants.length > 0;
      }
      return true;
    })
    .map(({ stockQty, unitVariants: rawUnitVariants, variantAttributes: rawVarAttrs, ...rest }) => {
      const base = {
        ...rest,
        inStock: rest.inStock || allowNeg,
        lowStock: allowNeg && !rest.inStock,
      };

      if (rest.itemMode === "alt_units" && rawUnitVariants) {
        // Expose unit variants with store-safe prices only
        return {
          ...base,
          unitVariants: rawUnitVariants.map((uv) => ({
            unit: uv.unit,
            conversionFactor: uv.conversionFactor,
            price: uv.salePrice,
          })),
        };
      }

      if (rest.itemMode === "variants") {
        const variants = variantsByItem.get(rest.id) || [];
        const variantData = variants.map((v) => ({
          id: v.id,
          attributes: v.attributeValues,
          price: v.storePrice ?? v.salePrice ?? "0",
          inStock: parseFloat(v.stockQuantity) > 0 || allowNeg,
        }));
        // Price = lowest variant price (for display/sorting)
        const prices = variantData.map((v) => parseFloat(v.price));
        const lowestPrice = prices.length > 0 ? Math.min(...prices).toFixed(2) : base.price;
        // inStock = true if ANY variant is in stock
        const anyInStock = variantData.some((v) => v.inStock);

        return {
          ...base,
          price: lowestPrice,
          inStock: anyInStock,
          lowStock: allowNeg && !anyInStock,
          variantAttributes: rawVarAttrs || [],
          variants: variantData,
        };
      }

      return base;
    });

  return c.json(
    {
      business: {
        name: biz.name,
        tagline: biz.storeTagline,
        accentColor: biz.storeAccentColor,
        minOrderAmount: biz.storeMinOrderAmount,
        deliveryNote: biz.storeDeliveryNote,
        whatsappNumber: biz.storeWhatsappNumber,
        currency: biz.currency,
        phone: biz.phone,
        email: biz.email,
        city: biz.city,
        state: biz.state,
        address: biz.address,
      },
      items: transformedItems,
      categories,
      total,
      page,
      limit,
    },
    200,
    { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  );
});

// POST /store/:slug/identify — phone-first customer identification (public, no auth)
app.post("/store/:slug/identify", async (c) => {
  const slug = c.req.param("slug");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body || typeof body !== "object") {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const { phone, turnstileToken } = body as Record<string, unknown>;

  if (typeof phone !== "string" || typeof turnstileToken !== "string") {
    return c.json({ error: "phone and turnstileToken are required" }, 400);
  }

  // Validate Turnstile
  const ip = getClientIp(c) || null;
  const valid = await verifyTurnstile(turnstileToken, ip);
  if (!valid) return c.json({ error: "Verification failed" }, 403);

  // Resolve slug → business
  const resolved = await resolveStoreSlug(slug);
  if (!resolved) return c.json({ error: "Store not found" }, 404);

  const db = await getStoreDb(resolved.tenantId);

  // Normalize to last 10 digits (strip +91, spaces, dashes)
  const normalizedPhone = phone.replace(/\D/g, "").slice(-10);

  const [party] = await db.select({ name: parties.name })
    .from(parties)
    .where(and(
      eq(parties.businessId, resolved.businessId),
      sql`REPLACE(REPLACE(${parties.phone}, '+91', ''), ' ', '') LIKE '%' || ${normalizedPhone}`,
    ))
    .limit(1);

  if (party) {
    // Return first name only — don't expose full name to public endpoint
    const firstName = party.name.split(" ")[0];
    return c.json({ known: true, name: firstName });
  }

  return c.json({ known: false });
});

// POST /store/:slug/order — place an order (public, no auth)
app.post("/store/:slug/order", async (c) => {
  const slug = c.req.param("slug");

  // Parse and validate body
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body || typeof body !== "object") {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const {
    turnstileToken: orderTurnstileToken,
    customerName,
    customerPhone,
    customerEmail,
    deliveryAddress,
    deliveryCity,
    deliveryPincode,
    notes,
    items: orderItems,
  } = body as Record<string, unknown>;

  // Validate Turnstile for order submission
  const orderIp = getClientIp(c) || null;
  const turnstileValid = await verifyTurnstile(
    typeof orderTurnstileToken === "string" ? orderTurnstileToken : "",
    orderIp,
  );
  if (!turnstileValid) return c.json({ error: "Verification failed. Please try again." }, 403);

  // Basic validation
  if (typeof customerName !== "string" || customerName.trim().length < 2) {
    return c.json({ error: "customerName is required (min 2 chars)" }, 400);
  }
  if (typeof customerPhone !== "string" || !/^[6-9]\d{9}$/.test(customerPhone)) {
    return c.json({ error: "customerPhone must be a valid 10-digit Indian mobile number" }, 400);
  }
  if (!Array.isArray(orderItems) || orderItems.length === 0) {
    return c.json({ error: "items array is required and must not be empty" }, 400);
  }
  for (const it of orderItems) {
    if (typeof it !== "object" || it === null) return c.json({ error: "Invalid item in items array" }, 400);
    const item = it as Record<string, unknown>;
    if (typeof item.itemId !== "string") return c.json({ error: "Each item must have an itemId" }, 400);
    const qty = Number(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0) return c.json({ error: "Each item must have a positive quantity" }, 400);
    // Optional variant/unit fields
    if (item.variantId !== undefined && typeof item.variantId !== "string") return c.json({ error: "variantId must be a string" }, 400);
    if (item.selectedUnit !== undefined && typeof item.selectedUnit !== "string") return c.json({ error: "selectedUnit must be a string" }, 400);
    if (item.conversionFactor !== undefined && (!Number.isFinite(Number(item.conversionFactor)) || Number(item.conversionFactor) <= 0)) {
      return c.json({ error: "conversionFactor must be a positive number" }, 400);
    }
  }

  // Rate limit: 5 orders per phone per minute
  const now = Date.now();
  const rateKey = `order:${customerPhone}`;
  const rateEntry = orderRateMap.get(rateKey);
  if (!rateEntry || now > rateEntry.reset) {
    orderRateMap.set(rateKey, { count: 1, reset: now + 60_000 });
  } else if (rateEntry.count >= 5) {
    return c.json({ error: "Too many orders. Please wait a moment before trying again." }, 429);
  } else {
    rateEntry.count++;
  }

  // Resolve business
  const resolved = await resolveStoreSlug(slug);
  if (!resolved) return c.json({ error: "Store not found" }, 404);

  const db = await getStoreDb(resolved.tenantId);

  const [biz] = await db.select({
    id: businesses.id,
    name: businesses.name,
    storeEnabled: businesses.storeEnabled,
    storeMinOrderAmount: businesses.storeMinOrderAmount,
    invoicePrefix: businesses.invoicePrefix,
    nextInvoiceNumber: businesses.nextInvoiceNumber,
    storeOrderPrefix: businesses.storeOrderPrefix,
    nextStoreOrderNumber: businesses.nextStoreOrderNumber,
    currency: businesses.currency,
  }).from(businesses)
    .where(and(eq(businesses.id, resolved.businessId), eq(businesses.storeEnabled, true)))
    .limit(1);

  if (!biz) return c.json({ error: "Store not found" }, 404);

  // Validate items exist and are store-enabled
  type OrderItemInput = { itemId: string; quantity: number; variantId?: string; selectedUnit?: string; conversionFactor?: number };
  const itemIds = (orderItems as OrderItemInput[]).map((i) => i.itemId);
  const foundItems = await db.select({
    id: items.id,
    name: items.name,
    storeEnabled: items.storeEnabled,
    storePrice: items.storePrice,
    salePrice: items.salePrice,
    taxPercent: items.taxPercent,
    taxInclusive: items.taxInclusive,
    stockQuantity: items.stockQuantity,
    unit: items.unit,
    itemMode: items.itemMode,
    unitVariants: items.unitVariants,
  }).from(items)
    .where(and(
      inArray(items.id, itemIds),
      eq(items.businessId, resolved.businessId),
      eq(items.storeEnabled, true),
    ));

  if (foundItems.length !== [...new Set(itemIds)].length) {
    return c.json({ error: "One or more items are not available in this store" }, 400);
  }

  const itemMap = new Map(foundItems.map((i) => [i.id, i]));

  // Pre-fetch all referenced variants for variant-mode items
  const requestedVariantIds = (orderItems as OrderItemInput[])
    .filter((oi) => oi.variantId)
    .map((oi) => oi.variantId!);

  const foundVariants = requestedVariantIds.length > 0
    ? await db.select({
        id: itemVariants.id,
        itemId: itemVariants.itemId,
        salePrice: itemVariants.salePrice,
        storePrice: itemVariants.storePrice,
        stockQuantity: itemVariants.stockQuantity,
        storeEnabled: itemVariants.storeEnabled,
        attributeValues: itemVariants.attributeValues,
      }).from(itemVariants)
        .where(and(
          inArray(itemVariants.id, requestedVariantIds),
          eq(itemVariants.storeEnabled, true),
        ))
    : [];

  const variantMap = new Map(foundVariants.map((v) => [v.id, v]));

  // Build line items for calculation — validate variants and alt units
  const lineItemInputs: Array<{
    itemId: string; quantity: string; unitPrice: string; taxPercent: string;
    discountPercent: string; taxInclusive: boolean; name: string; unit: string;
    selectedUnit?: string; conversionFactor?: string; variantId?: string;
  }> = [];

  for (const oi of orderItems as OrderItemInput[]) {
    const item = itemMap.get(oi.itemId)!;
    let price = item.storePrice ?? item.salePrice ?? "0";
    let description = item.name;
    let selectedUnit: string | undefined;
    let conversionFactor: string | undefined;
    let variantId: string | undefined;

    if (item.itemMode === "variants" && oi.variantId) {
      // Validate variant exists and belongs to this item
      const variant = variantMap.get(oi.variantId);
      if (!variant || variant.itemId !== oi.itemId) {
        return c.json({ error: `Variant is not available for item "${item.name}"` }, 400);
      }
      price = variant.storePrice ?? variant.salePrice ?? price;
      variantId = oi.variantId;
      // Build variant label: "Item Name - Size: M, Color: Red"
      const attrLabel = Object.entries(variant.attributeValues).map(([k, v]) => `${k}: ${v}`).join(", ");
      description = `${item.name} - ${attrLabel}`;
    } else if (item.itemMode === "alt_units" && oi.selectedUnit) {
      // Validate unit exists in item's unitVariants
      const uv = item.unitVariants?.find((u) => u.unit === oi.selectedUnit);
      if (!uv) {
        return c.json({ error: `Unit "${oi.selectedUnit}" is not available for item "${item.name}"` }, 400);
      }
      price = uv.salePrice;
      selectedUnit = oi.selectedUnit;
      conversionFactor = String(uv.conversionFactor);
    }

    lineItemInputs.push({
      itemId: oi.itemId,
      quantity: String(oi.quantity),
      unitPrice: price,
      taxPercent: item.taxPercent || "0",
      discountPercent: "0",
      taxInclusive: item.taxInclusive,
      name: description,
      unit: item.unit,
      selectedUnit,
      conversionFactor,
      variantId,
    });
  }

  // Calculate totals using shared library
  const totals = calcInvoiceTotals({
    lineItems: lineItemInputs.map((li) => ({
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      taxPercent: li.taxPercent,
      discountPercent: li.discountPercent,
      taxInclusive: li.taxInclusive,
    })),
  });

  // Check minimum order amount
  if (biz.storeMinOrderAmount) {
    const minAmount = parseFloat(biz.storeMinOrderAmount);
    const orderTotal = parseFloat(totals.total);
    if (orderTotal < minAmount) {
      return c.json({
        error: `Minimum order amount is ${biz.currency} ${biz.storeMinOrderAmount}`,
      }, 400);
    }
  }

  // Atomic transaction: increment counters, create invoice + line items + store order
  try {
    const result = await db.transaction(async (tx) => {
      // Lock and increment business counters atomically
      const [bizLocked] = await tx.select({
        invoicePrefix: businesses.invoicePrefix,
        nextInvoiceNumber: businesses.nextInvoiceNumber,
        storeOrderPrefix: businesses.storeOrderPrefix,
        nextStoreOrderNumber: businesses.nextStoreOrderNumber,
      }).from(businesses)
        .where(eq(businesses.id, resolved.businessId))
        .for("update");

      const invoiceNumber = `${bizLocked.invoicePrefix}-${String(bizLocked.nextInvoiceNumber).padStart(5, "0")}`;
      const orderNumber = `${bizLocked.storeOrderPrefix}-${String(bizLocked.nextStoreOrderNumber).padStart(5, "0")}`;

      await tx.update(businesses)
        .set({
          nextInvoiceNumber: bizLocked.nextInvoiceNumber + 1,
          nextStoreOrderNumber: bizLocked.nextStoreOrderNumber + 1,
        })
        .where(eq(businesses.id, resolved.businessId));

      // Find or create a "Walk-in Customer" party for online store orders
      let walkinPartyId: string;
      const [existingWalkin] = await tx.select({ id: parties.id })
        .from(parties)
        .where(and(
          eq(parties.businessId, resolved.businessId),
          eq(parties.name, "Walk-in Customer"),
          eq(parties.type, "customer"),
        ))
        .limit(1);

      if (existingWalkin) {
        walkinPartyId = existingWalkin.id;
      } else {
        const [newWalkin] = await tx.insert(parties).values({
          businessId: resolved.businessId,
          type: "customer",
          name: "Walk-in Customer",
          source: "online_store",
        }).returning({ id: parties.id });
        walkinPartyId = newWalkin.id;
      }

      // Create unfulfilled invoice (online store order awaiting fulfillment)
      const [invoice] = await tx.insert(invoices).values({
        businessId: resolved.businessId,
        partyId: walkinPartyId,
        type: "sale",
        status: "unfulfilled",
        documentType: "invoice",
        invoiceNumber,
        invoiceDate: new Date(),
        subtotal: totals.subtotal,
        taxAmount: totals.taxTotal,
        discountAmount: "0",
        additionalCharges: "0",
        roundOff: "0",
        totalAmount: totals.total,
        amountPaid: "0",
        notes: typeof notes === "string" ? notes : null,
        source: "online_store",
      }).returning();

      // Create invoice line items
      const processedLineItems = lineItemInputs.map((li, idx) => {
        const calc = calcLineItem({
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          taxPercent: li.taxPercent,
          discountPercent: li.discountPercent,
          taxInclusive: li.taxInclusive,
        });
        return {
          invoiceId: invoice.id,
          itemId: li.itemId,
          description: li.name,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          taxPercent: li.taxPercent,
          taxAmount: calc.taxAmount,
          discountPercent: "0",
          totalAmount: calc.total,
          sortOrder: idx,
          conversionFactor: li.conversionFactor ?? "1",
          selectedUnit: li.selectedUnit ?? null,
          variantId: li.variantId ?? null,
        };
      });

      await tx.insert(invoiceItems).values(processedLineItems);

      // Stock adjustment: separate items vs variants
      const itemStockMap = new Map<string, number>();
      const variantStockMap = new Map<string, number>();
      for (const li of lineItemInputs) {
        if (li.variantId) {
          variantStockMap.set(li.variantId, (variantStockMap.get(li.variantId) || 0) + parseFloat(li.quantity));
        } else {
          const factor = li.conversionFactor ? parseFloat(li.conversionFactor) : 1;
          itemStockMap.set(li.itemId, (itemStockMap.get(li.itemId) || 0) + parseFloat(li.quantity) * factor);
        }
      }

      // Acquire row-level locks before writing stock to prevent concurrent order races.
      const itemIdsToLock = [...itemStockMap.keys()];
      if (itemIdsToLock.length > 0) {
        await tx.select({ id: items.id, stockQuantity: items.stockQuantity })
          .from(items)
          .where(inArray(items.id, itemIdsToLock))
          .for("update");
      }
      const variantIdsToLock = [...variantStockMap.keys()];
      if (variantIdsToLock.length > 0) {
        await tx.select({ id: itemVariants.id, stockQuantity: itemVariants.stockQuantity })
          .from(itemVariants)
          .where(inArray(itemVariants.id, variantIdsToLock))
          .for("update");
      }

      for (const [itemId, totalQty] of itemStockMap) {
        await tx.update(items).set({
          stockQuantity: sql`${items.stockQuantity}::numeric - ${totalQty.toFixed(3)}::numeric`,
          updatedAt: new Date(),
        }).where(eq(items.id, itemId));
      }
      for (const [variantId, totalQty] of variantStockMap) {
        await tx.update(itemVariants).set({
          stockQuantity: sql`${itemVariants.stockQuantity}::numeric - ${totalQty.toFixed(3)}::numeric`,
          updatedAt: new Date(),
        }).where(eq(itemVariants.id, variantId));
      }

      // Create the store order record
      const [order] = await tx.insert(storeOrders).values({
        businessId: resolved.businessId,
        invoiceId: invoice.id,
        orderNumber,
        status: "pending",
        customerName: customerName.trim(),
        customerPhone,
        customerEmail: typeof customerEmail === "string" ? customerEmail.trim() || null : null,
        deliveryAddress: typeof deliveryAddress === "string" ? deliveryAddress.trim() || null : null,
        deliveryCity: typeof deliveryCity === "string" ? deliveryCity.trim() || null : null,
        deliveryPincode: typeof deliveryPincode === "string" ? deliveryPincode.trim() || null : null,
        deliveryNotes: typeof notes === "string" ? notes.trim() || null : null,
        totalAmount: totals.total,
        itemCount: lineItemInputs.length,
        source: "online_store",
      }).returning();

      return { order, invoice };
    });

    return c.json({
      orderId: result.order.id,
      orderNumber: result.order.orderNumber,
      totalAmount: result.order.totalAmount,
      message: "Order placed successfully! The business will confirm shortly.",
    }, 201);
  } catch (err) {
    console.error("[store/order] Failed to create order:", err);
    return c.json({ error: "Failed to place order. Please try again." }, 500);
  }
});

// ── tRPC handler ───────────────────────────────────────────────
app.use("/api/trpc/*", async (c) => {
  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
    onError({ error, path }) {
      if (error.code === "INTERNAL_SERVER_ERROR") {
        console.error(`[tRPC] ${path}:`, error);
      }
    },
  });
  return response;
});

// ── Session cleanup (FINDING 7) ────────────────────────────────
// Clean up expired sessions every hour — unref so it doesn't keep process alive
const cleanupTimer = setInterval(async () => {
  try {
    await controlDb.delete(sessions).where(lt(sessions.expiresAt, new Date()));
    await controlDb.delete(magicLinkTokens).where(lt(magicLinkTokens.expiresAt, new Date()));
  } catch (e) {
    console.error("[session-cleanup] Failed:", e);
  }
}, 60 * 60 * 1000);
cleanupTimer.unref();

// ── Branded HTML pages ────────────────────────────────────────
function brandedHtml(title: string, heading: string, message: string, status: number) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Hisaabo</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'DM Sans', system-ui, sans-serif; background: #f8f9fa; color: #1a1a2e; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { text-align: center; padding: 2rem; }
    .logo { width: 48px; height: 48px; border-radius: 14px; background: #5b5bd6; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 1.5rem; }
    .logo span { color: white; font-weight: 700; font-size: 22px; }
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; color: #1a1a2e; }
    p { color: #6b7280; font-size: 0.9rem; line-height: 1.6; max-width: 400px; margin: 0 auto; }
    .status { font-size: 4rem; font-weight: 800; color: #5b5bd6; opacity: 0.15; margin-bottom: -0.5rem; }
    a { color: #5b5bd6; text-decoration: none; font-weight: 500; }
    a:hover { text-decoration: underline; }
    .links { margin-top: 1.5rem; display: flex; gap: 1.5rem; justify-content: center; font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo"><span>H</span></div>
    ${status >= 400 ? `<div class="status">${status}</div>` : ""}
    <h1>${heading}</h1>
    <p>${message}</p>
    <div class="links">
      <a href="https://hisaabo.in">hisaabo.in</a>
      <a href="https://github.com/hisaabo">GitHub</a>
      <a href="/health">API Status</a>
    </div>
  </div>
</body>
</html>`;
}

// Base page — shows when someone visits the API root
app.get("/", (c) => {
  return c.html(brandedHtml(
    "API",
    "Hisaabo API",
    "Professional billing for Indian businesses. This is the API server — the web app is at <a href=\"https://app.hisaabo.in\">app.hisaabo.in</a>",
    200,
  ));
});

// 404 handler — catch-all for unmatched routes
app.notFound((c) => {
  // Return JSON for API-like paths
  if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/store/")) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.html(brandedHtml(
    "Not Found",
    "Page not found",
    "The page you're looking for doesn't exist. If you're looking for the Hisaabo app, visit <a href=\"https://app.hisaabo.in\">app.hisaabo.in</a>",
    404,
  ), 404);
});

// ── Start ──────────────────────────────────────────────────────
const port = parseInt(process.env.PORT || "3000", 10);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Hisaabo API running on http://localhost:${info.port}`);
  console.log(`  tRPC endpoint: http://localhost:${info.port}/api/trpc`);
});

// ── Graceful shutdown ─────────────────────────────────────────
function shutdown(signal: string) {
  console.log(`\n[${signal}] Shutting down...`);
  server.close(() => {
    console.log("[shutdown] HTTP server closed");
    process.exit(0);
  });
  // Force kill if server doesn't close within 5 seconds
  setTimeout(() => {
    console.error("[shutdown] Forced exit after timeout");
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
