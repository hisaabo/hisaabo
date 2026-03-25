import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { Context, Next } from "hono";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { eq, and, gt, lt, inArray } from "drizzle-orm";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import path from "node:path";
import QRCode from "qrcode";
import { appRouter } from "./router.js";
import { createContext } from "./context.js";
import type { InvoicePDFData } from "./lib/invoice-pdf.js";
import { controlDb, getTenantDb, invoices, invoiceItems, items, parties, businesses, sessions, tenants, magicLinkTokens, bankAccounts } from "@hisaabo/db";

const app = new Hono();

// ── Security headers ───────────────────────────────────────────
app.use("*", secureHeaders());

// ── CORS ───────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173").split(",");

app.use("*", cors({
  origin: allowedOrigins,
  credentials: true,
  allowHeaders: ["Content-Type", "x-business-id"],
  allowMethods: ["GET", "POST", "OPTIONS"],
  maxAge: 86400,
}));

// ── Rate limiting (in-memory, per IP) ─────────────────────────
// Authenticated users get 600 req/min (imports can burst).
// Unauthenticated users get 60 req/min (brute force protection).
const rateMap = new Map<string, { count: number; reset: number }>();
app.use("/api/trpc/*", async (c: Context, next: Next) => {
  const ip = c.req.header("x-forwarded-for") || c.req.header("cf-connecting-ip") || "unknown";
  const hasSession = c.req.header("cookie")?.includes("session_id=");
  const limit = hasSession ? 600 : 60;
  const key = hasSession ? `auth:${ip}` : `anon:${ip}`;
  const now = Date.now();
  const entry = rateMap.get(key);
  if (!entry || now > entry.reset) {
    rateMap.set(key, { count: 1, reset: now + 60_000 });
  } else if (entry.count >= limit) {
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

async function generatePDFInWorker(data: any, format: "a5-landscape" | "a4" | "thermal"): Promise<Buffer> {
  const workerPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "lib/pdf-worker.js");
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: { data, format } });
    worker.on("message", resolve);
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error(`PDF worker exited with code ${code}`));
    });
  });
}

// ── PDF Download endpoint ──────────────────────────────────────
app.get("/api/invoices/:id/pdf", async (c) => {
  const invoiceId = c.req.param("id");
  const format = (c.req.query("format") || "a5-landscape") as "a5-landscape" | "a4" | "thermal";

  // Auth check — look up session in control DB
  const cookies = c.req.header("cookie") || "";
  const sessionMatch = cookies.match(/(?:^|;\s*)session_id=([^;]*)/);
  if (!sessionMatch) return c.json({ error: "Unauthorized" }, 401);

  const sessionId = decodeURIComponent(sessionMatch[1]);

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
      "Content-Disposition": `attachment; filename="${invoice.invoiceNumber}.pdf"`,
    },
  });
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
