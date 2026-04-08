import React, { useState } from "react";
import { Link } from "react-router-dom";
import { usePersona, PERSONAS, type Persona } from "../lib/persona-context";

interface FAQItem {
  question: string;
  answer: string;
  /** IDs of relevant endpoint groups */
  relatedGroups?: string[];
  /** Which personas this FAQ is most relevant to. Empty = all. */
  personas: Exclude<Persona, null>[];
}

const FAQ_ITEMS: FAQItem[] = [
  // --- Universal ---
  {
    question: "How does authentication work?",
    answer: "Hisaabo uses session-based auth. Call `auth.login` or `auth.register` to get a session. Web clients receive an HttpOnly `session_id` cookie (30-day expiry, SameSite=Lax) that's sent automatically. Mobile and server clients use the returned `sessionToken` as a Bearer token in the `Authorization` header. No JWTs — sessions are stored server-side and revokable instantly.",
    relatedGroups: ["auth"],
    personas: ["developer", "agent-builder"],
  },
  {
    question: "What is the x-business-id header?",
    answer: "Every business-scoped endpoint requires an `x-business-id` header containing the UUID of the active business. A single organization can have multiple businesses (e.g., a CA firm with 30 clients). Call `business.list` to get your available business IDs, then include the chosen ID in every subsequent request. The tRPC client helper `setBusinessId()` handles this automatically.",
    relatedGroups: ["businesses"],
    personas: ["developer", "agent-builder", "ca-accountant"],
  },
  {
    question: "How are monetary values represented?",
    answer: "All money values are strings (e.g., `\"12500.00\"`) backed by PostgreSQL `NUMERIC(15,2)`. Never use JavaScript `parseFloat` or `Number()` for arithmetic — you'll lose precision. The `@hisaabo/shared` package exports a `money` module with safe arithmetic functions. When sending values to the API, always use string format: `\"1250.00\"`, not `1250`.",
    relatedGroups: [],
    personas: ["developer", "agent-builder"],
  },
  {
    question: "What roles and permissions exist?",
    answer: "Six roles with decreasing privilege: `superadmin` (platform-wide), `owner` (org-level), `admin` (full business access), `seller_manager` (invoices + parties + items, limited delete), `seller` (create invoices/payments only), `accountant` (financial access: payments, expenses, bank, reports, GST). Roles are assigned per organization via `tenant.inviteMember`. Each endpoint documents its minimum required role.",
    relatedGroups: ["tenant"],
    personas: ["developer", "ca-accountant", "business-owner"],
  },

  // --- Developer ---
  {
    question: "How do I handle pagination?",
    answer: "List endpoints accept `page` (1-indexed) and `limit` (1–100, default 20). Responses include a `total` count and the current page data. Example: `{ data: [...], total: 156, page: 1, limit: 20 }`. For cursor-based patterns, use the last item's `id` or `createdAt` as a filter on the next request.",
    relatedGroups: ["invoices", "parties"],
    personas: ["developer"],
  },
  {
    question: "Can I batch multiple tRPC calls?",
    answer: "Yes. The API uses `httpBatchLink`, so the tRPC client automatically batches concurrent requests into a single HTTP request. For example, if your UI calls `dashboard.summary`, `dashboard.salesTrend`, and `dashboard.topCustomers` simultaneously, they'll be sent as one batched request. No additional configuration needed.",
    relatedGroups: ["dashboard"],
    personas: ["developer"],
  },
  {
    question: "How do I create an invoice programmatically?",
    answer: "Call `invoice.create` with `partyId`, `type` (\"sale\" or \"purchase\"), and `lineItems` (at least one). Each line item needs `description`, `quantity` (string), `unitPrice` (string), and optionally `taxPercent` and `itemId`. The API atomically generates the invoice number, calculates totals with GST split (CGST/SGST or IGST based on state codes), and adjusts stock if `itemId` is provided. Status starts as `draft`.",
    relatedGroups: ["invoices"],
    personas: ["developer", "agent-builder"],
  },
  {
    question: "What's the rate limit?",
    answer: "Rate limits are per-IP, per-minute: same-origin authenticated: 120/min, same-origin unauthenticated: 60/min, external authenticated: 60/min, external unauthenticated: 10/min. Exceeding returns `429 Too Many Requests` with `Retry-After: 60`. Same-origin is determined by the `Origin` header matching configured CORS origins.",
    relatedGroups: [],
    personas: ["developer", "agent-builder"],
  },

  // --- Agent Builder ---
  {
    question: "How do I connect an AI agent via MCP?",
    answer: "Install `@hisaabo/mcp` and add it to your Claude Desktop `claude_desktop_config.json` with your `HISAABO_API_URL`, `HISAABO_API_KEY`, `HISAABO_TENANT_ID`, and `HISAABO_BUSINESS_ID`. The MCP server exposes every API endpoint as a callable tool, plus 6 built-in prompt templates (morning_briefing, party_deep_dive, gst_filing_prep, collection_follow_up, inventory_health, month_close).",
    relatedGroups: ["api-keys"],
    personas: ["agent-builder"],
  },
  {
    question: "What can an AI agent do that a human can't?",
    answer: "Nothing — and that's the point. An AI agent calls the exact same `invoice.create`, `payment.create`, and `reports.trialBalance` endpoints that the web dashboard uses. Same validation, same permissions, same audit trail. The difference is speed: an agent can reconcile 500 bank transactions, generate GSTR-1, and flag anomalies in seconds. Every action is deterministic and auditable.",
    relatedGroups: [],
    personas: ["agent-builder"],
  },
  {
    question: "How do I create API keys for agent access?",
    answer: "Call `apiKey.create` with a descriptive name. The API key is shown once — store it securely. Use it in the `Authorization: Bearer <key>` header or pass it to the MCP server's `HISAABO_API_KEY` env var. Keys are scoped to a tenant and can be revoked instantly via `apiKey.revoke`.",
    relatedGroups: ["api-keys"],
    personas: ["agent-builder", "developer"],
  },

  // --- CA / Accountant ---
  {
    question: "How do I onboard a new client?",
    answer: "1) Create a business via `business.create` with the client's GST details and state code. A Chart of Accounts with 40 standard Indian accounts is auto-seeded. 2) Invite the client via `tenant.inviteMember` with `seller` or `admin` role — they can create invoices from their phone. 3) Import opening balances via `journal.create` if migrating mid-year. Total setup: ~30 minutes.",
    relatedGroups: ["businesses", "tenant", "journals"],
    personas: ["ca-accountant"],
  },
  {
    question: "How do I generate GSTR-1 and GSTR-3B?",
    answer: "Call `gst.gstr1` with `{year, month}` to get structured GSTR-1 data (B2B, B2C Large, B2C Small, HSN summary, credit/debit notes). Call `gst.gstr3b` for the summary return (outward supplies, ITC, RCM, net payable). Both auto-generate from invoice data — no manual entry. Export as JSON for the GST portal via `gst.gstr1Json`, or as CSV via `gst.gstr1CSV`.",
    relatedGroups: ["gst"],
    personas: ["ca-accountant"],
  },
  {
    question: "How do I reconcile bank statements?",
    answer: "1) Upload the CSV via `bankRecon.uploadCSV` — Hisaabo auto-detects the bank format (10 Indian banks supported). 2) Confirm column mapping via `bankRecon.confirmMapping`. 3) The system runs 4-tier auto-matching: exact (amount + date + ref), strong (amount + 2-day window), narration parse (UPI ID, cheque number), partial (amount only, 7-day window). 4) Review unmatched items and `confirmMatch`, `createExpense`, or `ignoreLine`.",
    relatedGroups: ["bank-recon"],
    personas: ["ca-accountant"],
  },
  {
    question: "How do I generate year-end financial statements?",
    answer: "Financial statements are always live — no \"closing\" step needed. Call `reports.trialBalance`, `reports.balanceSheet`, `reports.profitAndLoss`, and `reports.cashFlowStatement` with your date range. For year-end: post depreciation and provisions via `journal.create`, then run `reports.comparativeProfitAndLoss` for FY-vs-FY analysis. Export to Tally via `reports.tallyExport` for statutory audit.",
    relatedGroups: ["reports", "journals"],
    personas: ["ca-accountant"],
  },
  {
    question: "How does ITC tracking work?",
    answer: "ITC entries are auto-created from purchase invoices. The `itc.dashboard` shows available, utilized, and blocked ITC. `itc.agingAlerts` flags credits approaching the 180-day reversal deadline (Section 16(4)). Mark blocked ITC under 17(5) via `itc.markBlocked`. Record utilization in the prescribed order (IGST > CGST > SGST) via `itc.recordUtilization`. `itc.gstr3bTable4` generates the Table 4 data for your return.",
    relatedGroups: ["itc"],
    personas: ["ca-accountant"],
  },

  // --- Business Owner ---
  {
    question: "How do I create my first invoice?",
    answer: "1) Create a party (customer) via `party.create` with their name, phone, and optionally GSTIN. 2) Create items in your catalog via `item.create` with name, price, unit, and HSN code. 3) Create the invoice via `invoice.create` linking the party and items. The system auto-calculates GST (CGST/SGST for same-state, IGST for inter-state), generates a unique invoice number, and adjusts stock atomically.",
    relatedGroups: ["invoices", "parties", "items"],
    personas: ["business-owner"],
  },
  {
    question: "How do I track who owes me money?",
    answer: "Call `dashboard.topOutstanding` for a quick view of top debtors. For a detailed aging analysis, use `dashboard.receivablesAging` which buckets outstanding amounts by age (0–30, 31–60, 61–90, 90+ days). For a specific customer, call `party.ledger` to see every invoice and payment with a running balance.",
    relatedGroups: ["dashboard", "parties"],
    personas: ["business-owner"],
  },
  {
    question: "How do I share access with my CA?",
    answer: "Invite your CA via `tenant.inviteMember` with the `accountant` role. They get full financial access (payments, expenses, bank accounts, reports, GST) but read-only on invoices, parties, and items. They log in with their own credentials — no password sharing needed. You can revoke access instantly via `tenant.removeMember`.",
    relatedGroups: ["tenant"],
    personas: ["business-owner"],
  },
  {
    question: "How do I manage my online store?",
    answer: "Configure your storefront at `store.hisaabo.in/your-slug` via `store.updateSettings` (logo, colors, minimum order amount, shipping methods). Toggle which items appear in the store via `store.bulkToggleItems`. Set store-specific pricing via `store.updateItemStoreSettings`. Orders arrive with phone verification — confirm them via `store.confirmOrder`, which auto-creates the invoice.",
    relatedGroups: ["store"],
    personas: ["business-owner"],
  },
  {
    question: "How do I record a payment?",
    answer: "Call `payment.create` with the `partyId`, `amount` (string), and `mode` (cash, bank, UPI, cheque, other). You can allocate to a single invoice via `invoiceId` or to multiple invoices via the `allocations` array. The system atomically updates each invoice's `amountPaid` and advances the status (partial/paid). Settlement discounts are supported.",
    relatedGroups: ["payments"],
    personas: ["business-owner"],
  },
];

