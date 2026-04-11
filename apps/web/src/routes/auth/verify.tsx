import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Logo } from "@/components/ui/Logo";

export const Route = createFileRoute("/auth/verify")({
  component: VerifyPage,
});

function VerifyPage() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);
  // Capture token + source ONCE from the URL at mount, before the effect
  // strips the query string for Referer safety. Lazy init keeps the values
  // available for the hand-off UI (and its manual retry button) after
  // history.replaceState has cleared window.location.search.
  const [token] = useState(() =>
    new URLSearchParams(window.location.search).get("token")
  );
  const [source] = useState(() =>
    new URLSearchParams(window.location.search).get("source")
  );
  // When the sign-in was initiated from a desktop or mobile client, the
  // verify page hands off to the native app via the `hisaabo://` scheme
  // instead of consuming the token in the browser. Emails ship the HTTPS
  // URL as the clickable CTA because email clients strip custom URL
  // schemes — see the rationale in packages/api/src/routers/auth.ts
  // (sendMagicLink). `handoffMode` drives the "Opening Hisaabo…" UI.
  const [handoffMode, setHandoffMode] = useState<"desktop" | "mobile" | null>(null);
  const calledRef = useRef(false);

  const verifyMutation = trpc.auth.verifyMagicLink.useMutation({
    onSuccess: (data) => {
      utils.auth.me.invalidate();
      const pendingToken = localStorage.getItem("pendingInviteToken");
      if (data.needsProfile) {
        navigate({
          to: "/auth/complete-profile",
          search: pendingToken ? { invite: "1" } : undefined,
        });
      } else if (pendingToken) {
        navigate({ to: `/invite/${pendingToken}` });
      } else {
        navigate({ to: "/" });
      }
    },
    onError: (e) => setError(e.message),
  });

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    // Strip token AND source from the URL immediately to prevent Referer
    // leakage and to stop a browser reload from re-triggering a spent token.
    window.history.replaceState({}, "", "/auth/verify");

    if (!token) {
      setError("No token found in URL.");
      return;
    }

    // Hand off to the native app when the sign-in originated there. The
    // token is consumed inside the app's own `verifyMagicLink` call — not
    // here in the browser — so the user ends up authenticated inside the
    // Tauri/Expo app, which is what they wanted.
    if (source === "desktop" || source === "mobile") {
      setHandoffMode(source);
      window.location.href = `hisaabo://verify?token=${encodeURIComponent(token)}`;
      return;
    }

    verifyMutation.mutate({ token });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function retryHandoff() {
    if (!token) return;
    window.location.href = `hisaabo://verify?token=${encodeURIComponent(token)}`;
  }

  function verifyInBrowser() {
    if (!token) return;
    setHandoffMode(null);
    verifyMutation.mutate({ token });
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-surface-1">
      <div className="w-full max-w-[380px] rounded-2xl p-8 shadow-elevated bg-surface-0 border border-border-light text-center">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <Logo className="w-9 h-9" />
          <span className="font-semibold text-lg tracking-tight text-text-primary">
            Hisaabo
          </span>
        </div>

        {error ? (
          <>
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center">
              <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-text-primary mb-2">
              Link expired or invalid
            </h1>
            <p className="text-sm text-text-tertiary mb-6">{error}</p>
            <button
              onClick={() => navigate({ to: "/login" })}
              className="btn-primary w-full py-2.5"
            >
              Back to sign in
            </button>
          </>
        ) : handoffMode ? (
          <>
            <div className="w-12 h-12 mx-auto mb-4 flex items-center justify-center">
              <Logo className="w-12 h-12" />
            </div>
            <h1 className="text-lg font-semibold text-text-primary mb-1">
              Opening Hisaabo{handoffMode === "desktop" ? " Desktop" : ""}…
            </h1>
            <p className="text-sm text-text-tertiary mb-6">
              We&rsquo;re handing your sign-in off to the {handoffMode === "desktop" ? "desktop app" : "mobile app"}. If nothing happens, tap the button below.
            </p>
            <button
              onClick={retryHandoff}
              className="btn-primary w-full py-2.5 mb-3"
            >
              Open Hisaabo {handoffMode === "desktop" ? "Desktop" : "App"}
            </button>
            <button
              onClick={verifyInBrowser}
              className="text-sm text-text-tertiary hover:text-text-primary underline underline-offset-2"
            >
              Sign in here in the browser instead
            </button>
          </>
        ) : (
          <>
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-brand-100 dark:bg-brand-600/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-brand-600 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-text-primary mb-1">
              Verifying your link...
            </h1>
            <p className="text-sm text-text-tertiary">
              Just a moment
            </p>
          </>
        )}
      </div>
    </div>
  );
}
