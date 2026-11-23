import { useState, useRef, useEffect } from "react";
import { Dialog } from "./Dialog";
import { ArrowLeftIcon, Spinner } from "./Icons";

interface PhoneVerifyProps {
  slug: string;
  /** When true the customer must enter an SMS code before checkout. */
  otpRequired?: boolean;
  onVerified: (phone: string, name: string, isNew: boolean, turnstileToken: string, otpToken?: string) => void;
  onBack: () => void;
}

const RESEND_SECONDS = 30;

export function PhoneVerify({ slug, otpRequired = false, onVerified, onBack }: PhoneVerifyProps) {
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
  const title =
    stage === "name" ? "Welcome" : stage === "code" ? "Enter the code" : "Enter your mobile number";

  // One tree for every step so the Turnstile widget (mounted once) is never
  // unmounted; it is only hidden once a code is no longer needed.
  return (
    <Dialog variant="modal" size="sm" title={title} closeLabel="Close and go back to the cart" onClose={onBack}>
      {stage === "name" && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => { setShowNameInput(false); if (otpRequired) backToPhone(); else resetWidget(); }}
            className="back-btn"
          >
            <ArrowLeftIcon size={16} /> Back
          </button>

          <p className="text-sm" style={{ color: "var(--store-text-secondary)" }}>
            Looks like you are new here. What should we call you?
          </p>

          <div className="field">
            <label htmlFor="pv-name" className="field-label">Your name</label>
            <input
              id="pv-name"
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(""); }}
              autoComplete="name"
              data-autofocus
              autoFocus
              className="input"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "pv-error" : undefined}
              onKeyDown={(e) => e.key === "Enter" && handleNameSubmit()}
            />
          </div>

          {error && <p id="pv-error" role="alert" className="field-error">{error}</p>}

          <button type="button" onClick={handleNameSubmit} className="btn btn-primary btn-block">
            Continue to checkout
          </button>
        </div>
      )}

      {stage === "code" && (
        <div className="space-y-4">
          <button type="button" onClick={backToPhone} className="back-btn">
            <ArrowLeftIcon size={16} /> Change number
          </button>

          <p className="text-sm" style={{ color: "var(--store-text-secondary)" }}>
            We sent a 6-digit code by SMS to +91 {phone}.
          </p>

          <div className="field">
            <label htmlFor="pv-code" className="field-label">Verification code</label>
            <input
              id="pv-code"
              type="text"
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="one-time-code"
              data-autofocus
              autoFocus
              className="input text-center tracking-widest"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "pv-error" : undefined}
              onKeyDown={(e) => e.key === "Enter" && handleVerifyCode()}
            />
          </div>
        </div>
      )}

      {stage === "phone" && (
        <div className="space-y-4">
          <p className="text-sm" style={{ color: "var(--store-text-secondary)" }}>
            {otpRequired ? "We will text you a code to verify it." : "We will use this to process your order."}
          </p>

          <div className="field">
            <label htmlFor="pv-phone" className="field-label">Mobile number</label>
            <div className="input-group">
              <span className="input-addon" aria-hidden="true">+91</span>
              <input
                id="pv-phone"
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value.replace(/\D/g, "").slice(0, 10));
                  setError("");
                }}
                placeholder="9876543210"
                inputMode="numeric"
                autoComplete="tel-national"
                data-autofocus
                autoFocus
                className="input"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "pv-error" : undefined}
                onKeyDown={(e) => e.key === "Enter" && handleIdentify()}
              />
            </div>
          </div>
        </div>
      )}

      {/* Turnstile widget (needed to request a code or identify) */}
      <div ref={turnstileRef} className={stage === "name" || (stage === "code" && resendIn > 0) ? "hidden" : "mt-4"} />

      {stage !== "name" && error && (
        <p id="pv-error" role="alert" className="field-error mt-3">
          {error}
        </p>
      )}

      {stage === "phone" && (
        <button
          type="button"
          onClick={handleIdentify}
          disabled={loading || phone.length !== 10}
          className="btn btn-primary btn-block mt-4"
        >
          {loading ? (
            <>
              <Spinner /> {otpRequired ? "Sending code..." : "Verifying..."}
            </>
          ) : (
            otpRequired ? "Send code" : "Continue"
          )}
        </button>
      )}

      {stage === "code" && (
        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={handleVerifyCode}
            disabled={loading || code.length !== 6}
            className="btn btn-primary btn-block"
          >
            {loading ? (
              <>
                <Spinner /> Verifying...
              </>
            ) : (
              "Verify"
            )}
          </button>
          <button
            type="button"
            onClick={handleSendCode}
            disabled={loading || resendIn > 0}
            className="btn btn-quiet btn-block"
          >
            {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
          </button>
        </div>
      )}
    </Dialog>
  );
}
