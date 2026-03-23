import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { Context, Next } from "hono";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { eq, and, gt, lt } from "drizzle-orm";
import { appRouter } from "./router.js";
import { createContext } from "./context.js";
import { generateInvoicePDF, type InvoicePDFData } from "./lib/invoice-pdf.js";
import { controlDb, getTenantDb, invoices, invoiceItems, parties, businesses, sessions, users, tenants } from "@hisaabo/db";

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
const rateMap = new Map<string, { count: number; reset: number }>();
app.use("/api/trpc/*", async (c: Context, next: Next) => {
  const key = c.req.header("x-forwarded-for") || c.req.header("cf-connecting-ip") || "unknown";
  const now = Date.now();
  const entry = rateMap.get(key);
  if (!entry || now > entry.reset) {
    rateMap.set(key, { count: 1, reset: now + 60_000 });
  } else if (entry.count >= 120) {
    return c.json({ error: "Too many requests" }, 429);
  } else {
    entry.count++;
  }
  await next();
});

// ── Health check ───────────────────────────────────────────────
app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// ── PDF Download endpoint ──────────────────────────────────────
app.get("/api/invoices/:id/pdf", async (c) => {
  const invoiceId = c.req.param("id");
  const format = (c.req.query("format") || "a4") as "a4" | "thermal";

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
  };

  const pdfDoc = generateInvoicePDF(pdfData, format);

  // Collect PDF buffer
  const chunks: Buffer[] = [];
  pdfDoc.on("data", (chunk: Buffer) => chunks.push(chunk));

  return new Promise<Response>((resolve) => {
    pdfDoc.on("end", () => {
      const buffer = Buffer.concat(chunks);
      const filename = `${invoice.invoiceNumber}_${format}.pdf`;
      resolve(new Response(buffer, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${filename}"`,
          "Content-Length": buffer.length.toString(),
        },
      }));
    });
    pdfDoc.end();
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
// Clean up expired sessions every hour
setInterval(async () => {
  try {
    await controlDb.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  } catch (e) {
    console.error("[session-cleanup] Failed:", e);
  }
}, 60 * 60 * 1000);

// ── Start ──────────────────────────────────────────────────────
const port = parseInt(process.env.PORT || "3000", 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`🚀 Hisaabo API running on http://localhost:${info.port}`);
  console.log(`   tRPC endpoint: http://localhost:${info.port}/api/trpc`);
});
