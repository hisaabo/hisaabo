import React, { useState } from "react";
import { Link } from "react-router-dom";
import type { EndpointDef } from "../content/types";
import { endpointById, groupById, allEndpointGroups } from "../content";
import { ParamTable } from "./ParamTable";

interface Props {
  endpoint: EndpointDef;
}

function MethodBadge({ method }: { method: "query" | "mutation" }) {
  if (method === "query") {
    return (
      <span
        className="inline-flex items-center px-2.5 py-[3px] rounded-full text-[10px] font-bold font-mono tracking-wide"
        style={{
          background: "rgba(16, 185, 129, 0.12)",
          color: "#10b981",
          border: "1px solid rgba(16, 185, 129, 0.25)",
        }}
      >
        GET
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center px-2.5 py-[3px] rounded-full text-[10px] font-bold font-mono tracking-wide"
      style={{
        background: "rgba(249, 115, 22, 0.12)",
        color: "#f97316",
        border: "1px solid rgba(249, 115, 22, 0.25)",
      }}
    >
      POST
    </span>
  );
}

function AuthBadge({ auth }: { auth: "public" | "protected" | "business" }) {
  if (auth === "public") {
    return (
      <span
        className="inline-flex items-center gap-1 px-2.5 py-[3px] rounded-full text-[10px] font-medium"
        style={{
          background: "rgba(16, 185, 129, 0.08)",
          color: "#6ee7b7",
          border: "1px solid rgba(16, 185, 129, 0.15)",
        }}
      >
        <span className="w-1 h-1 rounded-full bg-[#10b981]" />
        Public
      </span>
    );
  }
  if (auth === "protected") {
    return (
      <span
        className="inline-flex items-center gap-1 px-2.5 py-[3px] rounded-full text-[10px] font-medium"
        style={{
          background: "rgba(245, 158, 11, 0.08)",
          color: "#fbbf24",
          border: "1px solid rgba(245, 158, 11, 0.2)",
        }}
      >
        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        Auth Required
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-2.5 py-[3px] rounded-full text-[10px] font-medium"
      style={{
        background: "var(--brand-dim)",
        color: "var(--brand-light)",
        border: "1px solid var(--brand-dim-strong)",
      }}
    >
      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
      Business Required
    </span>
  );
}

function ResponsePreview({ example }: { example: unknown }) {
  const [open, setOpen] = useState(false);
  const json = JSON.stringify(example, null, 2);

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ border: "1px solid var(--border-mid)" }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors"
        style={{
          background: "rgba(26, 26, 46, 0.6)",
          color: "var(--text-secondary)",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(30, 30, 50, 0.8)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(26, 26, 46, 0.6)")}
      >
        <div className="flex items-center gap-2">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
            style={{ color: "var(--green)" }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-[12px] font-medium">Example response</span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: "rgba(16, 185, 129, 0.1)", color: "var(--green)", border: "1px solid rgba(16, 185, 129, 0.2)" }}
          >
            200 OK
          </span>
        </div>
        <svg
          className="w-3.5 h-3.5 transition-transform duration-200"
          style={{
            color: "var(--text-muted)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div style={{ borderTop: "1px solid var(--border-mid)" }}>
          <pre
            className="p-4 text-[12px] leading-relaxed overflow-auto max-h-[320px]"
            style={{
              background: "rgba(10, 10, 20, 0.5)",
              fontFamily: "JetBrains Mono, Fira Code, monospace",
              color: "var(--text-code)",
              margin: 0,
            }}
          >
            <code>{json}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

function RelatedEndpoints({ ids }: { ids: string[] }) {
  const related = ids
    .map((id) => {
      const ep = endpointById.get(id);
      if (!ep) return null;
      const group = allEndpointGroups.find((g) => g.endpoints.some((e) => e.id === id));
      return { ep, group };
    })
    .filter(Boolean) as Array<{ ep: EndpointDef; group: (typeof allEndpointGroups)[0] }>;

  if (related.length === 0) return null;

  return (
    <div className="mt-6">
      <h3 className="section-label mb-3">Related Endpoints</h3>
      <div className="space-y-1">
        {related.map(({ ep, group }) => (
          <Link
            key={ep.id}
            to={`/group/${group.id}/endpoint/${ep.id}`}
            className="related-endpoint-link flex items-center gap-2 text-[13px] py-1 transition-all duration-100"
            style={{ color: "var(--text-tertiary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--brand-light)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-tertiary)")}
          >
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
              style={{ color: "var(--brand)" }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
            <code className="font-mono text-[12px]">{ep.path}</code>
            <span style={{ color: "var(--text-muted)" }}>— {ep.title}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function EndpointDoc({ endpoint }: Props) {
  return (
    <section id={endpoint.id} className="endpoint-section mb-12">
      {/* Header row */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <MethodBadge method={endpoint.method} />
          <code
            className="mono text-[13px] font-medium px-3 py-1 rounded-md"
            style={{
              background: "var(--brand-dim)",
              color: "var(--brand-light)",
              border: "1px solid var(--brand-dim-strong)",
            }}
          >
            {endpoint.path}
          </code>
          <AuthBadge auth={endpoint.auth} />
          {endpoint.requiredRole && (
            <span
              className="text-[11px] px-2 py-[2px] rounded"
              style={{
                background: "rgba(255,255,255,0.04)",
                color: "var(--text-muted)",
                border: "1px solid var(--border-mid)",
              }}
            >
              min role: <code className="mono font-medium" style={{ color: "var(--text-secondary)" }}>{endpoint.requiredRole}</code>
            </span>
          )}
        </div>

        <h2
          className="text-[20px] font-semibold mb-2 leading-snug"
          style={{ color: "var(--text-primary)", letterSpacing: "-0.01em" }}
        >
          {endpoint.title}
        </h2>
        <p className="text-[15px] leading-[1.7]" style={{ color: "var(--text-secondary)" }}>
          {endpoint.description}
        </p>
      </div>

      {/* Divider */}
      <div className="mb-6" style={{ borderTop: "1px solid var(--border)" }} />

      {/* Parameters */}
      <ParamTable params={endpoint.input} title="Parameters" />

      {/* Response */}
      <div className="mb-6">
        <h3 className="section-label mb-3">Response</h3>
        <p className="text-[14px] mb-3 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {endpoint.output.description}
        </p>
        {endpoint.output.example != null && (
          <ResponsePreview example={endpoint.output.example} />
        )}
      </div>

      {/* Gotchas */}
      {endpoint.gotchas && endpoint.gotchas.length > 0 && (
        <div className="mb-6">
          <h3 className="section-label mb-3">Watch Out For</h3>
          <div className="gotchas-block p-4 space-y-3">
            {endpoint.gotchas.map((gotcha, i) => (
              <div key={i} className="flex gap-2.5 items-start">
                <svg
                  className="w-4 h-4 flex-shrink-0 mt-0.5"
                  style={{ color: "var(--yellow)" }}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {gotcha}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Related endpoints */}
      {endpoint.relatedEndpoints && endpoint.relatedEndpoints.length > 0 && (
        <RelatedEndpoints ids={endpoint.relatedEndpoints} />
      )}
    </section>
  );
}
