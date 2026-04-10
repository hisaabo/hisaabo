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
  const calledRef = useRef(false);

  const token = new URLSearchParams(window.location.search).get("token");

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

    // Strip token from URL immediately to prevent Referer leakage
    window.history.replaceState({}, "", "/auth/verify");

    if (!token) {
      setError("No token found in URL.");
      return;
    }

    verifyMutation.mutate({ token });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