function FAQAccordion({ item }: { item: FAQItem }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ border: "1px solid var(--border-mid)" }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 px-5 py-4 text-left transition-colors"
        style={{ background: open ? "var(--bg-hover)" : "var(--bg-card)" }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.background = "var(--bg-hover)";
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = "var(--bg-card)";
        }}
      >
        <svg
          className="w-4 h-4 flex-shrink-0 mt-0.5 transition-transform duration-200"
          style={{
            color: open ? "var(--brand-light)" : "var(--text-muted)",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
          }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span
          className="text-[14px] font-medium leading-snug"
          style={{ color: open ? "var(--text-primary)" : "var(--text-secondary)" }}
        >
          {item.question}
        </span>
      </button>

      {open && (
        <div
          className="px-5 pb-4 pt-0"
          style={{ background: "var(--bg-card)", borderTop: "1px solid var(--border)" }}
        >
          <p
            className="text-[13px] leading-[1.8] pt-3"
            style={{ color: "var(--text-secondary)" }}
          >
            {item.answer.split("`").map((part, i) =>
              i % 2 === 1 ? (
                <code key={i} className="mono prose-code">
                  {part}
                </code>
              ) : (
                <React.Fragment key={i}>{part}</React.Fragment>
              )
            )}
          </p>
          {item.relatedGroups && item.relatedGroups.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {item.relatedGroups.map((gId) => (
                <Link
                  key={gId}
                  to={`/group/${gId}`}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md transition-colors"
                  style={{
                    background: "var(--brand-dim)",
                    color: "var(--brand-light)",
                    border: "1px solid var(--brand-dim-strong)",
                  }}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                  View endpoints
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FAQSection() {
  const { persona } = usePersona();
  const [filterPersona, setFilterPersona] = useState<Exclude<Persona, null> | "all">(
    persona ?? "all"
  );

  const filtered =
    filterPersona === "all"
      ? FAQ_ITEMS
      : FAQ_ITEMS.filter(
          (item) => item.personas.length === 0 || item.personas.includes(filterPersona)
        );

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-2">
        <h2
          className="text-[18px] font-semibold"
          style={{ color: "var(--text-primary)", letterSpacing: "-0.01em" }}
        >
          Frequently Asked Questions
        </h2>
      </div>
      <p className="text-[13px] mb-5" style={{ color: "var(--text-tertiary)" }}>
        Common questions about integrating with the Hisaabo API.
      </p>

      {/* Filter tabs */}
      <div
        className="flex items-center gap-1 mb-5 p-1 rounded-lg w-fit"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}
      >
        {[
          { id: "all" as const, label: "All" },
          ...PERSONAS.map((p) => ({ id: p.id, label: p.title })),
        ].map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setFilterPersona(id)}
            className="px-3 py-1.5 rounded-md text-[11px] font-medium transition-all"
            style={{
              background: filterPersona === id ? "var(--brand-dim)" : "transparent",
              color: filterPersona === id ? "var(--brand-light)" : "var(--text-muted)",
              border: filterPersona === id ? "1px solid var(--brand-dim-strong)" : "1px solid transparent",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.map((item, i) => (
          <FAQAccordion key={i} item={item} />
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-[13px] text-center py-8" style={{ color: "var(--text-muted)" }}>
          No FAQs match this filter.
        </p>
      )}
    </section>
  );
}
