import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";

export const Route = createFileRoute("/invite/$token")({
  component: InviteAcceptPage,
});

function InviteAcceptPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { data: session, isLoading: sessionLoading } = trpc.auth.me.useQuery();
  const calledRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const acceptMutation = trpc.tenant.acceptInvitation.useMutation();
  const selectTenantMutation = trpc.tenant.select.useMutation();

  useEffect(() => {
    if (sessionLoading) return;

    if (!session?.user) {
      localStorage.setItem("pendingInviteToken", token);
      navigate({ to: "/login", search: { invite: "1" } });
      return;
    }

    if (calledRef.current) return;
    calledRef.current = true;

    acceptMutation.mutate(
      { token },
      {
        onSuccess: (data) => {
          localStorage.removeItem("pendingInviteToken");
          selectTenantMutation.mutate(
            { tenantId: data.tenantId },
            {
              onSuccess: async () => {
                // Await refetch so root layout sees the correct tenant + businesses
                await utils.auth.me.refetch();
                utils.tenant.list.invalidate();
                utils.business.list.invalidate();
                navigate({ to: "/", search: { joined: data.tenantName } });
              },
            },
          );
        },
        onError: (err) => {
          if (err.message.includes("different email")) {
            localStorage.setItem("pendingInviteToken", token);
            navigate({ to: "/login", search: { invite: "1", error: "email_mismatch" } });
          } else if (err.message.includes("already accepted")) {
            localStorage.removeItem("pendingInviteToken");
            navigate({ to: "/" });
          } else {
            setError(err.message);
          }
        },
      },
    );
  }, [sessionLoading, session]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-surface-1">
      <div className="w-full max-w-[380px] rounded-2xl p-8 shadow-elevated bg-surface-0 border border-border-light text-center">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-9 h-9 rounded-xl bg-brand-600 flex items-center justify-center">
            <span className="text-white font-bold text-base">H</span>
          </div>
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
              Could not accept invitation
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
              Accepting your invitation...
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
