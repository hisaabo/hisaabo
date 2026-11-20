import { createContext, useContext, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import { navigate } from "./hooks";

// ── Formatting ──────────────────────────────────────────────

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtSeconds(s: number | null | undefined): string {
  if (s == null) return "—";
  if (s < 1) return `${Math.round(s * 1000)} ms`;
  if (s < 60) return `${s.toFixed(1)} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

export function fmtNum(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString();
}

// ── Small components ────────────────────────────────────────

export function Link({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={`/ops/${to}`}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: "danger" | "warn" | "ok" }) {
  const color = tone === "danger" ? "text-red-600" : tone === "warn" ? "text-amber-600" : tone === "ok" ? "text-emerald-600" : "text-zinc-900";
  return (
    <div className="card px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

const STATE_STYLE: Record<string, string> = {
  created: "bg-zinc-100 text-zinc-700",
  retry: "bg-amber-100 text-amber-800",
  active: "bg-blue-100 text-blue-800",
  completed: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-zinc-200 text-zinc-700",
  failed: "bg-red-100 text-red-800",
};

export function StateBadge({ state, failedQueue }: { state: string; failedQueue?: boolean }) {
  const s = failedQueue ? "failed" : state;
  return <span className={`badge ${STATE_STYLE[s] ?? "bg-zinc-100 text-zinc-700"}`}>{s}</span>;
}

export function ErrorNote({ error }: { error: Error | null }) {
  if (!error) return null;
  return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-3 py-8 text-center text-sm text-zinc-500">{children}</div>;
}

/** Bars of completed (and failed, stacked) jobs per point. Pure SVG attributes, no inline style. */
export function ThroughputChart({ points }: { points: { at: string; completed: number; failed: number }[] }) {
  if (points.length === 0) return <Empty>No throughput recorded yet (a worker records stats every monitor pass).</Empty>;
  const max = Math.max(1, ...points.map((p) => p.completed + p.failed));
  const w = 600;
  const h = 120;
  const bw = w / points.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-32 w-full" role="img" aria-label="Jobs per interval">
      {points.map((p, i) => {
        const ch = (p.completed / max) * (h - 4);
        const fh = (p.failed / max) * (h - 4);
        return (
          <g key={p.at}>
            <title>{`${fmtTime(p.at)}: ${p.completed} completed, ${p.failed} failed`}</title>
            <rect x={i * bw + 1} y={h - ch} width={Math.max(bw - 2, 1)} height={ch} className="fill-brand-500" />
            <rect x={i * bw + 1} y={h - ch - fh} width={Math.max(bw - 2, 1)} height={fh} className="fill-red-500" />
          </g>
        );
      })}
    </svg>
  );
}

// ── Step-up ─────────────────────────────────────────────────

interface StepUpCtx {
  /** Run an action; on step_up_required ask for a code, step up, and retry once. */
  run<T>(fn: () => Promise<T>): Promise<T>;
}

const StepUpContext = createContext<StepUpCtx | null>(null);

export function useStepUp(): StepUpCtx {
  const ctx = useContext(StepUpContext);
  if (!ctx) throw new Error("StepUpProvider missing");
  return ctx;
}

export function StepUpProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{ resolve: (ok: boolean) => void } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = () => new Promise<boolean>((resolve) => {
    setCode("");
    setError(null);
    setPending({ resolve });
  });

  const run = async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ApiError && err.code === "step_up_required") {
        if (await ask()) return fn();
      }
      throw err;
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("step-up", { code });
      pending?.resolve(true);
      setPending(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepUpContext.Provider value={{ run }}>
      {children}
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4">
          <form
            className="card w-full max-w-sm space-y-3 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <h2 className="text-base font-semibold">Confirm it's you</h2>
            <p className="text-sm text-zinc-600">This action needs a fresh code from your authenticator app (or a recovery code).</p>
            <input
              className="input w-full font-mono tracking-widest"
              autoFocus
              autoComplete="one-time-code"
              inputMode="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  pending.resolve(false);
                  setPending(null);
                }}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || code.trim().length < 6}>
                Confirm
              </button>
            </div>
          </form>
        </div>
      )}
    </StepUpContext.Provider>
  );
}
