import { useState, type ReactNode } from "react";
import { api, type JobDetail } from "../api";
import { usePoll } from "../hooks";
import { ErrorNote, Link, StateBadge, fmtTime, useStepUp } from "../ui";
import { useUnauthorized } from "./shared";

export function JobDetailPage({ queue, id, isAdmin, onUnauthorized }: { queue: string; id: string; isAdmin: boolean; onUnauthorized: () => void }) {
  const { data, error } = usePoll(() => api.get<{ job: JobDetail }>(`jobs/${encodeURIComponent(queue)}/${encodeURIComponent(id)}`), [queue, id]);
  useUnauthorized(error, onUnauthorized);
  const stepUp = useStepUp();
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const job = data?.job;
  const isFailed = queue.endsWith(".dead");

  const reveal = async () => {
    setActionError(null);
    try {
      const res = await stepUp.run(() => api.post<{ payload: Record<string, unknown> }>(`jobs/${encodeURIComponent(queue)}/${encodeURIComponent(id)}/reveal`));
      setPayload(res.payload);
    } catch (err) {
      setActionError(err as Error);
    }
  };

  const act = async (action: "retry" | "delete") => {
    setActionError(null);
    try {
      await stepUp.run(() => api.post(`jobs/${action}`, { queue, ids: [id] }));
      setDone(action === "retry" ? "Sent back to its queue." : "Deleted.");
    } catch (err) {
      setActionError(err as Error);
    }
  };

  return (
    <div className="max-w-4xl space-y-4">
      <Link to={`jobs?queue=${encodeURIComponent(queue.replace(/\.dead$/, ""))}${isFailed ? "&tab=failed" : ""}`} className="text-sm text-brand-700 hover:underline">← Jobs</Link>
      <ErrorNote error={error ?? actionError} />
      {done && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{done}</div>}
      {job && (
        <>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">{job.queue.replace(/\.dead$/, "")}</h1>
            <StateBadge state={job.state} failedQueue={isFailed} />
            {isAdmin && !done && (
              <div className="ml-auto flex gap-2">
                {isFailed && <button className="btn btn-primary" onClick={() => void act("retry")}>Retry</button>}
                {(isFailed || job.state === "created" || job.state === "retry") && (
                  <button className="btn btn-danger" onClick={() => void act("delete")}>Delete</button>
                )}
              </div>
            )}
          </div>

          <div className="card grid grid-cols-2 gap-x-6 gap-y-3 p-4 text-sm md:grid-cols-3">
            <Field label="Job id" mono>{job.id}</Field>
            <Field label="Attempt">{job.attempt} of {job.retryLimit + 1}</Field>
            <Field label="Scope">{job.scope ?? "—"}</Field>
            <Field label="Tenant" mono>{job.tenant ?? "—"}</Field>
            <Field label="Business" mono>{job.business ?? "—"}</Field>
            <Field label="Request id" mono>{job.requestId ?? "—"}</Field>
            <Field label="Tags">{job.tags.join(", ") || "—"}</Field>
            {job.sourceQueue && <Field label="Failed in">{job.sourceQueue}</Field>}
          </div>

          <section className="card p-4">
            <h2 className="mb-2 text-sm font-semibold text-zinc-700">Timeline</h2>
            <ol className="space-y-1 text-sm">
              {job.timeline.map((t) => (
                <li key={t.event + t.at} className="flex gap-3"><span className="w-24 text-zinc-500">{t.event}</span><span>{fmtTime(t.at)}</span></li>
              ))}
            </ol>
          </section>

          {job.error && (
            <section className="card p-4">
              <h2 className="mb-2 text-sm font-semibold text-zinc-700">Error (masked)</h2>
              <pre className="whitespace-pre-wrap break-words font-mono text-xs text-red-700">{job.error}</pre>
            </section>
          )}

          <section className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-700">Payload</h2>
              {isAdmin && !payload && (
                <button className="btn btn-secondary" onClick={() => void reveal()}>Reveal payload</button>
              )}
            </div>
            {payload ? (
              <pre className="overflow-x-auto rounded-lg bg-zinc-50 p-3 font-mono text-xs">{JSON.stringify(payload, null, 2)}</pre>
            ) : (
              <p className="text-sm text-zinc-600">
                Fields: <span className="font-mono">{job.payloadFields.join(", ") || "none"}</span>. Values are hidden;
                {isAdmin ? " revealing them asks for your code and is recorded in the audit log." : " only admin operators can reveal them."}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Field({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-0.5 break-all ${mono ? "font-mono text-xs" : ""}`}>{children}</div>
    </div>
  );
}
