import { useState, useRef, useEffect } from "react";

interface PhoneVerifyProps {
  slug: string;
  accentColor: string;
  /** When true the customer must enter an SMS code before checkout. */
  otpRequired?: boolean;
  onVerified: (phone: string, name: string, isNew: boolean, turnstileToken: string, otpToken?: string) => void;
  onBack: () => void;
}

const RESEND_SECONDS = 30;

export function PhoneVerify({ slug, accentColor, otpRequired = false, onVerified, onBack }: PhoneVerifyProps) {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showNameInput, setShowNameInput] = useState(false);
  const [name, setName] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const otpTokenRef = useRef<string>("");
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const tokenRef = useRef<string>("");

  // Render Turnstile widget on mount
  useEffect(() => {
    if (!turnstileRef.current) return;

    // The always-pass test key is dev-only; production builds must configure a real key.
    const configuredKey =
      (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ||
      (import.meta.env.PROD ? undefined : "1x00000000000000000000AA");
    if (!configuredKey) {
      setError("Verification is not configured. Please contact the store.");
      return;
    }
    const siteKey: string = configuredKey;

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

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  function storeUrl(path: string) {
    const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || "";
    const prefix = API_URL ? `${API_URL}/store` : "";
    return `${prefix}/${slug}/${path}`;
  }

  async function postJson<T>(path: string, body: unknown, fallback: string): Promise<T> {
    // `credentials: "omit"` — never attach cookies to these public endpoints.
    const res = await fetch(storeUrl(path), {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json", "X-Requested-With": "hisaabo" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: fallback })) as { error?: string };
      throw new Error(err.error || fallback);
    }
    return res.json() as Promise<T>;
  }

  async function handleSendCode() {
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
      await postJson("otp/send", { phone: `+91${phone}`, turnstileToken: tokenRef.current }, "Could not send the code");
      setCodeSent(true);
      setCode("");
      setResendIn(RESEND_SECONDS);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      // Turnstile tokens are single-use.
      resetWidget();
      setLoading(false);
    }
  }

  async function handleVerifyCode() {
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code we sent you");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await postJson<{ otpToken: string; known: boolean; name?: string }>(
        "otp/verify",
        { phone: `+91${phone}`, code },
        "Invalid or expired code",
      );
      otpTokenRef.current = data.otpToken;
      if (data.known && data.name && !/^(walk.?in|cash|misc|general)/i.test(data.name)) {
        onVerified(`+91${phone}`, data.name, false, "", data.otpToken);
      } else {
        setShowNameInput(true);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function backToPhone() {
    setCodeSent(false);
    setCode("");
    setError("");
    resetWidget();
  }

  async function handleIdentify() {
    if (otpRequired) return handleSendCode();
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
      // `credentials: "omit"` — never attach cookies (the admin
      // `session_id` cookie from a same-origin self-hosted deploy would
      // otherwise trip CSRF / identity boundaries on this public
      // endpoint). `X-Requested-With` is defence in depth so the client
      // keeps working if the server's `/store/*` CSRF exemption is
      // later narrowed.
      const res = await fetch(storeUrl("identify"), {
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

      // The API may omit `name` (it no longer discloses customer names), so a
      // missing name falls through to the name prompt.
      if (data.known && data.name && !/^(walk.?in|cash|misc|general)/i.test(data.name)) {
        // Known customer — proceed straight to checkout with their name + the verified token
        onVerified(`+91${phone}`, data.name, false, tokenRef.current);
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
    onVerified(`+91${phone}`, name.trim(), true, tokenRef.current, otpTokenRef.current || undefined);
  }

  const stage = showNameInput ? "name" : codeSent ? "code" : "phone";

  // One tree for every step so the Turnstile widget (mounted once) is never
  // unmounted; it is only hidden once a code is no longer needed.
  return (
    <div className="max-w-sm mx-auto px-6 py-8 animate-fade-in">
      {stage === "name" && (
        <>
          <button
            onClick={() => { setShowNameInput(false); if (otpRequired) backToPhone(); else resetWidget(); }}
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
        </>
      )}

      {stage === "code" && (
        <>
          <button
            onClick={backToPhone}
            className="flex items-center gap-1.5 text-sm font-medium mb-6"
            style={{ color: accentColor }}
          >
            <BackIcon color={accentColor} /> Change number
          </button>

          <h2 className="text-xl font-bold mb-1" style={{ color: "var(--store-text)" }}>
            Enter the code
          </h2>
          <p className="text-sm mb-5" style={{ color: "var(--store-muted)" }}>
            We sent a 6-digit code by SMS to +91 {phone}
          </p>

          <input
            type="text"
            value={code}
            onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }}
            placeholder="123456"
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="Verification code"
            autoFocus
            className="store-input w-full mb-3 tracking-widest text-center"
            onKeyDown={(e) => e.key === "Enter" && handleVerifyCode()}
          />
        </>
      )}

      {stage === "phone" && (
        <>
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
            {otpRequired ? "We'll text you a code to verify it" : "We'll use this to process your order"}
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
        </>
      )}

      {/* Turnstile widget (needed to request a code or identify) */}
      <div ref={turnstileRef} className={stage === "name" || (stage === "code" && resendIn > 0) ? "hidden" : "mb-3"} />

      {stage !== "name" && error && (
        <p className="text-xs font-medium mb-3" style={{ color: "var(--store-danger)" }}>
          {error}
        </p>
      )}

      {stage === "phone" && (
        <button
          onClick={handleIdentify}
          disabled={loading || phone.length !== 10}
          className="btn-primary w-full py-3 text-base"
          style={{ background: accentColor }}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <Spinner /> {otpRequired ? "Sending code..." : "Verifying..."}
            </span>
          ) : (
            otpRequired ? "Send code" : "Continue"
          )}
        </button>
      )}

      {stage === "code" && (
        <>
          <button
            onClick={handleVerifyCode}
            disabled={loading || code.length !== 6}
            className="btn-primary w-full py-3 text-base"
            style={{ background: accentColor }}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Spinner /> Verifying...
              </span>
            ) : (
              "Verify"
            )}
          </button>
          <button
            onClick={handleSendCode}
            disabled={loading || resendIn > 0}
            className="w-full mt-3 text-sm font-medium disabled:opacity-60"
            style={{ color: accentColor }}
          >
            {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
          </button>
        </>
      )}
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
