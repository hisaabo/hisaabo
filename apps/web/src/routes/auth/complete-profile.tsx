import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { trpc } from "@/lib/trpc";

export const Route = createFileRoute("/auth/complete-profile")({
  component: CompleteProfilePage,
});

function CompleteProfilePage() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const [saved, setSaved] = useState(false);

  const acceptInviteMutation = trpc.tenant.acceptInvitation.useMutation();
  const selectTenantMutation = trpc.tenant.select.useMutation();

  const mutation = trpc.auth.completeProfile.useMutation({
    onSuccess: async () => {
      await utils.auth.me.refetch();
      setSaved(true);

      const pendingToken = localStorage.getItem("pendingInviteToken");
      if (pendingToken) {
        try {
          const result = await acceptInviteMutation.mutateAsync({ token: pendingToken });
          await selectTenantMutation.mutateAsync({ tenantId: result.tenantId });
          localStorage.removeItem("pendingInviteToken");
          // Refetch session (now points to invited tenant) and invalidate
          // business list so root layout sees the correct tenant's businesses
          await utils.auth.me.refetch();
          utils.tenant.list.invalidate();
          utils.business.list.invalidate();
          setTimeout(() => navigate({ to: "/", search: { joined: result.tenantName } }), 800);
        } catch {
          localStorage.removeItem("pendingInviteToken");
          setTimeout(() => navigate({ to: "/" }), 800);
        }
      } else {
        setTimeout(() => navigate({ to: "/settings" }), 800);
      }
    },
    onError: (e) => setError(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (name.trim().length < 2) {
      setError("Name must be at least 2 characters");
      return;
    }
    mutation.mutate({ name: name.trim() });
  }

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

        {saved ? (
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
              {localStorage.getItem("pendingInviteToken")
                ? "Joining the team..."
                : "Setting up your business..."}
            </p>
          </div>
        ) : (
        <>
        <h1 className="text-xl font-semibold mb-1 text-text-primary">
          {new URLSearchParams(window.location.search).get("invite") === "1"
            ? "Almost there!"
            : "Welcome to Hisaabo"}
        </h1>
        <p className="text-sm mb-6 text-text-tertiary">
          {new URLSearchParams(window.location.search).get("invite") === "1"
            ? "Just tell us your name to join the team."
            : "What should we call you?"}
        </p>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg text-sm bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
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
            disabled={mutation.isPending}
            className="btn-primary w-full py-2.5"
          >
            {mutation.isPending ? "Saving..." : "Continue"}
          </button>
        </form>
        </>
        )}
      </div>
    </div>
  );
}
