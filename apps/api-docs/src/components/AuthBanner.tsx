import React from "react";
import { useUser } from "../lib/user-context";

const APP_URL = import.meta.env.VITE_APP_URL || "https://app.hisaabo.in";

export function AuthBanner() {
  const { session, loading, error } = useUser();

  // Loading state -- only shows when VITE_API_URL is configured
  if (loading) {
    return (
      <div
        className="flex-shrink-0 flex items-center gap-2.5 px-4 py-2.5"
        style={{ borderBottom: "1px solid var(--border-mid)" }}
      >
        <div
          className="w-1.5 h-1.5 rounded-full animate-pulse"
          style={{ background: "var(--text-muted)" }}
        />
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          Connecting...
        </span>
      </div>
    );
  }

  // Authenticated state
  if (session?.user) {
    return (
      <div
        className="flex-shrink-0 px-4 py-2.5"
        style={{ borderBottom: "1px solid var(--border-mid)" }}
      >
        <div className="flex items-center gap-2 mb-1">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--green)" }} />
          <span className="text-[11px] font-semibold" style={{ color: "var(--green)" }}>
            Authenticated
          </span>
        </div>
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
          Signed in as{" "}
          <span className="font-medium" style={{ color: "var(--text-secondary)" }}>
            {session.user.email}
          </span>
        </p>
        {session.tenantName && (
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
            {session.tenantName}
            {session.role && (
              <span
                className="ml-2 px-1.5 py-0.5 rounded text-[10px]"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid var(--border-mid)",
                  color: "var(--text-tertiary)",
                }}
              >
                {session.role}
              </span>
            )}
          </p>
        )}
        <p className="text-[10px] mt-1.5" style={{ color: "var(--text-muted)" }}>
          Code examples use your real credentials.
        </p>
      </div>
    );
  }

  // Default: not connected / no API configured -- subtle, non-alarming notice
  return (
    <div
      className="flex-shrink-0 px-4 py-2.5"
      style={{ borderBottom: "1px solid var(--border-mid)" }}
    >
      <div className="flex items-center gap-2">
        <div
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: "var(--text-muted)" }}
        />
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          Static mode
        </span>
      </div>
    </div>
  );
}
