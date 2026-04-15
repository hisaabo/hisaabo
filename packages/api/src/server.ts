import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import type { Context, Next } from "hono";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { eq, and, gt, lt, gte, lte, inArray, isNull, sql } from "drizzle-orm";
import { escapeLike } from "./lib/escape-like.js";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import QRCode from "qrcode";
import { appRouter } from "./router.js";
import { createContext, getSessionIdFromRequest } from "./context.js";
import type { InvoicePDFData } from "./lib/invoice-pdf.js";
import { generateLedgerPDF } from "./lib/ledger-pdf.js";
import { controlDb, getTenantDb, invoices, invoiceItems, items, itemVariants, parties, businesses, sessions, tenants, tenantMembers, magicLinkTokens, bankAccounts, storeOrders, payments, assertMigrationsPresent } from "@hisaabo/db";
import { calcLineItem, calcInvoiceTotals, money } from "@hisaabo/shared";
import { verifyTurnstile } from "./lib/turnstile.js";
import { startRecurringScheduler, stopRecurringScheduler } from "./lib/recurring-invoice-scheduler.js";
import { logger } from "./lib/logger.js";
import { validateEnv } from "./lib/env.js";
import { createCsrfMiddleware } from "./lib/csrf-middleware.js";
import { registerExportRoute } from "./http/exportStream.js";
import { registerImportRoute } from "./http/importStream.js";

// ── Process crash handlers ────────────────────────────────────
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection — shutting down");
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception — shutting down");
  process.exit(1);
});

// ── Environment validation ────────────────────────────────────
validateEnv();

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const app = new Hono();

// ── Security headers ───────────────────────────────────────────
app.use("*", secureHeaders());

// ── Request ID tracing ────────────────────────────────────────
app.use("*", async (c: Context, next: Next) => {
  const raw = c.req.header("x-request-id");
  const requestId = (raw && raw.length <= 128) ? raw.replace(/[^a-zA-Z0-9\-_]/g, "") : randomUUID();
  c.set("requestId", requestId);
  c.header("x-request-id", requestId);
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  logger.info({
    requestId,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration,
  }, `${c.req.method} ${c.req.path} ${c.res.status} ${duration}ms`);
});

// ── CORS ───────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173").split(",");

