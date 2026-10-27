import { api, type Worker } from "../api";
import { usePoll } from "../hooks";
import { Empty, ErrorNote, fmtTime } from "../ui";
import { useUnauthorized } from "./shared";

export function Workers({ onUnauthorized }: { onUnauthorized: () => void }) {
  const { data, error } = usePoll(() => api.get<{ workers: Worker[] }>("workers"));
  useUnauthorized(error, onUnauthorized);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Workers</h1>
      <ErrorNote error={error} />
      <div className="card overflow-x-auto">
        {data && data.workers.length === 0 ? (
          <Empty>No running instances. Start a worker: <code className="font-mono">node packages/api/dist/worker.js</code></Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr><th className="th">Instance</th><th className="th">Host / pid</th><th className="th">Handlers</th><th className="th">Started</th><th className="th">Last heartbeat</th><th className="th">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {data?.workers.map((w) => (
                <tr key={w.id}>
                  <td className="td font-medium">{w.name ?? w.role}<div className="text-xs text-zinc-500">pg-boss {w.version} · node {w.nodeVersion}</div></td>
                  <td className="td font-mono text-xs">{w.host} / {w.pid}</td>
                  <td className="td">{w.workers}</td>
                  <td className="td text-zinc-500">{fmtTime(w.startedOn)}</td>
                  <td className="td text-zinc-500">{fmtTime(w.lastHeartbeat)}</td>
                  <td className="td">
                    <span className={`badge ${w.live ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>{w.live ? "live" : "quiet"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
