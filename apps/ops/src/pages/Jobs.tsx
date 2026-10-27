import { useEffect, useState } from "react";
import { api, type JobSummary, type QueueSummary } from "../api";
import { navigate, usePoll, useRoute } from "../hooks";
import { Empty, ErrorNote, Link, StateBadge, fmtTime, useStepUp } from "../ui";
import { useUnauthorized } from "./shared";

const TABS = [
  ["pending", "Pending"],
  ["active", "Active"],
  ["completed", "Completed"],
  ["failed", "Failed"],
] as const;

export function Jobs({ isAdmin, onUnauthorized }: { isAdmin: boolean; onUnauthorized: () => void }) {
  const { query } = useRoute();
  const tab = query.get("tab") ?? "pending";
  const queue = query.get("queue") ?? "";
  const tenant = query.get("tenant") ?? "";
  const tag = query.get("tag") ?? "";
  const [extra, setExtra] = useState<JobSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<Error | null>(null);
  const stepUp = useStepUp();

  const params = new URLSearchParams({ tab, limit: "50" });
  if (queue) params.set("queue", queue);
  if (tenant) params.set("tenant", tenant);
  if (tag) params.set("tag", tag);
  const qs = params.toString();

  const { data, error, reload } = usePoll(() => api.get<{ jobs: JobSummary[]; nextCursor: string | null }>(`jobs?${qs}`), [qs]);
  const queues = usePoll(() => api.get<{ queues: QueueSummary[] }>("queues"));
  useUnauthorized(error, onUnauthorized);

  useEffect(() => {
    setExtra([]);
    setSelected(new Set());
    setCursor(null);
  }, [qs]);
  useEffect(() => {
    if (extra.length === 0) setCursor(data?.nextCursor ?? null);
  }, [data, extra.length]);

  const jobs = [...(data?.jobs ?? []), ...extra.filter((e) => !data?.jobs.some((j) => j.id === e.id))];

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(query);
    if (value) next.set(key, value);
    else next.delete(key);
    navigate(`jobs?${next.toString()}`);
  };

  const loadMore = async () => {
    if (!cursor) return;
    const page = await api.get<{ jobs: JobSummary[]; nextCursor: string | null }>(`jobs?${qs}&cursor=${encodeURIComponent(cursor)}`);
    setExtra((cur) => [...cur, ...page.jobs]);
    setCursor(page.nextCursor);
  };

  /** Bulk actions are per queue: group the selection by the job's queue. */
  const bulk = async (action: "retry" | "delete") => {
    setActionError(null);
    const byQueue = new Map<string, string[]>();
    for (const j of jobs) if (selected.has(j.id)) byQueue.set(j.queue, [...(byQueue.get(j.queue) ?? []), j.id]);
    try {
      for (const [q, ids] of byQueue) {
        await stepUp.run(() => api.post(`jobs/${action}`, { queue: q, ids }));
      }
      setSelected(new Set());
      setExtra([]);
      await reload();
    } catch (err) {
      setActionError(err as Error);
    }
  };

  const toggle = (id: string) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const canSelect = isAdmin && (tab === "failed" || tab === "pending");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Jobs</h1>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-zinc-300 bg-white p-0.5">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              className={`rounded-md px-3 py-1 text-sm ${tab === key ? "bg-brand-600 text-white" : "text-zinc-700 hover:bg-zinc-100"}`}
              onClick={() => setFilter("tab", key)}
            >
              {label}
            </button>
          ))}
        </div>
        <select className="input" value={queue} onChange={(e) => setFilter("queue", e.target.value)} aria-label="Queue">
          <option value="">All queues</option>
          {queues.data?.queues.map((q) => <option key={q.name} value={q.name}>{q.name}</option>)}
        </select>
        <input className="input w-32 font-mono" placeholder="tenant" defaultValue={tenant} aria-label="Tenant handle"
          onKeyDown={(e) => { if (e.key === "Enter") setFilter("tenant", e.currentTarget.value.trim()); }} />
        <input className="input w-32" placeholder="tag" defaultValue={tag} aria-label="Tag"
          onKeyDown={(e) => { if (e.key === "Enter") setFilter("tag", e.currentTarget.value.trim()); }} />
        {canSelect && selected.size > 0 && (
          <div className="ml-auto flex gap-2">
            {tab === "failed" && <button className="btn btn-primary" onClick={() => void bulk("retry")}>Retry {selected.size}</button>}
            <button className="btn btn-danger" onClick={() => void bulk("delete")}>Delete {selected.size}</button>
          </div>
        )}
      </div>
      <ErrorNote error={error ?? actionError} />
      <div className="card overflow-x-auto">
        {jobs.length === 0 ? (
          <Empty>No jobs here.</Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                {canSelect && (
                  <th className="th w-8">
                    <input type="checkbox" aria-label="Select all"
                      checked={selected.size > 0 && selected.size === jobs.length}
                      onChange={(e) => setSelected(e.target.checked ? new Set(jobs.map((j) => j.id)) : new Set())} />
                  </th>
                )}
                <th className="th">Job</th><th className="th">State</th><th className="th">Attempt</th>
                <th className="th">Tenant</th><th className="th">Tags</th><th className="th">Created</th><th className="th">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {jobs.map((j) => (
                <tr key={j.id}>
                  {canSelect && (
                    <td className="td"><input type="checkbox" aria-label={`Select ${j.id}`} checked={selected.has(j.id)} onChange={() => toggle(j.id)} /></td>
                  )}
                  <td className="td">
                    <Link to={`jobs/${encodeURIComponent(j.queue)}/${j.id}`} className="text-brand-700 hover:underline">{j.queue.replace(/\.dead$/, "")}</Link>
                    <div className="font-mono text-xs text-zinc-500">{j.id.slice(0, 8)}</div>
                  </td>
                  <td className="td"><StateBadge state={j.state} failedQueue={j.queue.endsWith(".dead")} /></td>
                  <td className="td">{j.attempt} / {j.retryLimit + 1}</td>
                  <td className="td font-mono text-xs">{j.tenant ?? "—"}</td>
                  <td className="td text-xs">{j.tags.join(", ") || "—"}</td>
                  <td className="td text-zinc-500">{fmtTime(j.createdOn)}</td>
                  <td className="td max-w-xs truncate text-red-700">{j.error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {cursor && (
        <button className="btn btn-secondary" onClick={() => void loadMore()}>Load more</button>
      )}
    </div>
  );
}
