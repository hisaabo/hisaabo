import React, { useState, useCallback } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import { UserProvider } from "./lib/user-context";
import { PersonaProvider, usePersona } from "./lib/persona-context";
import { Layout } from "./components/Layout";
import { Sidebar } from "./components/Sidebar";
import { AuthBanner } from "./components/AuthBanner";
import { PersonaBanner } from "./components/PersonaSelector";
import { FAQSection } from "./components/FAQ";
import { allEndpointGroups, allSections } from "./content";
import { Link } from "react-router-dom";

const BASE_URL = "https://api.hisaabo.in";

const QUICK_START_CODE = `import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@hisaabo/api";

const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "https://api.hisaabo.in/api/trpc",
      transformer: superjson,
      headers() {
        return {
          "x-business-id": localStorage.getItem("businessId") ?? "",
        };
      },
    }),
  ],
});

// 1. Login
const { sessionToken } = await trpc.auth.login.mutate({
  email: "rahul@sharmatraders.in",
  password: "your-password",
});

// 2. List your businesses
const { data: businesses } = await trpc.business.list.query();
// e.g. [{ id: "biz-uuid", name: "Sharma Traders", gstin: "07AABCS1429B1ZP" }]

// 3. Create an invoice (sale to a customer, with 5% GST on Basmati Rice)
const invoice = await trpc.invoice.create.mutate({
  partyId: "gupta-enterprises-party-uuid",
  type: "sale",
  lineItems: [{
    description: "Basmati Rice 25kg",
    quantity: "20.000",   // 20 bags
    unitPrice: "1250.00", // ₹1,250 per bag
    taxPercent: "5.00",   // GST 5% — HSN 1006
    itemId: "basmati-rice-item-uuid",
  }],
  notes: "Delivery to warehouse on 28th. NEFT payment preferred.",
});
// invoice.invoiceNumber → "BB-14821"
// invoice.totalAmount   → "26250.00" (₹25,000 + ₹1,250 GST)`;

function CopyInline({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 ml-2 px-1.5 py-0.5 rounded text-[10px] transition-all"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid var(--border-mid)",
        color: copied ? "var(--green)" : "var(--text-muted)",
      }}
      aria-label="Copy"
    >
      {copied ? (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-[18px] font-semibold mb-4 leading-snug"
      style={{ color: "var(--text-primary)", letterSpacing: "-0.01em" }}
    >
      {children}
    </h2>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="mono prose-code"
    >
      {children}
    </code>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre
      className="text-[12px] p-4 rounded-lg overflow-x-auto leading-relaxed"
      style={{
        background: "rgba(8, 8, 16, 0.7)",
        border: "1px solid var(--border-mid)",
        fontFamily: "JetBrains Mono, Fira Code, monospace",
        color: "#e2e8f0",
      }}
    >
      <code>{children}</code>
    </pre>
  );
}

/** Endpoint count across all groups */
const totalEndpoints = allEndpointGroups.reduce((acc, g) => acc + g.endpoints.length, 0);

