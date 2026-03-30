import React, { useState, useMemo } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { allEndpointGroups } from "../content";

interface Props {
  onNavigate?: () => void;
}

function MethodPill({ method }: { method: "query" | "mutation" }) {
  if (method === "query") {
    return (
      <span className="inline-flex items-center justify-center w-[28px] text-[9px] font-bold font-mono rounded-full shrink-0 py-[2px] tracking-wide"
        style={{ background: "rgba(16, 185, 129, 0.12)", color: "#10b981", border: "1px solid rgba(16, 185, 129, 0.2)" }}>
        GET
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-[28px] text-[9px] font-bold font-mono rounded-full shrink-0 py-[2px] tracking-wide"
      style={{ background: "rgba(249, 115, 22, 0.12)", color: "#f97316", border: "1px solid rgba(249, 115, 22, 0.2)" }}>
      POST
    </span>
  );
}

export function Sidebar({ onNavigate }: Props) {
  const { groupId, endpointId } = useParams<{ groupId?: string; endpointId?: string }>();
  const navigate = useNavigate();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(groupId ? [groupId] : [allEndpointGroups[0]?.id])
  );
  const [searchQuery, setSearchQuery] = useState("");

  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Filter endpoints based on search query
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase();
    return allEndpointGroups
      .map((group) => ({
        ...group,
        endpoints: group.endpoints.filter(
          (ep) =>
            ep.title.toLowerCase().includes(q) ||
            ep.path.toLowerCase().includes(q) ||
            group.title.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.endpoints.length > 0);
  }, [searchQuery]);

  const displayGroups = filteredGroups ?? allEndpointGroups;

  return (
    <nav
      className="flex flex-col h-full"
      style={{ background: "var(--bg-sidebar)" }}
      aria-label="API Reference navigation"
    >
      {/* Logo / Title */}
      <div
        className="px-4 py-4 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <Link
          to="/"
          className="flex items-center gap-2.5 group mb-4"
          onClick={onNavigate}
        >
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
            style={{ background: "var(--brand)" }}
          >
            H
          </div>
          <div>
            <div className="text-[13px] font-semibold text-white leading-tight">Hisaabo</div>
            <div className="text-[10px] leading-tight" style={{ color: "var(--text-muted)" }}>API Reference</div>
          </div>
        </Link>

        {/* Search */}
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
            style={{ color: "var(--text-muted)" }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search endpoints..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-[12px] rounded-md outline-none transition-colors"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--border-mid)",
              color: "var(--text-primary)",
              caretColor: "var(--brand-light)",
            }}
            onFocus={(e) => {
              e.target.style.borderColor = "var(--brand)";
              e.target.style.background = "rgba(99, 102, 241, 0.05)";
            }}
            onBlur={(e) => {
              e.target.style.borderColor = "var(--border-mid)";
              e.target.style.background = "rgba(255,255,255,0.04)";
            }}
          />
          {searchQuery && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded transition-colors hover:opacity-100 opacity-60"
              onClick={() => setSearchQuery("")}
              style={{ color: "var(--text-tertiary)" }}
              aria-label="Clear search"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Overview link */}
      {!searchQuery && (
        <div className="px-3 pt-3 pb-1 flex-shrink-0">
          <Link
            to="/"
            className={`sidebar-item flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] w-full
              ${!groupId ? "sidebar-item-active" : "hover:bg-[#1a1a2e]"}`}
            style={{ color: !groupId ? "var(--brand-light)" : "var(--text-secondary)" }}
            onClick={onNavigate}
          >
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Overview
          </Link>
        </div>
      )}

      {/* Section label */}
      {!searchQuery && (
        <div className="px-4 pb-1.5 pt-3 flex-shrink-0">
          <span className="section-label">Endpoints</span>
        </div>
      )}

      {searchQuery && (
        <div className="px-4 py-2 flex-shrink-0">
          <span className="section-label">
            {displayGroups.reduce((acc, g) => acc + g.endpoints.length, 0)} result{displayGroups.reduce((acc, g) => acc + g.endpoints.length, 0) !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* Endpoint groups */}
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {displayGroups.length === 0 && searchQuery && (
          <div className="px-3 py-6 text-center">
            <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>No endpoints found</p>
          </div>
        )}

        {displayGroups.map((group) => {
          const isExpanded = searchQuery ? true : expandedGroups.has(group.id);
          const isActiveGroup = groupId === group.id;

          return (
            <div key={group.id} className="mb-0.5">
              {/* Group header */}
              {!searchQuery && (
                <button
                  onClick={() => {
                    toggleGroup(group.id);
                    navigate(`/group/${group.id}`);
                    onNavigate?.();
                  }}
                  className={`sidebar-item flex items-center justify-between w-full px-3 py-1.5 rounded-md text-[13px] text-left
                    ${isActiveGroup
                      ? "text-white font-medium"
                      : "hover:bg-[#1a1a2e]"
                    }`}
                  style={{ color: isActiveGroup ? "#fff" : "var(--text-secondary)" }}
                >
                  <span>{group.title}</span>
                  <svg
                    className="w-3 h-3 flex-shrink-0 transition-transform duration-200"
                    style={{
                      color: "var(--text-muted)",
                      transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                    }}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}

              {searchQuery && (
                <div className="px-3 py-1 mt-1">
                  <span className="section-label">{group.title}</span>
                </div>
              )}

              {/* Endpoint list */}
              {isExpanded && (
                <div
                  className={`${searchQuery ? "" : "ml-2 pl-3"} mt-0.5`}
                  style={searchQuery ? {} : { borderLeft: "1px solid var(--border-mid)" }}
                >
                  {group.endpoints.map((ep) => {
                    const isActive = endpointId === ep.id;
                    return (
                      <Link
                        key={ep.id}
                        to={`/group/${group.id}/endpoint/${ep.id}`}
                        onClick={onNavigate}
                        className={`sidebar-item flex items-center gap-2 px-2 py-[5px] rounded-md text-[12px] my-0.5 relative
                          ${isActive ? "sidebar-item-active" : "hover:bg-[#1a1a2e]"}`}
                        style={{ color: isActive ? "var(--brand-light)" : "var(--text-tertiary)" }}
                      >
                        <MethodPill method={ep.method} />
                        <span className="truncate leading-tight">{ep.title}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer links */}
      <div
        className="flex-shrink-0 px-4 py-3"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/hisaabo"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[11px] transition-colors"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
            </svg>
            GitHub
          </a>
          <a
            href="https://hisaabo.in"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[11px] transition-colors"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
            Hisaabo.in
          </a>
        </div>
      </div>
    </nav>
  );
}
