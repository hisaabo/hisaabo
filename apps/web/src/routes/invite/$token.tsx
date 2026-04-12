import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatRole } from "@/lib/roles";
import { Logo } from "@/components/ui/Logo";

export const Route = createFileRoute("/invite/$token")({
  component: InviteAcceptPage,
});

type AcceptedInfo = { tenantId: string; tenantName: string };

function InviteAcceptPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { data: session, isLoading: sessionLoading } = trpc.auth.me.useQuery();
  const { data: canCreateOrg } = trpc.tenant.canCreateOrg.useQuery(undefined, { enabled: !!session?.user });
  const calledRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<AcceptedInfo | null>(null);

  const acceptMutation = trpc.tenant.acceptInvitation.useMutation();
  const createOrgMutation = trpc.tenant.create.useMutation();

  // Peek at invite to show org name in the choice screen
  const { data: inviteInfo } = trpc.tenant.peekInvitation.useQuery(
    { token },
    { enabled: !accepted && !error },
  );

  useEffect(() => {
    if (sessionLoading) return;

    if (!session?.user) {
      sessionStorage.setItem("pendingInviteToken", token);
      navigate({ to: "/login", search: { invite: "1" } });
      return;
    }

    if (calledRef.current) return;
    calledRef.current = true;

    (async () => {
      try {
        const data = await acceptMutation.mutateAsync({ token });
        sessionStorage.removeItem("pendingInviteToken");
        await utils.auth.me.refetch();
        await utils.tenant.list.refetch();
        // Show org choice instead of navigating directly
        setAccepted(data);
      } catch (err: any) {
        const message = err?.message ?? String(err);
        if (message.includes("different email")) {
          sessionStorage.setItem("pendingInviteToken", token);
          navigate({ to: "/login", search: { invite: "1", error: "email_mismatch" } });
        } else if (message.includes("already accepted")) {
          sessionStorage.removeItem("pendingInviteToken");
          await utils.auth.me.refetch();
          navigate({ to: "/" });
        } else {
          setError(message);
        }
      }
    })();
  }, [sessionLoading, session]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleContinueWithInvited() {
    if (!accepted) return;
    // Tenant already selected by autoSelectTenantInSession — just refetch businesses and go
    await utils.business.list.refetch();
    navigate({ to: "/", search: { joined: accepted.tenantName } });
  }

  async function handleCreateOwn() {
    try {
      await createOrgMutation.mutateAsync();
      await utils.auth.me.refetch();
      await utils.tenant.list.refetch();
      await utils.business.list.refetch();
      navigate({ to: "/settings" });
    } catch {
      // If org creation fails, just go to the invited org
      await utils.business.list.refetch();
      navigate({ to: "/" });
    }
  }

  const isActing = createOrgMutation.isPending;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-surface-1">
      <div className="w-full max-w-[400px] rounded-2xl p-8 shadow-elevated bg-surface-0 border border-border-light">
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
            <h1 className="text-lg font-semibold text-text-primary mb-2 text-center">
              Could not accept invitation
            </h1>
            <p className="text-sm text-text-tertiary mb-6 text-center">{error}</p>
            <button
              onClick={() => navigate({ to: "/login" })}
              className="btn-primary w-full py-2.5"
            >
              Back to sign in
            </button>
          </>
        ) : accepted ? (
          /* ���─ Org choice: continue with invited org or create own ── */
          <>
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <svg className="w-6 h-6 text-emerald-600" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-text-primary mb-1 text-center">
              You've joined {accepted.tenantName}!
            </h1>
            <p className="text-sm text-text-tertiary mb-6 text-center">
              You're all set. Jump right in.
            </p>

            <div className="space-y-3">
              <button
                onClick={handleContinueWithInvited}
                disabled={isActing}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border-2 border-brand-200 bg-brand-50/50 hover:border-brand-400 hover:bg-brand-50 transition-colors text-left group dark:border-brand-600/30 dark:bg-brand-600/10 dark:hover:border-brand-500"
              >
                <div className="w-10 h-10 rounded-lg bg-brand-600 flex items-center justify-center text-white font-semibold text-lg shrink-0">
                  {accepted.tenantName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary group-hover:text-brand-700 dark:group-hover:text-brand-400">
                    Continue with {accepted.tenantName}
                  </p>
                  {inviteInfo && (
                    <p className="text-xs text-text-tertiary">as {formatRole(inviteInfo.role)}</p>
                  )}
                </div>
              </button>

              {canCreateOrg && (
                <>
                  <div className="relative my-1">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border-light" /></div>
                    <div className="relative flex justify-center"><span className="bg-surface-0 px-3 text-xs text-text-tertiary">or</span></div>
                  </div>

                  <button
                    onClick={handleCreateOwn}
                    disabled={isActing}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-border-light hover:border-border-medium hover:bg-surface-1 transition-colors text-sm font-medium text-text-secondary"
                  >
                    {createOrgMutation.isPending ? "Creating..." : "I also want my own organization"}
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          /* ── Loading/accepting ── */
          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-brand-100 dark:bg-brand-600/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-brand-600 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-text-primary mb-1">
              Accepting your invitation...
            </h1>
            <p className="text-sm text-text-tertiary">
              Just a moment
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
