import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Logo } from "@/components/ui/Logo";

export const Route = createFileRoute("/auth/confirm-email-change")({
  component: ConfirmEmailChangePage,
});

/**
 * Landing page of the "Confirm your new Hisaabo email address" email.
 *
 * Opening the link never changes anything by itself: the change is applied only
 * when the user, signed in to the account that asked for it, presses Confirm.
 * The API enforces the same rule (the token only works for the requesting
 * account's session), so a mailbox owner who is tricked into opening someone
 * else's request cannot move their address onto that account.
 */
function ConfirmEmailChangePage() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);
  // Captured once at mount; the effect below strips it from the URL (Referer safety).
  const [token] = useState(() => new URLSearchParams(window.location.search).get("token"));
  const { data: session, isLoading: sessionLoading } = trpc.auth.me.useQuery();

  useEffect(() => {
    window.history.replaceState({}, "", "/auth/confirm-email-change");
  }, []);

  const confirm = trpc.auth.confirmEmailChange.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      navigate({ to: "/settings" });
    },
    onError: (e) => setError(e.message),
  });

  let content: React.ReactNode;
  if (!token) {
    content = (
      <>
        <h1 className="text-lg font-semibold text-text-primary mb-2">Link not valid</h1>
        <p className="text-sm text-text-tertiary mb-6">No token found in this link. Request the email change again from Settings.</p>
        <button onClick={() => navigate({ to: "/" })} className="btn-primary w-full py-2.5">
          Go to Hisaabo
        </button>
      </>
    );
  } else if (sessionLoading) {
    content = <p className="text-sm text-text-tertiary">Just a moment</p>;
  } else if (!session?.user) {
    content = (
      <>
        <h1 className="text-lg font-semibold text-text-primary mb-2">You&rsquo;re signed out</h1>
        <p className="text-sm text-text-tertiary mb-6">
          Sign in to the account that requested this change, then open the link in your email again. If you didn&rsquo;t
          ask for it, ignore the email: nothing will change.
        </p>
        <button onClick={() => navigate({ to: "/login" })} className="btn-primary w-full py-2.5">
          Go to sign in
        </button>
      </>
    );
  } else {
    content = (
      <>
        <h1 className="text-lg font-semibold text-text-primary mb-2">
          Change sign-in email for {session.user.email}?
        </h1>
        <p className="text-sm text-text-tertiary mb-6">
          This account asked to use the address this link was sent to as its sign-in email. Only confirm if that was you.
        </p>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400 mb-4">
            {error}
          </p>
        )}
        <button
          onClick={() => {
            setError(null);
            confirm.mutate({ token });
          }}
          disabled={confirm.isPending}
          className="btn-primary w-full py-2.5 mb-3"
        >
          {confirm.isPending ? "Confirming…" : "Confirm"}
        </button>
        <button
          onClick={() => navigate({ to: "/" })}
          className="text-sm text-text-tertiary hover:text-text-primary underline underline-offset-2"
        >
          Cancel
        </button>
      </>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-surface-1">
      <div className="w-full max-w-[380px] rounded-2xl p-8 shadow-elevated bg-surface-0 border border-border-light text-center">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <Logo className="w-9 h-9" />
          <span className="font-semibold text-lg tracking-tight text-text-primary">Hisaabo</span>
        </div>
        {content}
      </div>
    </div>
  );
}