function OverviewPage() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { persona, personaInfo } = usePersona();

  // Determine which groups to highlight based on persona
  const highlightedSet = new Set(personaInfo?.highlightedGroups ?? []);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg-base)" }}>
      {/* Mobile overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-20 lg:hidden"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-30
          w-[260px] flex-shrink-0 h-full overflow-hidden
          transition-transform duration-300 lg:translate-x-0
          ${mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}
        style={{ borderRight: "1px solid var(--border)" }}
      >
        <Sidebar onNavigate={() => setMobileSidebarOpen(false)} />
      </aside>

      {/* Center */}
      <main
        className="flex-1 overflow-y-auto min-w-0"
        style={{ background: "var(--bg-center)" }}
      >
        {/* Mobile header */}
        <div
          className="lg:hidden sticky top-0 z-10 px-4 py-3 flex items-center gap-3"
          style={{ background: "var(--bg-center)", borderBottom: "1px solid var(--border)" }}
        >
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="flex-shrink-0 transition-colors"
            style={{ color: "var(--text-tertiary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-tertiary)")}
            aria-label="Open navigation"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
            API Reference
          </span>
        </div>

        <div className="max-w-[720px] mx-auto px-6 py-8 lg:px-10 lg:py-10">

          {/* Hero */}
          <div className="mb-12 relative">
            {/* Subtle glow behind the hero text */}
            <div
              className="absolute -top-16 -left-16 w-64 h-64 rounded-full pointer-events-none"
              style={{
                background: "radial-gradient(circle, rgba(99, 102, 241, 0.08) 0%, transparent 70%)",
                filter: "blur(40px)",
              }}
              aria-hidden="true"
            />

            <div className="flex items-center gap-3 mb-5 flex-wrap relative">
              <div
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-medium"
                style={{
                  background: "var(--brand-dim)",
                  border: "1px solid var(--brand-dim-strong)",
                  color: "var(--brand-light)",
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--brand)" }} />
                tRPC + SuperJSON
              </div>
              <div
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-medium"
                style={{
                  background: "var(--green-dim)",
                  border: "1px solid rgba(16, 185, 129, 0.2)",
                  color: "var(--green)",
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--green)" }} />
                {totalEndpoints}+ endpoints
              </div>
            </div>

            <h1
              className="text-[32px] lg:text-[36px] font-bold mb-4 leading-tight relative"
              style={{ color: "var(--text-primary)", letterSpacing: "-0.03em" }}
            >
              Hisaabo API Reference
            </h1>
            <p
              className="text-[15px] lg:text-[16px] leading-[1.7] max-w-[560px] relative"
              style={{ color: "var(--text-secondary)" }}
            >
              Complete reference for the Hisaabo tRPC API. Every capability available to
              the web dashboard, mobile app, and AI agents — documented with code examples in
              JavaScript, cURL, and Python.
            </p>
          </div>

          {/* Persona Banner */}
          <PersonaBanner />

          {/* Base URL */}
          <section className="mb-10">
            <SectionHeading>Base URL</SectionHeading>
            <div
              className="flex items-center gap-3 px-4 py-3 rounded-lg"
              style={{
                background: "rgba(8, 8, 16, 0.6)",
                border: "1px solid var(--border-mid)",
              }}
            >
              <span
                className="text-[11px] font-bold font-mono px-2 py-0.5 rounded"
                style={{
                  background: "var(--green-dim)",
                  color: "var(--green)",
                  border: "1px solid rgba(16,185,129,0.2)",
                }}
              >
                HTTPS
              </span>
              <code
                className="mono text-[13px] flex-1 truncate"
                style={{ color: "var(--text-secondary)" }}
              >
                {BASE_URL}/api/trpc
              </code>
              <CopyInline text={`${BASE_URL}/api/trpc`} />
            </div>
          </section>

          {/* Authentication */}
          <section className="mb-10">
            <SectionHeading>Authentication</SectionHeading>
            <div className="space-y-3">

              {/* Cookie */}
              <div
                className="p-4 rounded-lg"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-mid)" }}
              >
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span
                    className="text-[13px] font-semibold"
                    style={{ color: "var(--text-primary)" }}
                  >
                    Cookie — web clients
                  </span>
                  <span
                    className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                    style={{
                      background: "var(--yellow-dim)",
                      color: "var(--yellow)",
                      border: "1px solid rgba(245,158,11,0.2)",
                    }}
                  >
                    Recommended
                  </span>
                </div>
                <p className="text-[13px] leading-relaxed mb-3" style={{ color: "var(--text-secondary)" }}>
                  After login, the API sets a <InlineCode>session_id</InlineCode> HttpOnly cookie
                  (30-day expiry, SameSite=Lax). Browsers send it automatically.
                </p>
                <CodeBlock>Cookie: session_id=sess_VbK2mQ9xP4nR7wA1...</CodeBlock>
              </div>

              {/* Bearer */}
              <div
                className="p-4 rounded-lg"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-mid)" }}
              >
                <div className="mb-2">
                  <span
                    className="text-[13px] font-semibold"
                    style={{ color: "var(--text-primary)" }}
                  >
                    Bearer token — mobile / server / agent clients
                  </span>
                </div>
                <p className="text-[13px] leading-relaxed mb-3" style={{ color: "var(--text-secondary)" }}>
                  Pass the <InlineCode>sessionToken</InlineCode> returned by{" "}
                  <InlineCode>auth.login</InlineCode> or an API key from{" "}
                  <InlineCode>apiKey.create</InlineCode> as a Bearer token.
                </p>
                <CodeBlock>Authorization: Bearer sess_VbK2mQ9xP4nR7wA1...</CodeBlock>
              </div>

              {/* Business ID */}
              <div
                className="p-4 rounded-lg"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-mid)" }}
              >
                <div className="mb-2">
                  <span
                    className="text-[13px] font-semibold"
                    style={{ color: "var(--text-primary)" }}
                  >
                    Business ID header
                  </span>
                </div>
                <p className="text-[13px] leading-relaxed mb-3" style={{ color: "var(--text-secondary)" }}>
                  Business-scoped endpoints require the active business UUID in a header.
                  Call <InlineCode>business.list</InlineCode> to get your available business IDs.
                </p>
                <CodeBlock>x-business-id: biz-uuid-here</CodeBlock>
              </div>
            </div>
          </section>

          {/* Data conventions */}
          <section className="mb-10">
            <SectionHeading>Data Conventions</SectionHeading>
            <div
              className="rounded-lg overflow-hidden"
              style={{ border: "1px solid var(--border-mid)" }}
            >
              {[
                {
                  key: "Money",
                  value: 'All monetary values are strings (e.g. "1500.00") using NUMERIC(15,2) precision. Never pass numbers -- floating-point errors corrupt data.',
                  color: "#f87171",
                },
                {
                  key: "Dates",
                  value: 'All date/time fields use ISO 8601 (e.g. "2024-03-16T00:00:00.000Z"). Financial year starts April 1 by default.',
                  color: "#67e8f9",
                },
                {
                  key: "Pagination",
                  value: "List endpoints accept page (1-indexed) and limit (1-100, default 20). Responses include total count.",
                  color: "#86efac",
                },
                {
                  key: "Transport",
                  value: "Queries use GET with URL-encoded input. Mutations use POST with JSON body. The tRPC client handles this automatically.",
                  color: "#fbbf24",
                },
                {
                  key: "SuperJSON",
                  value: "Serialization uses SuperJSON, which preserves Date objects and other types. The tRPC client applies this transparently.",
                  color: "#a78bfa",
                },
              ].map((item, i, arr) => (
                <div
                  key={item.key}
                  className="flex gap-4 p-4"
                  style={{
                    background: "var(--bg-card)",
                    borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none",
                  }}
                >
                  <code
                    className="mono text-[11px] font-bold shrink-0 mt-0.5 w-[72px]"
                    style={{ color: item.color }}
                  >
                    {item.key}
                  </code>
                  <p
                    className="text-[13px] leading-relaxed"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Role system */}
          <section className="mb-10">
            <SectionHeading>Role-Based Access</SectionHeading>
            <p
              className="text-[14px] mb-4 leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              Business endpoints use CASL for fine-grained permissions. Roles are assigned per organization.
            </p>
            <div
              className="rounded-lg overflow-hidden"
              style={{ border: "1px solid var(--border-mid)" }}
            >
              <table className="w-full param-table">
                <thead>
                  <tr style={{ background: "rgba(20, 20, 36, 0.9)" }}>
                    <th className="text-left" style={{ width: "140px" }}>Role</th>
                    <th className="text-left">Permissions</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { role: "superadmin", desc: "Full access. Can manage organization members, businesses, and all data. Highest privilege level.", color: "#f97316" },
                    { role: "owner", desc: "Full access within the organization. Can manage businesses and members.", color: "#fb923c" },
                    { role: "admin", desc: "Full access to all business data. Cannot manage organization-level members.", color: "#818cf8" },
                    { role: "seller_manager", desc: "Create/edit invoices, parties, items, payments. Can delete unpaid invoices created within 2 hours. Manage store orders.", color: "#f59e0b" },
                    { role: "seller", desc: "Create invoices and payments. Read-only on items. Cannot delete anything. Edit own invoices within 2 hours only.", color: "#10b981" },
                    { role: "accountant", desc: "Full financial access: payments, expenses, bank accounts, reports, GST. Read-only on invoices, parties, items.", color: "#06b6d4" },
                  ].map(({ role, desc, color }) => (
                    <tr key={role} style={{ background: "rgba(15, 15, 26, 0.6)" }}>
                      <td>
                        <code className="mono text-[12px] font-semibold" style={{ color }}>{role}</code>
                      </td>
                      <td
                        className="text-[13px] leading-relaxed"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {desc}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Rate limiting */}
          <section className="mb-10">
            <SectionHeading>Rate Limiting</SectionHeading>
            <div
              className="flex gap-3 p-4 rounded-lg"
              style={{
                background: "rgba(239, 68, 68, 0.04)",
                border: "1px solid rgba(239, 68, 68, 0.12)",
              }}
            >
              <svg
                className="w-4 h-4 flex-shrink-0 mt-0.5"
                style={{ color: "var(--red)" }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div className="text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                <p className="mb-3">
                  Rate limits are <strong style={{ color: "var(--text-primary)" }}>per IP, per minute</strong>, tiered by origin and authentication status.
                  Exceeding the limit returns <InlineCode>429 Too Many Requests</InlineCode> with a <InlineCode>Retry-After: 60</InlineCode> header.
                </p>
                <table className="w-full param-table text-[12px]" style={{ border: "1px solid var(--border-mid)" }}>
                  <thead>
                    <tr style={{ background: "rgba(20, 20, 36, 0.9)" }}>
                      <th className="text-left">Origin</th>
                      <th className="text-left">Auth</th>
                      <th className="text-right">Limit/min</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { origin: "Same origin (*.hisaabo.in)", auth: "Authenticated", limit: "120" },
                      { origin: "Same origin", auth: "Unauthenticated", limit: "60" },
                      { origin: "External", auth: "Authenticated", limit: "60" },
                      { origin: "External", auth: "Unauthenticated", limit: "10" },
                    ].map((r, i) => (
                      <tr key={i} style={{ background: "rgba(15, 15, 26, 0.6)" }}>
                        <td style={{ color: "var(--text-secondary)" }}>{r.origin}</td>
                        <td style={{ color: "var(--text-muted)" }}>{r.auth}</td>
                        <td className="text-right font-mono font-semibold" style={{ color: "var(--text-primary)" }}>{r.limit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3" style={{ color: "var(--text-muted)" }}>
                  Same-origin is determined by the <InlineCode>Origin</InlineCode> header matching configured CORS origins or <InlineCode>*.hisaabo.in</InlineCode> subdomains. Server-side calls without an Origin header are treated as same-origin.
                </p>
              </div>
            </div>
          </section>

          {/* Endpoint groups by section */}
          <section className="mb-10">
            <SectionHeading>Endpoint Groups</SectionHeading>
            <p className="text-[13px] mb-6" style={{ color: "var(--text-tertiary)" }}>
              {allEndpointGroups.length} groups, {totalEndpoints}+ endpoints.
              {persona && " Highlighted groups are most relevant to your role."}
            </p>

            {allSections.map((section) => (
              <div key={section.id} className="mb-6">
                <h3
                  className="section-label mb-3"
                >
                  {section.title}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {section.groups.map((group) => {
                    const isHighlighted = highlightedSet.has(group.id);
                    return (
                      <Link
                        key={group.id}
                        to={`/group/${group.id}`}
                        className="group-card block p-4 rounded-lg relative"
                        style={{
                          background: isHighlighted ? "rgba(99, 102, 241, 0.06)" : "var(--bg-card)",
                          border: `1px solid ${isHighlighted ? "rgba(99, 102, 241, 0.2)" : "var(--border-mid)"}`,
                        }}
                      >
                        {isHighlighted && (
                          <div
                            className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full"
                            style={{ background: "var(--brand)" }}
                          />
                        )}
                        <div className="flex items-center justify-between mb-1.5">
                          <h4
                            className="text-[13px] font-semibold"
                            style={{ color: isHighlighted ? "var(--brand-light)" : "var(--text-primary)" }}
                          >
                            {group.title}
                          </h4>
                          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                            {group.endpoints.length} endpoint{group.endpoints.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <p
                          className="text-[12px] leading-relaxed line-clamp-2"
                          style={{ color: "var(--text-tertiary)" }}
                        >
                          {group.description}
                        </p>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>

          {/* FAQ */}
          <FAQSection />
        </div>
      </main>

      {/* Right panel -- Quick Start */}
      <aside
        className="hidden lg:flex flex-col w-[420px] flex-shrink-0 h-full overflow-hidden"
        style={{ borderLeft: "1px solid var(--border)", background: "var(--bg-code)" }}
      >
        <AuthBanner />
        <div className="flex-1 overflow-auto">
          <div
            className="flex items-center justify-between px-4 py-2.5"
            style={{ borderBottom: "1px solid var(--border-mid)" }}
          >
            <div className="flex items-center gap-2">
              <span
                className="text-[12px] font-medium"
                style={{ color: "var(--brand-light)" }}
              >
                JavaScript
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="section-label">Quick Start</span>
            </div>
          </div>

          <div className="flex">
            {/* Line numbers */}
            <div
              className="select-none flex-shrink-0 text-right pr-3 pl-4 py-4"
              style={{
                color: "var(--text-muted)",
                fontFamily: "JetBrains Mono, Fira Code, monospace",
                fontSize: "12px",
                lineHeight: "1.75",
                minWidth: "2.75rem",
                userSelect: "none",
              }}
              aria-hidden="true"
            >
              {QUICK_START_CODE.split("\n").map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <pre
              className="flex-1 py-4 pr-4 text-[12px] leading-[1.75] overflow-x-auto"
              style={{
                fontFamily: "JetBrains Mono, Fira Code, monospace",
                margin: 0,
                color: "#e2e8f0",
              }}
            >
              <code>{QUICK_START_CODE}</code>
            </pre>
          </div>
        </div>
      </aside>
    </div>
  );
}

export default function App() {
  return (
    <UserProvider>
      <PersonaProvider>
        <HashRouter>
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/group/:groupId" element={<Layout />} />
            <Route path="/group/:groupId/endpoint/:endpointId" element={<Layout />} />
          </Routes>
        </HashRouter>
      </PersonaProvider>
    </UserProvider>
  );
}