app.use("*", cors({
  origin: allowedOrigins,
  credentials: true,
  allowHeaders: ["Content-Type", "x-business-id", "Authorization", "X-Requested-With", "X-Hisaabo-Client"],
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
// Same-origin authenticated: 300 (normal app usage — higher to accommodate
//   post-import cache invalidation bursts and dashboard queries)
// Same-origin unauthenticated: 60 (login attempts, public pages)
// External authenticated: 120 (API consumers with valid session)
// External unauthenticated: 10 (prevent abuse from unknown sources)
app.use("/api/trpc/*", bodyLimit({ maxSize: 10 * 1024 * 1024 }));
app.use("/api/trpc/*", async (c: Context, next: Next) => {
  const ip = getClientIp(c);
  const hasSession = c.req.header("cookie")?.includes("session_id=")
    || c.req.header("authorization")?.startsWith("Bearer ");
  const sameOrigin = isSameOrigin(c);

  let limit: number;
  let tier: string;
  if (sameOrigin && hasSession) { limit = 300; tier = "same-auth"; }
  else if (sameOrigin) { limit = 60; tier = "same-anon"; }
  else if (hasSession) { limit = 120; tier = "ext-auth"; }
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

// ── CSRF protection (non-tRPC routes) ─────────────────────────
// State-changing requests authenticated via cookies must include the
// `X-Requested-With: hisaabo` header. This blocks cross-origin form
// submissions and navigation-based CSRF attacks.
//
// Scope:
//   - tRPC routes (/api/trpc/*) are intentionally skipped here and
//     gated by a matching tRPC-level middleware in `trpc.ts`. Doing
//     the rejection at the tRPC layer means the client receives a
//     real `TRPCError` envelope (shaped by superjson) instead of a
//     Hono `{error: "…"}` blob that the tRPC HTTP link cannot parse
//     — the latter was the root cause of the Android "Unable to
//     transform response from server" regression.
//   - Non-tRPC routes (store REST endpoints, webhooks, etc.) still
//     get the plain Hono 403 shape, which their clients expect.
//
// Bearer-authenticated requests are exempt because:
//   1. Bearer tokens are not vulnerable to CSRF — they live in
//      client-controlled storage, not browser cookies, so a hostile
//      origin cannot forge a request that carries them.
//   2. React Native's native HTTP stack maintains a per-app cookie
//      jar that replays stale `session_id` cookies on every request
//      even when the JS tRPC client never set them. Without this
//      bypass the mobile app would be locked out after its first
//      successful magic-link verification.
//
// GET/HEAD/OPTIONS are exempt by HTTP convention (side-effect-free).
app.use("*", createCsrfMiddleware());

// ── Health check ───────────────────────────────────────────────
// ── UPI payment redirect ──────────────────────────────────────
// HTTPS endpoint that redirects to upi:// deep link.
// Used in PDF QR codes — PDF viewers won't open upi:// directly
// but will open https:// links which then redirect to the UPI app.
app.get("/pay/upi", async (c) => {
  const pa = c.req.query("pa");
  const pn = c.req.query("pn");
  const am = c.req.query("am");
  const tn = c.req.query("tn");
  if (!pa || !am) return c.text("Missing payment parameters", 400);

  const upiUrl = `upi://pay?pa=${encodeURIComponent(pa)}&pn=${encodeURIComponent(pn || "")}&am=${encodeURIComponent(am)}&cu=INR&tn=${encodeURIComponent(tn || "")}`;

  // Generate QR code for desktop view
  const qrDataUrl = await QRCode.toDataURL(upiUrl, { width: 280, margin: 2 });

  // Responsive page: mobile auto-redirects to UPI app, desktop shows QR to scan
  return c.html(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pay ${escapeHtml(pn || pa)} \u20B9${escapeHtml(am)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8f9fa;color:#1a1a2e;padding:1rem}
  .card{text-align:center;max-width:380px;width:100%;background:#fff;border-radius:16px;padding:2rem 1.5rem;box-shadow:0 2px 16px rgba(0,0,0,0.06)}
  .icon{width:48px;height:48px;margin:0 auto 1rem;background:#eef2ff;border-radius:12px;display:flex;align-items:center;justify-content:center}
  .icon svg{width:24px;height:24px;color:#5046e5}
  .to{font-size:.9rem;color:#666;margin-bottom:.25rem}
  .amount{font-size:2.25rem;font-weight:700;color:#1a1a2e;margin-bottom:1.5rem;letter-spacing:-0.02em}
  .pay-btn{display:inline-block;background:#5046e5;color:#fff;padding:.875rem 2.5rem;border-radius:10px;text-decoration:none;font-weight:600;font-size:1rem;transition:background .15s}
  .pay-btn:active{background:#3d35c4}
  .qr{margin:1.5rem auto 0;padding:1rem;background:#fff;border-radius:12px;border:1px solid #eee;display:inline-block}
  .qr img{display:block;width:200px;height:200px}
  .scan-text{margin-top:.75rem;font-size:.8rem;color:#999}
  .mobile-only{display:none}
  .desktop-only{display:block}
  @media(max-width:768px){
    .mobile-only{display:block}
    .desktop-only{display:none}
  }
</style>
</head><body>
<div class="card">
  <div class="icon"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4"/></svg></div>
  <div class="to">Pay ${escapeHtml(pn || pa)}</div>
  <div class="amount">\u20B9${escapeHtml(am)}</div>

  <div class="mobile-only">
    <a class="pay-btn" href="${upiUrl}">Pay with UPI</a>
  </div>

  <div class="desktop-only">
    <div class="qr"><img src="${qrDataUrl}" alt="UPI QR Code" width="200" height="200"></div>
    <p class="scan-text">Scan with any UPI app to pay</p>
  </div>
</div>
</body></html>`);
});

app.get("/health", async (c) => {
  const deep = c.req.query("deep") === "true";
  const result: Record<string, unknown> = { status: "ok", timestamp: new Date().toISOString() };

  if (deep) {
    try {
      await controlDb.execute(sql`SELECT 1`);
      result.db = "ok";
    } catch {
      result.status = "degraded";
      result.db = "error";
    }
  }

  return c.json(result, result.status === "ok" ? 200 : 503);
});
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

// ── PDF worker concurrency limiter ────────────────────────────
// Cap concurrent PDF worker threads to prevent CPU saturation under load.
class Semaphore {
  private queue: Array<{ resolve: () => void; timer: ReturnType<typeof setTimeout> }> = [];
  private active = 0;
  constructor(private max: number, private timeoutMs = 30_000) {}
  async acquire(): Promise<void> {
    if (this.active < this.max) { this.active++; return; }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex(e => e.timer === timer);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(new Error("Semaphore acquire timed out"));
      }, this.timeoutMs);
      this.queue.push({ resolve, timer });
    });
  }
  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) { clearTimeout(next.timer); this.active++; next.resolve(); }
  }
}

const pdfSemaphore = new Semaphore(os.cpus().length);

async function generatePDFInWorker(data: any, format: "a5" | "a4" | "thermal"): Promise<Buffer> {
  await pdfSemaphore.acquire();
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const jsPath = path.resolve(dir, "lib/pdf-worker.js");
    const fs = await import("node:fs");

    if (fs.existsSync(jsPath)) {
      // Production: built .js worker exists, run in a worker thread
      return await new Promise((resolve, reject) => {
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
    return await new Promise((resolve, reject) => {
      const doc = generateInvoicePDF(data, format);
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.end();
    });
  } finally {
    pdfSemaphore.release();
  }
}

// ── Shared business access check for non-tRPC endpoints ─────────
// Mirrors the hasBusinessAccess middleware in trpc.ts: verifies the business
// exists in the tenant DB AND (for self-hosted shared-DB mode) that the
// business creator is a member of the caller's tenant.
async function verifyBusinessAccess(
  db: Awaited<ReturnType<typeof getTenantDb>>,
  businessId: string,
  tenantId: string,
): Promise<{ ok: true; business: { id: string; createdByUserId: string } } | { ok: false; error: string }> {
  const [biz] = await db.select({ id: businesses.id, createdByUserId: businesses.createdByUserId })
    .from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz) return { ok: false, error: "Business not found" };

  // Self-hosted cross-tenant guard: verify the creator is a member of this tenant
  const [creatorMembership] = await controlDb
    .select({ userId: tenantMembers.userId })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, biz.createdByUserId)))
    .limit(1);
  if (!creatorMembership) return { ok: false, error: "Business not found" };

  return { ok: true, business: biz };
}

// ── PDF-specific rate limiting (per IP, 30/min) ──────────────
const pdfRateMap = new Map<string, { count: number; reset: number }>();
const PDF_RATE_LIMIT = 30; // per minute
const PDF_RATE_WINDOW = 60_000;

function checkPdfRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = pdfRateMap.get(ip);
  if (!entry || now > entry.reset) {
    pdfRateMap.set(ip, { count: 1, reset: now + PDF_RATE_WINDOW });
    return true;
  }
  entry.count++;
  return entry.count <= PDF_RATE_LIMIT;
}

// Cleanup stale PDF rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of pdfRateMap) {
    if (now > entry.reset) pdfRateMap.delete(ip);
  }
}, 300_000).unref();

// ── PDF Download endpoint ──────────────────────────────────────
app.get("/api/invoices/:id/pdf", async (c) => {
  if (!checkPdfRateLimit(getClientIp(c))) {
    return c.json({ error: "Too many PDF requests. Try again later." }, 429);
  }

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
  const [tenant] = await controlDb.select({ status: tenants.status, plan: tenants.plan })
    .from(tenants).where(eq(tenants.id, sessionRow.tenantId)).limit(1);
  if (!tenant || tenant.status !== "active") return c.json({ error: "Organization suspended" }, 403);

  const businessId = c.req.header("x-business-id");
  if (!businessId) return c.json({ error: "No business selected" }, 400);

  // Get tenant DB for invoice data
  const db = await getTenantDb(sessionRow.tenantId);

  // Verify the business exists and belongs to this tenant (cross-tenant guard)
  const bizAccess = await verifyBusinessAccess(db, businessId, sessionRow.tenantId);
  if (!bizAccess.ok) return c.json({ error: bizAccess.error }, 403);

  // Fetch invoice with party and business
  const [invoice] = await db.select().from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.businessId, businessId))).limit(1);
  if (!invoice) return c.json({ error: "Invoice not found" }, 404);

  const [party] = await db.select().from(parties).where(eq(parties.id, invoice.partyId)).limit(1);
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  const lineItems = await db.select().from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, invoiceId)).orderBy(invoiceItems.sortOrder);

  // Fetch HSN codes and base units for linked items.
  // Historical join — intentionally no `isNull(items.deletedAt)` filter.
  // The invoice was created when the item existed; deleting the item later
  // must not blank out HSN or unit on a previously-generated PDF.
  const itemIds = lineItems.map(li => li.itemId).filter(Boolean) as string[];
  const itemMeta = itemIds.length > 0
    ? await db.select({ id: items.id, hsn: items.hsn, unit: items.unit }).from(items).where(inArray(items.id, itemIds))
    : [];
  const hsnMap = new Map(itemMeta.map(i => [i.id, i.hsn || ""]));
  const itemUnitMap = new Map(itemMeta.map(i => [i.id, i.unit]));

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
  let upiPayUrl: string | undefined;
  const upiId = upiAccount?.accountNumber; // UPI ID stored in accountNumber for UPI type
  if (upiId && invoice.type === "sale") {
    const balance = parseFloat(invoice.totalAmount) - parseFloat(invoice.amountPaid);
    if (balance > 0) {
      // QR encodes the raw upi:// deep link (scanned by phone cameras)
      const upiDeepLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(biz.name)}&am=${balance.toFixed(2)}&cu=INR&tn=${encodeURIComponent(invoice.invoiceNumber)}`;
      upiQrDataUrl = await QRCode.toDataURL(upiDeepLink, { width: 200, margin: 1 });
      // Clickable link uses HTTPS redirect (PDF viewers won't open upi:// directly)
      const apiBase = new URL(c.req.url).origin;
      upiPayUrl = `${apiBase}/pay/upi?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(biz.name)}&am=${balance.toFixed(2)}&tn=${encodeURIComponent(invoice.invoiceNumber)}`;
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
      itemName: li.itemName,
      description: li.description,
      quantity: li.quantity,
      unit: li.selectedUnit || (li.itemId ? itemUnitMap.get(li.itemId) : undefined) || undefined,
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
    upiPayUrl,
    gstRegistrationType: biz.gstRegistrationType || "unregistered",
    businessStateCode: biz.stateCode || undefined,
    partyStateCode: party.stateCode || undefined,
    lineItemHsn: lineItems.map(li => li.itemId ? (hsnMap.get(li.itemId) || "") : ""),
    isPaidPlan: tenant.plan !== "free",
    status: invoice.status,
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
  if (!checkPdfRateLimit(getClientIp(c))) {
    return c.json({ error: "Too many PDF requests. Try again later." }, 429);
  }

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

  // Verify the business exists and belongs to this tenant (cross-tenant guard)
  const bizAccess = await verifyBusinessAccess(db, businessId, sessionRow.tenantId);
  if (!bizAccess.ok) return c.json({ error: bizAccess.error }, 403);

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

  // Generate UPI QR for ledger if closing balance is receivable
  let ledgerUpiQrDataUrl: string | undefined;
  let ledgerUpiPayUrl: string | undefined;
  if (parseFloat(closingBalance) > 0 && party.type === "customer") {
    const ledgerBankAccounts = await db.select().from(bankAccounts)
      .where(eq(bankAccounts.businessId, businessId));
    const ledgerUpiAccount = ledgerBankAccounts.find(a => a.accountType === "upi");
    const ledgerUpiId = ledgerUpiAccount?.accountNumber;
    if (ledgerUpiId) {
      const ledgerUpiDeepLink = `upi://pay?pa=${encodeURIComponent(ledgerUpiId)}&pn=${encodeURIComponent(biz.name)}&am=${parseFloat(closingBalance).toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Outstanding - ${party.name}`)}`;
      ledgerUpiQrDataUrl = await QRCode.toDataURL(ledgerUpiDeepLink, { width: 200, margin: 1 });
      const apiBase = new URL(c.req.url).origin;
      ledgerUpiPayUrl = `${apiBase}/pay/upi?pa=${encodeURIComponent(ledgerUpiId)}&pn=${encodeURIComponent(biz.name)}&am=${parseFloat(closingBalance).toFixed(2)}&tn=${encodeURIComponent(`Outstanding - ${party.name}`)}`;
    }
  }

  const pdfBuffer = await generateLedgerPDF({
    businessName: biz.name,
    partyName: party.name,
    partyType: party.type,
    openingBalance: party.openingBalance,
    fromDate: fromParam || null,
    toDate: toParam || null,
    entries: entriesWithBalance,
    summary: { totalDebit, totalCredit, closingBalance },
    upiQrDataUrl: ledgerUpiQrDataUrl,
    upiPayUrl: ledgerUpiPayUrl,
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
    // Active catalog read — soft-deleted items must never appear in the
    // public store, even if `store_enabled` was not cleared before deletion.
    isNull(items.deletedAt),
  ];
  if (category) conditions.push(eq(sql`COALESCE(${items.storeCategory}, ${items.category})`, category));
  if (search) conditions.push(sql`${items.name} ILIKE ${"%" + escapeLike(search) + "%"}`);

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
          // Active variant read — soft-deleted variants must not appear in
          // the store catalog. Parent already filtered on isNull(items.deletedAt).
          isNull(itemVariants.deletedAt),
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
    .map(({ stockQty: _stockQty, unitVariants: rawUnitVariants, variantAttributes: rawVarAttrs, ...rest }) => {
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
      // Active read — soft-deleted items are treated as unavailable.
      // If a customer somehow sends a stale item ID, this causes the
      // count mismatch below and returns a 400.
      isNull(items.deletedAt),
    ));

  if (foundItems.length !== new Set(itemIds).size) {
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
          // Active variant read — soft-deleted variants are treated as
          // unavailable for new store orders.
          isNull(itemVariants.deletedAt),
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
      // Advisory lock prevents race condition with concurrent store order requests
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${resolved.businessId} || ':walkin'))`);
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
          // Online store orders: snapshot the item name into the required
          // itemName column. Notes column stays null — store customers
          // don't submit per-line comments through the ordering UI.
          itemName: li.name,
          description: null,
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

      // Stock adjustment per line item — use PostgreSQL NUMERIC arithmetic
      // to avoid JS floating-point drift. Lock rows first for concurrency safety.
      // No extra isNull filter needed here: items/variants were already confirmed
      // active by the foundItems/foundVariants queries earlier in this handler.
      const itemIds = [...new Set(lineItemInputs.filter(li => !li.variantId).map(li => li.itemId))];
      const variantIds = [...new Set(lineItemInputs.filter(li => li.variantId).map(li => li.variantId!))];
      if (itemIds.length > 0) {
        await tx.select({ id: items.id }).from(items)
          .where(inArray(items.id, itemIds)).for("update");
      }
      if (variantIds.length > 0) {
        await tx.select({ id: itemVariants.id }).from(itemVariants)
          .where(inArray(itemVariants.id, variantIds)).for("update");
      }
      for (const li of lineItemInputs) {
        if (li.variantId) {
          await tx.update(itemVariants).set({
            stockQuantity: sql`${itemVariants.stockQuantity}::numeric - ${li.quantity}::numeric`,
            updatedAt: new Date(),
          }).where(eq(itemVariants.id, li.variantId));
        } else {
          const cf = li.conversionFactor || "1";
          await tx.update(items).set({
            stockQuantity: sql`${items.stockQuantity}::numeric - (${li.quantity}::numeric * ${cf}::numeric)`,
            updatedAt: new Date(),
          }).where(eq(items.id, li.itemId));
        }
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
    logger.error({ err }, "[store/order] Failed to create order");
    return c.json({ error: "Failed to place order. Please try again." }, 500);
  }
});

// ── Self-export download endpoint ─────────────────────────────
registerExportRoute(app);

// ── Self-import upload endpoint ────────────────────────────────
registerImportRoute(app);

// ── tRPC handler ───────────────────────────────────────────────
app.use("/api/trpc/*", async (c) => {
  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
    onError({ error, path }) {
      if (error.code === "INTERNAL_SERVER_ERROR") {
        logger.error({ path, err: error }, `[tRPC] ${path}`);
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
    logger.error({ err: e }, "[session-cleanup] Failed");
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

// ── Shipping carrier webhooks ──────────────────────────────────
// Carriers POST status updates here. The URL includes the business ID for routing.
// Each carrier has a different payload format — the handler normalises them into shipment events.
// For now: accept, log, and store the raw payload. Actual carrier-specific parsing comes later.
app.post("/webhooks/shipping/:businessId", async (c) => {
  const secret = process.env.SHIPPING_WEBHOOK_SECRET;
  if (!secret) {
    return c.json({ error: "Webhook not configured" }, 503);
  }

  const signature = c.req.header("x-webhook-signature");
  if (!signature) {
    return c.json({ error: "Missing signature" }, 401);
  }

  const rawBody = await c.req.text();
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const signatureBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== signatureBuf.length || !timingSafeEqual(expectedBuf, signatureBuf)) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  const businessId = c.req.param("businessId");
  let body: Record<string, any>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  // Resolve tenant from business ID and get DB connection
  const { shipments: shipmentsTable, shipmentEvents } = await import("@hisaabo/db");
  // In single-tenant mode, use "single"; in multi-tenant, scan active tenants to find the owner
  const isMultiTenant = process.env.MULTI_TENANT === "true";
  let db: Awaited<ReturnType<typeof getTenantDb>>;

  if (!isMultiTenant) {
    db = await getTenantDb("single");
  } else {
    const activeTenants = await controlDb
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.status, "active"));

    let resolvedDb: Awaited<ReturnType<typeof getTenantDb>> | undefined;
    for (const t of activeTenants) {
      const tdb = await getTenantDb(t.id);
      const [biz] = await tdb
        .select({ id: businesses.id })
        .from(businesses)
        .where(eq(businesses.id, businessId))
        .limit(1);
      if (biz) {
        resolvedDb = tdb;
        break;
      }
    }
    if (!resolvedDb) {
      return c.json({ error: "Business not found" }, 404);
    }
    db = resolvedDb;
  }

  // Extract tracking number — carriers typically send it as `awb`, `tracking_id`, or `waybill`
  const trackingNumber = body.awb || body.tracking_id || body.waybill || body.trackingNumber || null;
  if (!trackingNumber) {
    return c.json({ error: "No tracking number found in payload" }, 400);
  }

  // Find the shipment by tracking number + business
  const [shipment] = await db.select({ id: shipmentsTable.id })
    .from(shipmentsTable)
    .where(and(
      eq(shipmentsTable.businessId, businessId),
      eq(shipmentsTable.trackingNumber, trackingNumber),
    ))
    .limit(1);

  if (!shipment) {
    return c.json({ error: "Shipment not found", trackingNumber }, 404);
  }

  // Store the raw event — carrier-specific parsing will be added per carrier
  await db.insert(shipmentEvents).values({
    shipmentId: shipment.id,
    status: body.status || body.current_status || "unknown",
    statusDetail: body.status_description || body.remarks || body.message || null,
    location: body.location || body.scan_location || body.city || null,
    source: "webhook",
    carrierStatus: body.status_code || body.status || null,
    eventTime: body.timestamp ? new Date(body.timestamp) : new Date(),
  });

  return c.json({ ok: true, shipmentId: shipment.id });
});

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

// ── Startup sanity check ─────────────────────────────────────
// Refuse to boot if the migration SQL directories aren't where the bundled
// runtime expects them. Without this, a broken Dockerfile / bundle layout
// would boot "successfully" and only fail on the first user signup (which is
// how we learned the hard way that @hisaabo/db's __dirname shifts when tsup
// inlines it into apps/api/dist).
{
  const missing = assertMigrationsPresent();
  if (missing.length > 0) {
    for (const m of missing) logger.fatal({ reason: m }, "Migration directory missing at boot");
    logger.fatal("Refusing to start — fix the bundle/deploy layout and retry");
    process.exit(1);
  }
}

// ── Start ──────────────────────────────────────────────────────
const port = parseInt(process.env.PORT || "3000", 10);

const server = serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port }, `Hisaabo API running on http://localhost:${info.port}`);
  logger.info({ port: info.port }, `  tRPC endpoint: http://localhost:${info.port}/api/trpc`);
  startRecurringScheduler();
});

// ── Graceful shutdown ─────────────────────────────────────────
function shutdown(signal: string) {
  logger.info({ signal }, `Shutting down (${signal})...`);
  stopRecurringScheduler();
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
  // Force kill if server doesn't close within 5 seconds
  setTimeout(() => {
    logger.error("Forced exit after timeout");
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
