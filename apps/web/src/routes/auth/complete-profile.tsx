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

  const mutation = trpc.auth.completeProfile.useMutation({
    onSuccess: async () => {
      await utils.auth.me.refetch();
      setSaved(true);
      // Brief pause so user sees confirmation before redirect
      setTimeout(() => navigate({ to: "/settings" }), 800);
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
              Setting up your business...
            </p>
          </div>
        ) : (
        <>
        <h1 className="text-xl font-semibold mb-1 text-text-primary">
          Welcome to Hisaabo
        </h1>
        <p className="text-sm mb-6 text-text-tertiary">
          What should we call you?
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
