import { api, type Schedule } from "../api";
import { usePoll } from "../hooks";
import { Empty, ErrorNote, fmtTime } from "../ui";
import { useUnauthorized } from "./shared";

export function Schedules({ onUnauthorized }: { onUnauthorized: () => void }) {
  const { data, error } = usePoll(() => api.get<{ schedules: Schedule[] }>("schedules"));
  useUnauthorized(error, onUnauthorized);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Schedules</h1>
      <ErrorNote error={error} />
      <div className="card overflow-x-auto">
        {data && data.schedules.length === 0 ? (
          <Empty>No schedules registered.</Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr><th className="th">Queue</th><th className="th">Cron</th><th className="th">Time zone</th><th className="th">Next run</th><th className="th">Updated</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {data?.schedules.map((s) => (
                <tr key={`${s.name}:${s.key}`}>
                  <td className="td font-medium">{s.name}{s.key ? <span className="text-xs text-zinc-500"> ({s.key})</span> : null}</td>
                  <td className="td font-mono text-xs">{s.cron}</td>
                  <td className="td">{s.timezone}</td>
                  <td className="td">{fmtTime(s.nextRun)}</td>
                  <td className="td text-zinc-500">{fmtTime(s.updatedOn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
