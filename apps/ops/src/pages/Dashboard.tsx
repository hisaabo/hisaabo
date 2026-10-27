import { api, type Overview } from "../api";
import { usePoll } from "../hooks";
import { Empty, ErrorNote, Link, Stat, ThroughputChart, fmtNum, fmtSeconds, fmtTime } from "../ui";
import { useUnauthorized } from "./shared";

export function Dashboard({ onUnauthorized }: { onUnauthorized: () => void }) {
  const { data, error } = usePoll(() => api.get<Overview>("overview"));
  useUnauthorized(error, onUnauthorized);
  const t = data?.totals;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <ErrorNote error={error} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Jobs / min" value={fmtNum(t?.completedPerMin)} />
        <Stat label="Failed / min" value={fmtNum(t?.failedPerMin)} tone={t && t.failedPerMin > 0 ? "danger" : undefined} />
        <Stat label="Queued" value={fmtNum(t?.queued)} />
        <Stat label="Active" value={fmtNum(t?.active)} />
        <Stat label="Failed (kept)" value={fmtNum(t?.failed)} tone={t && t.failed > 0 ? "warn" : undefined} />
        <Stat label="Live workers" value={fmtNum(t?.liveWorkers)} tone={t ? (t.liveWorkers > 0 ? "ok" : "danger") : undefined} />
        <Stat label="Oldest waiting" value={fmtSeconds(t?.oldestReadySeconds)} />
        <Stat label="Wait p95" value={fmtSeconds(t?.waitP95Seconds)} />
        <Stat label="Runtime p95" value={fmtSeconds(t?.runP95Seconds)} />
        <Stat label="Paused queues" value={fmtNum(t?.pausedQueues)} tone={t && t.pausedQueues > 0 ? "warn" : undefined} />
      </div>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-700">Throughput, last hour</h2>
        <ThroughputChart points={data?.throughput ?? []} />
      </section>

      <section className="card">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-700">Recent failures</h2>
          <Link to="jobs?tab=failed" className="text-sm text-brand-700 hover:underline">All failed jobs</Link>
        </div>
        {data && data.recentFailures.length === 0 ? (
          <Empty>No failed jobs.</Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr><th className="th">Queue</th><th className="th">Tenant</th><th className="th">Error</th><th className="th">When</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {data?.recentFailures.map((j) => (
                <tr key={j.id}>
                  <td className="td"><Link to={`jobs/${encodeURIComponent(j.queue)}/${j.id}`} className="text-brand-700 hover:underline">{j.queue.replace(/\.dead$/, "")}</Link></td>
                  <td className="td font-mono text-xs">{j.tenant ?? "—"}</td>
                  <td className="td max-w-md truncate text-red-700">{j.error ?? "—"}</td>
                  <td className="td text-zinc-500">{fmtTime(j.createdOn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
