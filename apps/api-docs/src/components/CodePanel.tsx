import React, { useState, useEffect, useCallback } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-python";
import "prismjs/components/prism-json";
import type { CodeExamples } from "../content/types";

type Language = "curl" | "javascript" | "python";

interface Props {
  examples: CodeExamples;
  outputExample: unknown;
}

const LANG_LABELS: Record<Language, string> = {
  javascript: "JavaScript",
  curl: "cURL",
  python: "Python",
};

const PRISM_LANGS: Record<Language, string> = {
  curl: "bash",
  javascript: "javascript",
  python: "python",
};

function highlight(code: string, lang: string): string {
  if (Prism.languages[lang]) {
    return Prism.highlight(code, Prism.languages[lang], lang);
  }
  return code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  }, [text]);

  if (copied) {
    return (
      <button
        className={`copy-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium ${className}`}
        style={{ color: "var(--green)" }}
        aria-label="Copied"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
        Copied!
      </button>
    );
  }

  return (
    <button
      onClick={handleCopy}
      className={`copy-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium ${className}`}
      style={{ color: "var(--text-muted)" }}
      aria-label="Copy to clipboard"
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
      Copy
    </button>
  );
}

function CodeWithLineNumbers({ code, lang }: { code: string; lang: string }) {
  // SECURITY: code originates from static developer-authored content files
  // (src/content/*.ts), never from user input. Prism.highlight() output is
  // trusted HTML safe for dangerouslySetInnerHTML.
  const highlighted = highlight(code, lang);
  const lines = highlighted.split("\n");

  return (
    <div className="flex">
      {/* Line numbers */}
      <div
        className="select-none flex-shrink-0 text-right pr-3"
        style={{
          color: "var(--text-muted)",
          fontFamily: "JetBrains Mono, Fira Code, monospace",
          fontSize: "12px",
          lineHeight: "1.75",
          minWidth: "2.5rem",
          paddingTop: "1px",
          userSelect: "none",
        }}
        aria-hidden="true"
      >
        {lines.map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>

      {/* Code */}
      <div className="flex-1 overflow-x-auto">
        <pre
          style={{
            margin: 0,
            fontFamily: "JetBrains Mono, Fira Code, monospace",
            fontSize: "12.5px",
            lineHeight: "1.75",
            color: "var(--text-code)",
          }}
        >
          <code
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        </pre>
      </div>
    </div>
  );
}

export function CodePanel({ examples, outputExample }: Props) {
  const [activeTab, setActiveTab] = useState<Language>("javascript");
  const [showResponse, setShowResponse] = useState(false);

  const availableLangs = (["javascript", "curl", "python"] as Language[]).filter(
    (l) => examples[l]
  );

  // Default to first available lang
  useEffect(() => {
    if (!examples[activeTab] && availableLangs.length > 0) {
      setActiveTab(availableLangs[0]);
    }
  }, [examples]);

  const currentCode = examples[activeTab] || "";
  const responseJson = JSON.stringify(outputExample, null, 2);

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: "var(--bg-code)" }}
    >
      {/* Tab bar */}
      <div
        className="flex items-center flex-shrink-0 px-4"
        style={{ borderBottom: "1px solid var(--border-mid)" }}
        role="tablist"
      >
        <div className="flex items-end gap-0 flex-1">
          {availableLangs.map((lang) => {
            const isActive = activeTab === lang;
            return (
              <button
                key={lang}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(lang)}
                className={`code-tab px-3 py-3 text-[12px] font-medium transition-colors ${isActive ? "code-tab-active" : ""}`}
                style={{
                  color: isActive ? "var(--brand-light)" : "var(--text-muted)",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.color = "var(--text-secondary)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.color = "var(--text-muted)";
                }}
              >
                {LANG_LABELS[lang]}
              </button>
            );
          })}
        </div>
        <CopyButton text={currentCode} />
      </div>

      {/* Code area */}
      <div className="flex-1 overflow-auto p-4">
        <CodeWithLineNumbers
          code={currentCode}
          lang={PRISM_LANGS[activeTab]}
        />
      </div>

      {/* Response section */}
      <div
        className="flex-shrink-0"
        style={{ borderTop: "1px solid var(--border-mid)" }}
      >
        <button
          onClick={() => setShowResponse((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 transition-colors"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <div className="flex items-center gap-2">
            <svg
              className="w-3.5 h-3.5"
              style={{ color: "var(--green)" }}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-[12px] font-medium">Response</span>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{
                background: "rgba(16, 185, 129, 0.08)",
                color: "var(--green)",
                border: "1px solid rgba(16, 185, 129, 0.15)",
              }}
            >
              200 OK
            </span>
          </div>
          <svg
            className="w-3.5 h-3.5 transition-transform duration-200"
            style={{
              color: "var(--text-muted)",
              transform: showResponse ? "rotate(180deg)" : "rotate(0deg)",
            }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showResponse && (
          <div
            className="relative"
            style={{ borderTop: "1px solid var(--border-mid)" }}
          >
            <div className="absolute top-2 right-2 z-10">
              <CopyButton text={responseJson} />
            </div>
            <div className="flex overflow-auto max-h-[360px]">
              {/* Line numbers for response */}
              <div
                className="select-none flex-shrink-0 text-right pr-3 pl-4 py-4"
                style={{
                  color: "var(--text-muted)",
                  fontFamily: "JetBrains Mono, Fira Code, monospace",
                  fontSize: "12px",
                  lineHeight: "1.75",
                  minWidth: "2.75rem",
                  userSelect: "none",
                  background: "rgba(8, 8, 16, 0.4)",
                }}
                aria-hidden="true"
              >
                {responseJson.split("\n").map((_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>
              <pre
                className="flex-1 py-4 pr-4 text-[12px] leading-[1.75]"
                style={{
                  background: "rgba(8, 8, 16, 0.4)",
                  fontFamily: "JetBrains Mono, Fira Code, monospace",
                  margin: 0,
                  color: "var(--text-code)",
                }}
              >
                <code
                  className="language-json"
                  // SECURITY: responseJson is produced by JSON.stringify() on
                  // static developer-authored outputExample objects from content
                  // files, never from user input. Safe for dangerouslySetInnerHTML.
                  dangerouslySetInnerHTML={{
                    __html: highlight(responseJson, "json"),
                  }}
                />
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
