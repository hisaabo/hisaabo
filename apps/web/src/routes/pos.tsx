import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { trpc, getBusinessId, setBusinessId } from "@/lib/trpc";
import { POSShell } from "@/features/pos/POSShell";

export const Route = createFileRoute("/pos")({
  component: POSRoute,
});

/**
 * /pos — fullscreen cashier register.
 *
 * Gated behind the per-business `pos_enabled` flag and shown via the
 * chrome-bypass branch in `__root.tsx` (no sidebar, no topbar).
 *
 * Business-selection note: the root layout auto-selects the first business
 * via an effect that fires AFTER children render. On initial mount of this
 * route `getBusinessId()` is null. Rather than race that effect, we resolve
 * the target business directly from the `business.list` result and promote
 * it into the shared getter ourselves. This way POS works:
 *   - On a fresh page load of `/pos` (no sidebar to have clicked yet)
 *   - When opened in a new browser tab used as an independent POS terminal
 *   - After logout + re-login when in-memory state was cleared
 */
function POSRoute() {
  const navigate = useNavigate();
  const { data: bizRows, isPending } = trpc.business.list.useQuery();

  // Prefer an already-selected business; otherwise fall back to the first
  // business in the tenant. This mirrors the root layout's logic but runs
  // synchronously during render so we don't flash "No business selected".
  const preselectedId = getBusinessId();
  const activeBiz =
    (preselectedId ? bizRows?.find((b) => b.id === preselectedId) : null) ??
    bizRows?.[0] ??
    null;

  // Promote the chosen business into the shared header state so any
  // `businessProcedure` calls made from POS components carry the correct
  // `x-business-id`. Safe to call every render — it's a module-level setter.
  useEffect(() => {
    if (activeBiz && activeBiz.id !== preselectedId) {
      setBusinessId(activeBiz.id);
    }
  }, [activeBiz, preselectedId]);

  const ensureWalkIn = trpc.business.ensureWalkInParty.useMutation();
  const [walkInPartyId, setWalkInPartyId] = useState<string | null>(null);

  // Seed the Walk-in Customer party when we have a POS-enabled business.
  // Idempotent on the server: returns existing row if already present.
  useEffect(() => {
    if (!activeBiz || !activeBiz.posEnabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await ensureWalkIn.mutateAsync({ id: activeBiz.id });
        if (!cancelled) setWalkInPartyId(res.id);
      } catch (err) {
        console.error("Walk-in party seed failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBiz?.id, activeBiz?.posEnabled]);

  if (isPending) {
    return <div className="p-10 text-center text-text-secondary">Loading POS…</div>;
  }

  if (!activeBiz) {
    return (
      <div className="p-10 max-w-xl mx-auto text-center space-y-4">
        <h1 className="text-xl font-semibold">No business yet</h1>
        <p className="text-sm text-text-secondary">
          POS needs at least one business. Create one in Settings first.
        </p>
        <button
          className="btn-primary"
          onClick={() => navigate({ to: "/settings" })}
        >
          Go to Settings
        </button>
      </div>
    );
  }

  if (!activeBiz.posEnabled) {
    return (
      <div className="p-10 max-w-xl mx-auto text-center space-y-4">
        <h1 className="text-xl font-semibold">POS mode is off for {activeBiz.name}</h1>
        <p className="text-sm text-text-secondary">
          Enable Point-of-Sale in Settings, then reload.
        </p>
        <button
          className="btn-primary"
          onClick={() => navigate({ to: "/settings", search: { tab: "pos" } as any })}
        >
          Open Settings → POS
        </button>
      </div>
    );
  }

  if (!walkInPartyId) {
    return (
      <div className="p-10 text-center text-text-secondary">
        Preparing register…
      </div>
    );
  }

  return <POSShell businessId={activeBiz.id} walkInPartyId={walkInPartyId} />;
}
