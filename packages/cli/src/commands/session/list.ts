import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, EXIT, hasColor } from "../../output.js";
import type { ColumnDef } from "../../output.js";
import chalk from "chalk";

interface ListSessionsOpts {
  expired?: boolean;
  json?: boolean;
}

export async function listSessionsCommand(opts: ListSessionsOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const sessions = await client.auth.listSessions({ expired: opts.expired ?? false });

    if (opts.json) {
      outputJSON(sessions);
      return;
    }

    const items: unknown[] = Array.isArray(sessions) ? sessions : (sessions?.items ?? sessions?.data ?? []);

    if (items.length === 0) {
      console.log(opts.expired ? "No expired sessions." : "No active sessions.");
      return;
    }

    const rows = items.map((item: unknown) => {
      const s = item as Record<string, unknown>;
      return {
        id: String(s["id"] ?? "").slice(0, 12) + "...",
        device: s["userAgent"] ? parseUA(String(s["userAgent"])) : "Unknown",
        ip: String(s["ipAddress"] ?? "\u2014"),
        lastUsed: s["lastUsedAt"] ? timeAgo(String(s["lastUsedAt"])) : "\u2014",
        created: s["createdAt"] ? new Date(String(s["createdAt"])).toLocaleDateString() : "\u2014",
        current: s["isCurrent"] ? "\u2713" : "",
      };
    });

    const columns: ColumnDef<typeof rows[number]>[] = [
      { key: "id", header: "ID", align: "left" },
      { key: "device", header: "Device", align: "left" },
      { key: "ip", header: "IP", align: "left" },
      { key: "lastUsed", header: "Last Used", align: "left" },
      { key: "created", header: "Created", align: "left" },
      { key: "current", header: "Current", align: "left" },
    ];

    if (hasColor()) process.stdout.write("\n" + chalk.bold("  Sessions\n") + "\n");
    else process.stdout.write("\n  Sessions\n\n");
    outputTable(rows, columns);
    process.stdout.write("\n");
  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

function parseUA(ua: string): string {
  let browser = "Unknown";
  if (ua.includes("Edg/")) browser = "Edge";
  else if (ua.includes("Chrome/")) browser = "Chrome";
  else if (ua.includes("Firefox/")) browser = "Firefox";
  else if (ua.includes("Safari/")) browser = "Safari";

  let os = "";
  if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Mac OS")) os = "macOS";
  else if (ua.includes("Linux")) os = "Linux";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";

  return os ? `${browser} / ${os}` : browser;
}

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
