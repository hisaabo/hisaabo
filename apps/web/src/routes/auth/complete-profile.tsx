import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { trpc } from "@/lib/trpc";

export const Route = createFileRoute("/auth/complete-profile")({
  component: CompleteProfilePage,
});

// ── Steps: "name" → "org-choice" (if invite) → "done" ─────────────────────
type Step = "name" | "org-choice" | "done";

function CompleteProfilePage() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [doneMessage, setDoneMessage] = useState("");

  const pendingToken = localStorage.getItem("pendingInviteToken");

  // Peek at invitation to show org name before accepting
  const { data: inviteInfo } = trpc.tenant.peekInvitation.useQuery(
    { token: pendingToken! },
    { enabled: !!pendingToken },
  );

  const acceptInviteMutation = trpc.tenant.acceptInvitation.useMutation();
  const selectTenantMutation = trpc.tenant.select.useMutation();

  const profileMutation = trpc.auth.completeProfile.useMutation({
    onSuccess: async () => {
      await utils.auth.me.refetch();

      // If there's a pending invite, show the org choice step
      if (pendingToken && inviteInfo) {
        setStep("org-choice");
      } else {
        // No invite — go straight to business creation
        setDoneMessage("Setting up your account...");
        setStep("done");
        setTimeout(() => navigate({ to: "/settings" }), 800);
      }
    },
    onError: (e) => setError(e.message),
  });

  function handleNameSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (name.trim().length < 2) {
      setError("Name must be at least 2 characters");
      return;
    }
    profileMutation.mutate({ name: name.trim() });
  }

  async function handleJoinInvitedOrg() {
    if (!pendingToken) return;
    setError("");
    try {
      const result = await acceptInviteMutation.mutateAsync({ token: pendingToken });
      await selectTenantMutation.mutateAsync({ tenantId: result.tenantId });
      localStorage.removeItem("pendingInviteToken");
      await utils.auth.me.refetch();
      utils.tenant.list.invalidate();
      utils.business.list.invalidate();
      setDoneMessage(`Joining ${result.tenantName}...`);
      setStep("done");
      setTimeout(() => navigate({ to: "/", search: { joined: result.tenantName } }), 800);
    } catch (err) {
      localStorage.removeItem("pendingInviteToken");
      setError(err instanceof Error ? err.message : "Failed to accept invitation");
    }
  }

  function handleCreateOwn() {
    localStorage.removeItem("pendingInviteToken");
    setDoneMessage("Setting up your organization...");
    setStep("done");
    setTimeout(() => navigate({ to: "/settings" }), 800);
  }

  // ── Shared shell ──────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-surface-1">
      <div className="w-full max-w-[380px] rounded-2xl p-8 shadow-elevated bg-surface-0 border border-border-light">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-9 h-9 rounded-xl bg-brand-600 flex items-center justify-center">
            <span className="text-white font-bold text-base">H</span>
          </div>
          <span className="font-semibold text-lg tracking-tight text-text-primary">
            Hisaabo
          </span>
        </div>

        {/* ── Step 1: Name entry ─────────────────────────────────────── */}
        {step === "name" && (
          <>
            <h1 className="text-xl font-semibold mb-1 text-text-primary">
              {inviteInfo ? "Almost there!" : "Welcome to Hisaabo"}
            </h1>
            <p className="text-sm mb-6 text-text-tertiary">
              {inviteInfo
                ? `You've been invited to ${inviteInfo.tenantName}. First, tell us your name.`
                : "What should we call you?"}
            </p>

            {error && (
              <div className="mb-4 px-3 py-2 rounded-lg text-sm bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400">
                {error}
              </div>
            )}

            <form onSubmit={handleNameSubmit} className="space-y-4">
              <div>
                <label className="label">Your name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                  className="input"
                  placeholder="e.g. Raj Kumar"
                  minLength={2}
                />
              </div>
              <button
                type="submit"
                disabled={profileMutation.isPending}
                className="btn-primary w-full py-2.5"
              >
                {profileMutation.isPending ? "Saving..." : "Continue"}
              </button>
            </form>
          </>
        )}

        {/* ── Step 2: Org choice (only if invite exists) ─────────────── */}
        {step === "org-choice" && inviteInfo && (
          <>
            <h1 className="text-xl font-semibold mb-1 text-text-primary">
              Hi {name}! Choose how to continue
            </h1>
            <p className="text-sm mb-6 text-text-tertiary">
              You were invited to join an organization, or you can start fresh with your own.
            </p>

            {error && (
              <div className="mb-4 px-3 py-2 rounded-lg text-sm bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="space-y-3">
              {/* Join invited org */}
              <button
                onClick={handleJoinInvitedOrg}
                disabled={acceptInviteMutation.isPending}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border-2 border-brand-200 bg-brand-50/50 hover:border-brand-400 hover:bg-brand-50 transition-colors text-left group dark:border-brand-600/30 dark:bg-brand-600/10 dark:hover:border-brand-500"
              >
                <div className="w-10 h-10 rounded-lg bg-brand-600 flex items-center justify-center text-white font-semibold text-lg shrink-0">
                  {inviteInfo.tenantName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary group-hover:text-brand-700 dark:group-hover:text-brand-400 transition-colors truncate">
                    Join {inviteInfo.tenantName}
                  </p>
                  <p className="text-xs text-text-tertiary">
                    as {inviteInfo.role}
                  </p>
                </div>
                {acceptInviteMutation.isPending && (
                  <div className="ml-auto w-4 h-4 border-2 border-brand-600 border-t-transparent rounded-full animate-spin shrink-0" />
                )}
              </button>

              {/* Create own org */}
              <button
                onClick={handleCreateOwn}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-border-light hover:border-border-medium hover:bg-surface-1 transition-colors text-left group"
              >
                <div className="w-10 h-10 rounded-lg bg-surface-2 flex items-center justify-center text-text-secondary shrink-0">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary">
                    Create my own organization
                  </p>
                  <p className="text-xs text-text-tertiary">
                    Start fresh with a new business
                  </p>
                </div>
              </button>
            </div>
          </>
        )}

        {/* ── Step 3: Done ───────────────────────────────────────────── */}
        {step === "done" && (
          <div className="text-center py-4">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <svg className="w-6 h-6 text-emerald-600" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-text-primary">
              Welcome, {name}!
            </h1>
            <p className="text-sm text-text-tertiary mt-1">
              {doneMessage}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
