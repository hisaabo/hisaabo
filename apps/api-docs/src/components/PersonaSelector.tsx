import React from "react";
import { PERSONAS, usePersona, type PersonaInfo } from "../lib/persona-context";

function PersonaIcon({ icon, size = 20 }: { icon: string; size?: number }) {
  const s = `w-[${size}px] h-[${size}px]`;
  switch (icon) {
    case "terminal":
      return (
        <svg className={s} width={size} height={size} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
    case "cpu":
      return (
        <svg className={s} width={size} height={size} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M3 9h2m-2 6h2m14-6h2m-2 6h2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
        </svg>
      );
    case "calculator":
      return (
        <svg className={s} width={size} height={size} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      );
    case "store":
      return (
        <svg className={s} width={size} height={size} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
        </svg>
      );
    default:
      return null;
  }
}

const PERSONA_COLORS: Record<string, string> = {
  developer: "#818cf8",
  "agent-builder": "#67e8f9",
  "ca-accountant": "#f59e0b",
  "business-owner": "#10b981",
};

function PersonaCard({
  info,
  isActive,
  onClick,
}: {
  info: PersonaInfo;
  isActive: boolean;
  onClick: () => void;
}) {
  const color = PERSONA_COLORS[info.id] ?? "var(--brand-light)";

  return (
    <button
      onClick={onClick}
      className="group relative text-left p-4 rounded-xl transition-all duration-200"
      style={{
        background: isActive ? `${color}12` : "var(--bg-card)",
        border: `1px solid ${isActive ? `${color}40` : "var(--border-mid)"}`,
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.borderColor = `${color}30`;
          e.currentTarget.style.background = "var(--bg-hover)";
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.borderColor = "var(--border-mid)";
          e.currentTarget.style.background = "var(--bg-card)";
        }
      }}
    >
      {isActive && (
        <div
          className="absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center"
          style={{ background: color }}
        >
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}

      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
        style={{
          background: `${color}15`,
          color,
          border: `1px solid ${color}25`,
        }}
      >
        <PersonaIcon icon={info.icon} size={20} />
      </div>

      <h3
        className="text-[14px] font-semibold mb-1"
        style={{ color: isActive ? color : "var(--text-primary)" }}
      >
        {info.title}
      </h3>
      <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
        {info.subtitle}
      </p>
    </button>
  );
}

/** Full-width persona chooser for the overview page */
export function PersonaBanner() {
  const { persona, setPersona } = usePersona();

  return (
    <div className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2
            className="text-[16px] font-semibold mb-1"
            style={{ color: "var(--text-primary)", letterSpacing: "-0.01em" }}
          >
            I am a...
          </h2>
          <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
            We'll highlight the endpoints most relevant to you.
          </p>
        </div>
        {persona && (
          <button
            onClick={() => setPersona(null)}
            className="text-[11px] px-2.5 py-1 rounded-md transition-colors"
            style={{
              color: "var(--text-muted)",
              border: "1px solid var(--border-mid)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text-secondary)";
              e.currentTarget.style.borderColor = "var(--border-light)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-muted)";
              e.currentTarget.style.borderColor = "var(--border-mid)";
            }}
          >
            Clear
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PERSONAS.map((info) => (
          <PersonaCard
            key={info.id}
            info={info}
            isActive={persona === info.id}
            onClick={() => setPersona(info.id)}
          />
        ))}
      </div>
    </div>
  );
}

/** Small pill in sidebar footer showing current persona */
export function PersonaPill() {
  const { persona, personaInfo, clearPersona, setPersona } = usePersona();
  const [showPicker, setShowPicker] = React.useState(false);

  if (!persona || !personaInfo) {
    return (
      <button
        onClick={() => setShowPicker((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] transition-colors relative"
        style={{ color: "var(--text-muted)" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
        Set role
        {showPicker && (
          <PersonaDropdown
            onSelect={(id) => {
              setPersona(id);
              setShowPicker(false);
            }}
            onClose={() => setShowPicker(false)}
          />
        )}
      </button>
    );
  }

  const color = PERSONA_COLORS[persona] ?? "var(--brand-light)";

  return (
    <div className="flex items-center gap-2 relative">
      <button
        onClick={() => setShowPicker((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] transition-colors"
        style={{ color }}
      >
        <PersonaIcon icon={personaInfo.icon} size={14} />
        <span className="font-medium">{personaInfo.title}</span>
      </button>
      <button
        onClick={clearPersona}
        className="text-[10px] transition-colors"
        style={{ color: "var(--text-muted)" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
        title="Clear role"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      {showPicker && (
        <PersonaDropdown
          onSelect={(id) => {
            setPersona(id);
            setShowPicker(false);
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}

function PersonaDropdown({
  onSelect,
  onClose,
}: {
  onSelect: (id: Exclude<import("../lib/persona-context").Persona, null>) => void;
  onClose: () => void;
}) {
  const { persona } = usePersona();

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="absolute bottom-full left-0 mb-2 w-48 py-1 rounded-lg z-50 shadow-xl"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-mid)",
        }}
      >
        {PERSONAS.map((info) => {
          const color = PERSONA_COLORS[info.id];
          const isActive = persona === info.id;
          return (
            <button
              key={info.id}
              onClick={() => onSelect(info.id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-left transition-colors"
              style={{
                color: isActive ? color : "var(--text-secondary)",
                background: isActive ? `${color}10` : "transparent",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = isActive ? `${color}15` : "var(--bg-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = isActive ? `${color}10` : "transparent";
              }}
            >
              <PersonaIcon icon={info.icon} size={14} />
              <span className="font-medium">{info.title}</span>
              {isActive && (
                <svg className="w-3 h-3 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}
