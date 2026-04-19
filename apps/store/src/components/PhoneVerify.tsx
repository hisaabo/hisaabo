import { useState, useRef, useEffect } from "react";

interface PhoneVerifyProps {
  slug: string;
  accentColor: string;
  onVerified: (phone: string, name: string, isNew: boolean, turnstileToken: string) => void;
  onBack: () => void;
}

export function PhoneVerify({ slug, accentColor, onVerified, onBack }: PhoneVerifyProps) {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showNameInput, setShowNameInput] = useState(false);
  const [name, setName] = useState("");
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const tokenRef = useRef<string>("");

  // Render Turnstile widget on mount
  useEffect(() => {
    if (!turnstileRef.current) return;

    const siteKey =
      (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ||
      "1x00000000000000000000AA"; // Cloudflare test key for dev

    const win = window as unknown as {
      turnstile?: {
        render: (
          el: HTMLElement,
          opts: {
            sitekey: string;
            callback: (token: string) => void;
            "error-callback": () => void;
            "expired-callback": () => void;
            theme: string;
            size: string;
          },
        ) => string;
        reset: (id: string) => void;
      };
    };

    function mount() {
      if (!turnstileRef.current || !win.turnstile) return;
      // Guard against double-render (React StrictMode in dev)
      if (widgetIdRef.current !== null) return;
      widgetIdRef.current = win.turnstile.render(turnstileRef.current, {
        sitekey: siteKey,
        callback: (token: string) => {
          tokenRef.current = token;
          setError((prev) => (prev === "Please complete the verification" ? "" : prev));
        },
        "error-callback": () => {
          setError("Verification widget error. Please refresh the page.");
        },
        "expired-callback": () => {
          tokenRef.current = "";
        },
        theme: "light",
        size: "flexible",
      });
    }

    // Turnstile may not be loaded yet (async script)
    if (win.turnstile) {
      mount();
    } else {
      // Poll briefly until the script loads
      const interval = setInterval(() => {
        if (win.turnstile) {
          clearInterval(interval);
          mount();
        }
      }, 100);
      return () => clearInterval(interval);
    }
  }, []);

  function resetWidget() {
    const win = window as unknown as {
      turnstile?: { reset: (id: string) => void };
    };
    if (win.turnstile && widgetIdRef.current) {
      win.turnstile.reset(widgetIdRef.current);
    }
    tokenRef.current = "";
  }

  async function handleIdentify() {
    if (phone.length !== 10) {
      setError("Please enter a valid 10-digit mobile number");
      return;
    }
    if (!tokenRef.current) {
      setError("Please complete the verification");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || "";
      const prefix = API_URL ? `${API_URL}/store` : "";
      // `credentials: "omit"` — never attach cookies (the admin
      // `session_id` cookie from a same-origin self-hosted deploy would
      // otherwise trip CSRF / identity boundaries on this public
      // endpoint). `X-Requested-With` is defence in depth so the client
      // keeps working if the server's `/store/*` CSRF exemption is
      // later narrowed.
      const res = await fetch(`${prefix}/${slug}/identify`, {
        method: "POST",
        credentials: "omit",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "hisaabo",
        },
        body: JSON.stringify({ phone: `+91${phone}`, turnstileToken: tokenRef.current }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Verification failed" })) as { error?: string };
        throw new Error(err.error || "Verification failed");
      }

      const data = await res.json() as { known: boolean; name?: string };

      if (data.known && data.name && !/^(walk.?in|cash|misc|general)/i.test(data.name)) {
        // Known customer — proceed straight to checkout with their name + the verified token
        onVerified(`+91${phone}`, data.name || "", false, tokenRef.current);
      } else {
        // New customer — ask for their name
        setShowNameInput(true);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      resetWidget();
    } finally {
      setLoading(false);
    }
  }

  function handleNameSubmit() {
    if (name.trim().length < 2) {
      setError("Please enter your name (at least 2 characters)");
      return;
    }
    onVerified(`+91${phone}`, name.trim(), true, tokenRef.current);
  }

  // ── Name input screen (new customer) ────────────────────────
  if (showNameInput) {
    return (
      <div className="max-w-sm mx-auto px-6 py-8 animate-fade-in">
        <button
          onClick={() => { setShowNameInput(false); resetWidget(); }}
          className="flex items-center gap-1.5 text-sm font-medium mb-6"
          style={{ color: accentColor }}
        >
          <BackIcon color={accentColor} /> Back
        </button>

        <h2 className="text-xl font-bold mb-1" style={{ color: "var(--store-text)" }}>
          Welcome!
        </h2>
        <p className="text-sm mb-5" style={{ color: "var(--store-muted)" }}>
          Looks like you're new here. What should we call you?
        </p>

        <input
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(""); }}
          placeholder="Your name"
          autoFocus
          className="store-input w-full mb-3"
          onKeyDown={(e) => e.key === "Enter" && handleNameSubmit()}
        />

        {error && (
          <p className="text-xs font-medium mb-3" style={{ color: "var(--store-danger)" }}>
            {error}
          </p>
        )}

        <button
          onClick={handleNameSubmit}
          className="btn-primary w-full py-3 text-base"
          style={{ background: accentColor }}
        >
          Continue to Checkout
        </button>
      </div>
    );
  }

  // ── Phone input screen ───────────────────────────────────────
  return (
    <div className="max-w-sm mx-auto px-6 py-8 animate-fade-in">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm font-medium mb-6"
        style={{ color: accentColor }}
      >
        <BackIcon color={accentColor} /> Back to cart
      </button>

      <h2 className="text-xl font-bold mb-1" style={{ color: "var(--store-text)" }}>
        Enter your mobile number
      </h2>
      <p className="text-sm mb-5" style={{ color: "var(--store-muted)" }}>
        We'll use this to process your order
      </p>

      {/* Phone input with +91 prefix */}
      <div className="flex mb-3">
        <span
          className="inline-flex items-center px-3.5 border border-r-0 rounded-l-lg text-sm font-medium flex-shrink-0"
          style={{
            background: "var(--store-bg-secondary)",
            borderColor: "var(--store-border)",
            color: "var(--store-text-secondary)",
          }}
        >
          +91
        </span>
        <input
          type="tel"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value.replace(/\D/g, "").slice(0, 10));
            setError("");
          }}
          placeholder="9876543210"
          inputMode="numeric"
          autoFocus
          className="store-input rounded-l-none flex-1"
          onKeyDown={(e) => e.key === "Enter" && handleIdentify()}
        />
      </div>

      {/* Turnstile widget */}
      <div ref={turnstileRef} className="mb-3" />

      {error && (
        <p className="text-xs font-medium mb-3" style={{ color: "var(--store-danger)" }}>
          {error}
        </p>
      )}

      <button
        onClick={handleIdentify}
        disabled={loading || phone.length !== 10}
        className="btn-primary w-full py-3 text-base"
        style={{ background: accentColor }}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <Spinner /> Verifying...
          </span>
        ) : (
          "Continue"
        )}
      </button>
    </div>
  );
}

function BackIcon({ color }: { color: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="16"
      height="16"
    >
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      width="18"
      height="18"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v8H4z"
      />
    </svg>
  );
}
