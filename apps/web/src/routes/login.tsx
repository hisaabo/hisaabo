import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

type AuthMode = "magic-link" | "magic-link-sent" | "password-login" | "register";

function LoginPage() {
  const [mode, setMode] = useState<AuthMode>("magic-link");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      navigate({ to: "/" });
    },
    onError: (e) => setError(e.message),
  });

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      navigate({ to: "/" });
    },
    onError: (e) => setError(e.message),
  });

  const magicLinkMutation = trpc.auth.sendMagicLink.useMutation({
    onSuccess: () => {
      setMode("magic-link-sent");
      setCooldown(60);
      setError("");
    },
    onError: (e) => setError(e.message),
  });

  // Cooldown timer for resend
  useEffect(() => {
    if (cooldown <= 0) {
      clearInterval(cooldownRef.current);
      return;
    }
    cooldownRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) { clearInterval(cooldownRef.current); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(cooldownRef.current);
  }, [cooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const isPending = loginMutation.isPending || registerMutation.isPending || magicLinkMutation.isPending;

  function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    magicLinkMutation.mutate({ email });
  }

  function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    loginMutation.mutate({ email, password });
  }

  function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    registerMutation.mutate({ email, password, confirmPassword, name });
  }

  function handleResend() {
    if (cooldown > 0) return;
    magicLinkMutation.mutate({ email });
    setCooldown(60);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-surface-1">
      <div className="w-full max-w-[380px] rounded-2xl p-8 shadow-elevated bg-surface-0 border border-border-light">
        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-9 h-9 rounded-xl bg-brand-600 flex items-center justify-center">
            <span className="text-white font-bold text-base">H</span>
          </div>
          <span className="font-semibold text-lg tracking-tight text-text-primary">
            Hisaabo
          </span>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg text-sm bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400">
            {error}
          </div>
        )}

        {/* ── Magic link: enter email ────────────────────────────── */}
        {mode === "magic-link" && (
          <>
            <h1 className="text-xl font-semibold mb-1 text-text-primary">Sign in to Hisaabo</h1>
            <p className="text-sm mb-6 text-text-tertiary">
              Enter your email to receive a sign-in link
            </p>

            <form onSubmit={handleMagicLink} className="space-y-3.5">
              <div>
                <label className="label">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  className="input"
                  placeholder="you@example.com"
                />
              </div>

              <button type="submit" disabled={isPending} className="btn-primary w-full py-2.5">
                {isPending ? "Sending..." : "Send magic link"}
              </button>
            </form>

            <p className="text-center text-xs text-text-tertiary mt-4">
              No account yet? Just enter your email — we'll create one automatically.
            </p>

            <div className="mt-5 pt-4 border-t border-border-light text-center">
              <button
                onClick={() => { setMode("password-login"); setError(""); }}
                className="text-sm text-text-tertiary hover:text-text-secondary"
              >
                Use password instead
              </button>
            </div>
          </>
        )}

        {/* ── Magic link: sent ───────────────────────────────────── */}
        {mode === "magic-link-sent" && (
          <div className="text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-brand-100 dark:bg-brand-600/20 flex items-center justify-center">
              <svg className="w-7 h-7 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>

            <h1 className="text-xl font-semibold mb-1 text-text-primary">Check your email</h1>
            <p className="text-sm text-text-tertiary mb-1">
              We sent a sign-in link to
            </p>
            <p className="text-sm font-medium text-text-primary mb-4">{email}</p>
            <p className="text-xs text-text-tertiary mb-6">
              The link expires in 15 minutes
            </p>

            <button
              onClick={handleResend}
              disabled={cooldown > 0 || magicLinkMutation.isPending}
              className="btn-ghost w-full py-2"
            >
              {cooldown > 0
                ? `Resend in ${cooldown}s`
                : magicLinkMutation.isPending
                  ? "Sending..."
                  : "Didn't receive it? Send again"
              }
            </button>

            <button
              onClick={() => { setMode("magic-link"); setError(""); }}
              className="text-sm text-text-tertiary hover:text-text-secondary mt-3"
            >
              Use a different email
            </button>
          </div>
        )}

        {/* ── Password login ─────────────────────────────────────── */}
        {mode === "password-login" && (
          <>
            <h1 className="text-xl font-semibold mb-1 text-text-primary">Sign in with password</h1>
            <p className="text-sm mb-6 text-text-tertiary">
              Enter your email and password
            </p>

            <form onSubmit={handlePasswordLogin} className="space-y-3.5">
              <div>
                <label className="label">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="input"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label className="label">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="input"
                  placeholder="Min 8 characters"
                />
              </div>

              <button type="submit" disabled={isPending} className="btn-primary w-full py-2.5">
                {isPending ? "Signing in..." : "Sign in"}
              </button>
            </form>

            <p className="text-center text-sm mt-5 text-text-tertiary">
              Don't have an account?{" "}
              <button
                onClick={() => { setMode("register"); setError(""); }}
                className="text-brand-600 hover:text-brand-700 font-medium"
              >
                Sign up
              </button>
            </p>

            <div className="mt-4 pt-4 border-t border-border-light text-center">
              <button
                onClick={() => { setMode("magic-link"); setError(""); }}
                className="text-sm text-text-tertiary hover:text-text-secondary"
              >
                Use magic link instead
              </button>
            </div>
          </>
        )}

        {/* ── Register ───────────────────────────────────────────── */}
        {mode === "register" && (
          <>
            <h1 className="text-xl font-semibold mb-1 text-text-primary">Create account</h1>
            <p className="text-sm mb-6 text-text-tertiary">Get started with Hisaabo</p>

            <form onSubmit={handleRegister} className="space-y-3.5">
              <div>
                <label className="label">Full name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="input"
                  placeholder="Your name"
                />
              </div>

              <div>
                <label className="label">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="input"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label className="label">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="input"
                  placeholder="Min 8 characters"
                />
              </div>

              <div>
                <label className="label">Confirm password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="input"
                  placeholder="Repeat password"
                />
              </div>

              <button type="submit" disabled={isPending} className="btn-primary w-full py-2.5">
                {isPending ? "Creating..." : "Create account"}
              </button>
            </form>

            <p className="text-xs text-text-tertiary mt-2 text-center">
              This will create your organization and you'll be its owner.
            </p>

            <p className="text-center text-sm mt-5 text-text-tertiary">
              Already have an account?{" "}
              <button
                onClick={() => { setMode("password-login"); setError(""); }}
                className="text-brand-600 hover:text-brand-700 font-medium"
              >
                Sign in
              </button>
            </p>

            <div className="mt-4 pt-4 border-t border-border-light text-center">
              <button
                onClick={() => { setMode("magic-link"); setError(""); }}
                className="text-sm text-text-tertiary hover:text-text-secondary"
              >
                Or sign in with magic link
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
