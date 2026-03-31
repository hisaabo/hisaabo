import React, { useState } from "react";
import { useParams } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { CodePanel } from "./CodePanel";
import { AuthBanner } from "./AuthBanner";
import { endpointById, groupById } from "../content";
import { EndpointDoc } from "./EndpointDoc";

interface LayoutProps {
  children?: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { groupId, endpointId } = useParams<{ groupId?: string; endpointId?: string }>();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const activeEndpoint = endpointId ? endpointById.get(endpointId) : null;
  const activeGroup = groupId ? groupById.get(groupId) : null;
  const codeEndpoint = activeEndpoint ?? (activeGroup?.endpoints[0]) ?? null;

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

      {/* Sidebar — 260px fixed */}
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

      {/* Center content */}
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
            {activeEndpoint?.title ?? activeGroup?.title ?? "Overview"}
          </span>
        </div>

        <div className="max-w-[720px] mx-auto px-10 py-10">
          {children ?? (
            activeEndpoint ? (
              <EndpointDoc endpoint={activeEndpoint} />
            ) : activeGroup ? (
              <>
                {/* Group overview header */}
                <div className="mb-10">
                  <h1
                    className="text-[28px] font-bold leading-tight mb-3"
                    style={{ color: "var(--text-primary)", letterSpacing: "-0.02em" }}
                  >
                    {activeGroup.title}
                  </h1>
                  <p
                    className="text-[15px] leading-[1.7]"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {activeGroup.description}
                  </p>
                </div>

                {/* All endpoints in the group */}
                {activeGroup.endpoints.map((ep) => (
                  <EndpointDoc key={ep.id} endpoint={ep} />
                ))}
              </>
            ) : null
          )}
        </div>
      </main>

      {/* Right: code panel — 420px fixed */}
      <aside
        className="hidden lg:flex flex-col w-[420px] flex-shrink-0 h-full overflow-hidden"
        style={{ borderLeft: "1px solid var(--border)", background: "var(--bg-code)" }}
      >
        <AuthBanner />
        {codeEndpoint ? (
          <CodePanel
            examples={codeEndpoint.codeExamples}
            outputExample={codeEndpoint.output.example}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div>
              <div
                className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center"
                style={{
                  background: "var(--brand-dim)",
                  border: "1px solid var(--brand-dim-strong)",
                }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  style={{ color: "var(--brand-light)" }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
              </div>
              <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
                Select an endpoint to see code examples
              </p>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
