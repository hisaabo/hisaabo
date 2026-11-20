import { useState } from "react";
import { api, type QueueSummary } from "../api";
import { usePoll } from "../hooks";
import { ErrorNote, Link, fmtNum, fmtSeconds, useStepUp } from "../ui";
import { useUnauthorized } from "./shared";

export function Queues({ isAdmin, onUnauthorized }: { isAdmin: boolean; onUnauthorized: () => void }) {
  const { data, error, reload } = usePoll(() => api.get<{ queues: QueueSummary[] }>("queues"));
  useUnauthorized(error, onUnauthorized);
  const stepUp = useStepUp();
  const [actionError, setActionError] = useState<Error | null>(null);

  const toggle = async (q: QueueSummary) => {
    setActionError(null);
    try {
      await stepUp.run(() => api.post(`queues/${encodeURIComponent(q.name)}/${q.paused ? "resume" : "pause"}`));
      await reload();
    } catch (err) {
      setActionError(err as Error);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Queues</h1>
      <ErrorNote error={error ?? actionError} />
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Queue</th><th className="th">Pool</th><th className="th">Queued</th><th className="th">Deferred</th>
              <th className="th">Active</th><th className="th">Failed</th><th className="th">Done/min</th><th className="th">Oldest waiting</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {data?.queues.map((q) => (
              <tr key={q.name}>
                <td className="td">
                  <Link to={`jobs?queue=${encodeURIComponent(q.name)}`} className="font-medium text-brand-700 hover:underline">{q.name}</Link>
                  {q.paused && <span className="badge ml-2 bg-amber-100 text-amber-800">paused</span>}
                  <div className="text-xs text-zinc-500">{q.scope} · {q.policy}</div>
                </td>
                <td className="td">{q.pool}</td>
                <td className="td">{fmtNum(q.queued)}</td>
                <td className="td">{fmtNum(q.deferred)}</td>
                <td className="td">{fmtNum(q.active)}</td>
                <td className="td">
                  {q.failed > 0 ? <Link to={`jobs?tab=failed&queue=${encodeURIComponent(q.name)}`} className="text-red-700 hover:underline">{fmtNum(q.failed)}</Link> : "0"}
                </td>
                <td className="td">{fmtNum(q.completedPerMin)}</td>
                <td className="td">{fmtSeconds(q.oldestReadySeconds)}</td>
                <td className="td text-right">
                  {isAdmin && (
                    <button className="btn btn-secondary" onClick={() => void toggle(q)}>
                      {q.paused ? "Resume" : "Pause"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
