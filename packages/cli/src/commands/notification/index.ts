import {
  HisaaboClient,
  HisaaboApiError,
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
  type NotificationChannelPreference,
  type NotificationRow,
} from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, EXIT, success, type ColumnDef } from "../../output.js";
import { formatDate } from "../../format.js";

const DELIVERIES = ["push", "inbox", "digest", "off"] as const;
const SCOPES = ["mine", "everyone"] as const;

function isChannel(v: string | undefined): v is NotificationChannel {
  return v !== undefined && (NOTIFICATION_CHANNELS as readonly string[]).includes(v);
}

function handleApiError(e: unknown): never {
  if (e instanceof HisaaboApiError) {
    const err = e.hisaaboError;
    if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
    if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
  }
  fatalError(String(e instanceof Error ? e.message : e));
}

export async function notificationListCommand(opts: { json?: boolean; unread?: boolean; channel?: string; limit?: string }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  if (opts.channel && !isChannel(opts.channel)) {
    fatalError(`--channel must be one of: ${NOTIFICATION_CHANNELS.join(", ")}`, EXIT.USAGE);
  }
  const limit = opts.limit ? Number(opts.limit) : 30;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fatalError("--limit must be 1–100", EXIT.USAGE);

  try {
    const page = await client.notification.list({
      limit,
      unreadOnly: !!opts.unread,
      channel: opts.channel as NotificationChannel | undefined,
    });
    if (opts.json) {
      outputJSON(page);
      return;
    }
    console.log("\n Notifications\n");
    const cols: ColumnDef<NotificationRow>[] = [
      { key: "readAt", header: "", width: 2, format: (v) => (v ? " " : "●") },
      { key: "createdAt", header: "Date", width: 12, format: (v) => formatDate(v as Date) },
      { key: "channel", header: "Channel", width: 12 },
      { key: "title", header: "Title", width: 48 },
      { key: "id", header: "ID", width: 10, format: (v) => String(v ?? "").slice(0, 8) + "..." },
    ];
    outputTable(page.items, cols);
  } catch (e) {
    handleApiError(e);
  }
}

export async function notificationReadCommand(ids: string[], opts: { all?: boolean; json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  if (!opts.all && ids.length === 0) fatalError("Pass notification ids, or --all", EXIT.USAGE);
  try {
    let updated: number;
    if (opts.all) {
      updated = (await client.notification.markAllRead()).updated;
    } else {
      // Short ids from the table are prefixes; resolve them against the inbox.
      const full = ids.some((id) => id.length < 36)
        ? await resolveIds(client, ids)
        : ids;
      updated = (await client.notification.markRead(full)).updated;
    }
    if (opts.json) outputJSON({ updated });
    else success(`Marked ${updated} notification${updated === 1 ? "" : "s"} as read`);
  } catch (e) {
    handleApiError(e);
  }
}

async function resolveIds(client: HisaaboClient, ids: string[]): Promise<string[]> {
  const page = await client.notification.list({ limit: 100 });
  return ids.map((id) => {
    const matches = page.items.filter((n) => n.id.startsWith(id.replace(/\.+$/, "")));
    if (matches.length !== 1) fatalError(`Could not resolve notification id "${id}"`, EXIT.USAGE);
    return matches[0].id;
  });
}

export async function notificationPrefsCommand(opts: { json?: boolean; business?: string }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  try {
    const prefs = await client.notification.getPreferences(opts.business ?? null);
    if (opts.json) {
      outputJSON(prefs);
      return;
    }
    console.log(`\n Notification preferences (${opts.business ? "this business" : "organization default"}, role: ${prefs.role})\n`);
    const cols: ColumnDef<NotificationChannelPreference>[] = [
      { key: "channel", header: "Channel", width: 12 },
      { key: "name", header: "Name", width: 26 },
      { key: "preference", header: "Delivery", width: 9, format: (_v, row) => (row.available ? row.preference.delivery : "—") },
      { key: "preference", header: "Scope", width: 9, format: (_v, row) => (row.scopeable ? row.preference.scope : "") },
      { key: "locked", header: "Locked", width: 7, format: (v) => (v ? "yes" : "") },
      { key: "source", header: "From", width: 13 },
    ];
    outputTable(prefs.channels, cols);
  } catch (e) {
    handleApiError(e);
  }
}

export async function notificationSetCommand(channel: string, opts: {
  json?: boolean;
  business?: string;
  delivery?: string;
  scope?: string;
  threshold?: string;
  email?: boolean;
  reset?: boolean;
}): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  if (!isChannel(channel)) fatalError(`Channel must be one of: ${NOTIFICATION_CHANNELS.join(", ")}`, EXIT.USAGE);
  if (opts.delivery && !(DELIVERIES as readonly string[]).includes(opts.delivery)) {
    fatalError(`--delivery must be one of: ${DELIVERIES.join(", ")}`, EXIT.USAGE);
  }
  if (opts.scope && !(SCOPES as readonly string[]).includes(opts.scope)) {
    fatalError(`--scope must be one of: ${SCOPES.join(", ")}`, EXIT.USAGE);
  }
  let thresholdPaise: number | null | undefined;
  if (opts.threshold !== undefined) {
    if (opts.threshold === "none") thresholdPaise = null;
    else {
      const rupees = Number(opts.threshold);
      if (!Number.isFinite(rupees) || rupees < 0) fatalError("--threshold must be an amount in rupees, or 'none'", EXIT.USAGE);
      thresholdPaise = Math.round(rupees * 100);
    }
  }
  if (!opts.reset && !opts.delivery && !opts.scope && thresholdPaise === undefined && opts.email === undefined) {
    fatalError("Nothing to change: pass --delivery, --scope, --threshold, --email/--no-email or --reset", EXIT.USAGE);
  }

  try {
    await client.notification.updatePreference({
      businessId: opts.business ?? null,
      channel,
      delivery: opts.delivery as (typeof DELIVERIES)[number] | undefined,
      scope: opts.scope as (typeof SCOPES)[number] | undefined,
      thresholdPaise,
      email: opts.email,
      reset: opts.reset,
    });
    if (opts.json) outputJSON({ ok: true });
    else success(opts.reset ? `Reset ${channel} preference` : `Updated ${channel} preference`);
  } catch (e) {
    handleApiError(e);
  }
}
