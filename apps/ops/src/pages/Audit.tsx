import { useState } from "react";
import { api, type AuditEntry } from "../api";
import { usePoll } from "../hooks";
import { Empty, ErrorNote, fmtTime } from "../ui";
import { useUnauthorized } from "./shared";

export function Audit({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [action, setAction] = useState("");
  const [older, setOlder] = useState<AuditEntry[]>([]);
  const [before, setBefore] = useState<number | null>(null);
  const qs = action ? `audit?action=${encodeURIComponent(action)}` : "audit";
  const { data, error } = usePoll(async () => {
    const res = await api.get<{ entries: AuditEntry[]; nextBefore: number | null }>(qs);
    if (older.length === 0) setBefore(res.nextBefore);
    return res;
  }, [qs]);
  useUnauthorized(error, onUnauthorized);

  const loadMore = async () => {
    if (!before) return;
    const res = await api.get<{ entries: AuditEntry[]; nextBefore: number | null }>(`${qs}${qs.includes("?") ? "&" : "?"}before=${before}`);
    setOlder((cur) => [...cur, ...res.entries]);
    setBefore(res.nextBefore);
  };

  const entries = [...(data?.entries ?? []), ...older.filter((o) => !data?.entries.some((e) => e.id === o.id))];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Audit log</h1>
        <input className="input ml-auto w-48" placeholder="filter by action" defaultValue={action} aria-label="Action"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setOlder([]);
              setAction(e.currentTarget.value.trim());
            }
          }} />
      </div>
      <ErrorNote error={error} />
      <div className="card overflow-x-auto">
        {entries.length === 0 ? (
          <Empty>No entries.</Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr><th className="th">When</th><th className="th">Actor</th><th className="th">Action</th><th className="th">Queue</th><th className="th">Jobs</th><th className="th">Result</th><th className="th">IP</th><th className="th">Details</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="td whitespace-nowrap text-zinc-500">{fmtTime(e.at)}</td>
                  <td className="td">{e.actor}</td>
                  <td className="td font-mono text-xs">{e.action}</td>
                  <td className="td text-xs">{e.queue ?? "—"}</td>
                  <td className="td text-xs">{e.jobIds?.length ?? 0}</td>
                  <td className="td">
                    <span className={`badge ${e.result === "ok" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>{e.result}</span>
                  </td>
                  <td className="td font-mono text-xs">{e.ip ?? "—"}</td>
                  <td className="td max-w-xs truncate font-mono text-xs text-zinc-500">{e.details ? JSON.stringify(e.details) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {before && <button className="btn btn-secondary" onClick={() => void loadMore()}>Load older</button>}
    </div>
  );
}
