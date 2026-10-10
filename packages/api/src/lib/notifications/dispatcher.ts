/**
 * Notification dispatcher (docs/architecture/notifications.md §6).
 *
 * Claims pending outbox rows, decides per recipient (eligibility → preferences
 * → locks → quiet hours) using the pure `decideDelivery` from @hisaabo/shared,
 * writes inbox rows (the system of record), then fans out to push and email.
 *
 * Concurrency: rows are claimed with UPDATE … WHERE id IN (SELECT … FOR UPDATE
 * SKIP LOCKED), so several API replicas can run the dispatcher safely. Inbox
 * rows are unique per (outbox_id, recipient), so a retried row never
 * duplicates an inbox entry, push or email — side effects only follow rows
 * that were newly inserted.
 */

import {
  controlDb,
  getTenantDb,
  tenants,
  tenantMembers,
  users,
  pushDevices,
  userNotificationSettings,
  notificationPreferences,
  notificationOutbox,
  notificationInbox,
  decryptField,
  type TenantDatabase,
} from "@hisaabo/db";
import { and, eq, inArray, lt, or, sql, isNull } from "drizzle-orm";
import {
  CHANNELS,
  EVENTS,
  DEFAULT_LOCALE,
  amountToPaise,
  decideDelivery,
  isEventType,
  isLocale,
  renderNotification,
  renderPrivate,
  targetFor,
  type ChannelId,
  type Delivery,
  type EventPayloads,
  type EventType,
  type Locale,
  type NotificationTarget,
  type PreferenceOverride,
  type Scope,
} from "@hisaabo/shared";
import { logger } from "../logger.js";
import { emailService } from "../email.js";
import { encryptForDevice } from "./push-crypto.js";
import { getPushProvider, type DevicePlatform, type PushProvider } from "./push-provider.js";
import { consumePushQuota, pruneQuotaWindows } from "./quota.js";
import { drainKickedTenants } from "./kick.js";

const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 5;
const STALE_PROCESSING_MS = 5 * 60 * 1000;
const OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const INBOX_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

type OutboxRow = typeof notificationOutbox.$inferSelect;

export interface DispatchStats {
  processed: number;
  inboxRows: number;
  pushes: number;
  pushFailures: number;
  emails: number;
  failed: number;
}

const emptyStats = (): DispatchStats => ({ processed: 0, inboxRows: 0, pushes: 0, pushFailures: 0, emails: 0, failed: 0 });

// ── Claiming ────────────────────────────────────────────────────────────────

async function claimBatch(db: TenantDatabase, now: Date): Promise<OutboxRow[]> {
  // Recover rows whose dispatcher died mid-flight.
  await db
    .update(notificationOutbox)
    .set({ status: "pending" })
    .where(and(
      eq(notificationOutbox.status, "processing"),
      lt(notificationOutbox.availableAt, new Date(now.getTime() - STALE_PROCESSING_MS)),
    ));

  const at = now.toISOString();
  const rows = await db.execute(sql`
    UPDATE notification_outbox
    SET status = 'processing', attempts = attempts + 1, available_at = ${at}::timestamptz
    WHERE id IN (
      SELECT id FROM notification_outbox
      WHERE status = 'pending' AND available_at <= ${at}::timestamptz
      ORDER BY created_at
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);
  const ids = (rows as unknown as Array<{ id: string }>).map((r) => r.id);
  if (ids.length === 0) return [];
  return db.select().from(notificationOutbox).where(inArray(notificationOutbox.id, ids));
}

// ── Recipient data ──────────────────────────────────────────────────────────

interface Member {
  userId: string;
  role: string;
  email: string;
}

interface Settings {
  locale: Locale;
  quietStart: string | null;
  quietEnd: string | null;
  pausedUntil: Date | null;
  lockScreenPrivacy: boolean;
  promotionsOptIn: boolean;
}

function toOverride(row: {
  delivery: string | null;
  scope: string | null;
  thresholdPaise: number | null;
  email: boolean | null;
}): PreferenceOverride {
  return {
    delivery: row.delivery as Delivery | null,
    scope: row.scope as Scope | null,
    thresholdPaise: row.thresholdPaise,
    email: row.email,
  };
}

async function loadRecipients(tenantId: string, channel: ChannelId, businessId: string | null) {
  const members: Member[] = await controlDb
    .select({ userId: tenantMembers.userId, role: tenantMembers.role, email: users.email })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(eq(tenantMembers.tenantId, tenantId));
  if (members.length === 0) return { members, prefs: new Map(), settings: new Map() };

  const userIds = members.map((m) => m.userId);
  const prefRows = await controlDb
    .select()
    .from(notificationPreferences)
    .where(and(
      eq(notificationPreferences.tenantId, tenantId),
      eq(notificationPreferences.channel, channel),
      inArray(notificationPreferences.userId, userIds),
      businessId
        ? or(isNull(notificationPreferences.businessId), eq(notificationPreferences.businessId, businessId))
        : isNull(notificationPreferences.businessId),
    ));
  const prefs = new Map<string, { tenant?: PreferenceOverride; business?: PreferenceOverride }>();
  for (const row of prefRows) {
    const entry = prefs.get(row.userId) ?? {};
    if (row.businessId) entry.business = toOverride(row);
    else entry.tenant = toOverride(row);
    prefs.set(row.userId, entry);
  }

  const settingRows = await controlDb
    .select()
    .from(userNotificationSettings)
    .where(inArray(userNotificationSettings.userId, userIds));
  const settings = new Map<string, Settings>();
  for (const s of settingRows) {
    settings.set(s.userId, {
      locale: isLocale(s.locale) ? s.locale : DEFAULT_LOCALE,
      quietStart: s.quietStart,
      quietEnd: s.quietEnd,
      pausedUntil: s.pausedUntil,
      lockScreenPrivacy: s.lockScreenPrivacy,
      promotionsOptIn: !!s.promotionsOptInAt,
    });
  }
  return { members, prefs, settings };
}

// ── Links ───────────────────────────────────────────────────────────────────

/** Web path for a notification target (email CTA; clients map targets themselves). */
export function targetPath(target: NotificationTarget): string {
  switch (target.kind) {
    case "invoice": return `/invoices?id=${encodeURIComponent(target.id)}`;
    case "payment": return `/payments?id=${encodeURIComponent(target.id)}`;
    case "store_order": return `/store-orders?id=${encodeURIComponent(target.id)}`;
    case "team": return "/settings?tab=team";
    case "api_keys": return "/settings?tab=api-keys";
    case "inbox": return "/?notifications=open";
  }
}

function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
}

// ── Push ────────────────────────────────────────────────────────────────────

interface PushJob {
  inboxId: string;
  userId: string;
  title: string;
  body: string;
  target: NotificationTarget;
}

async function deliverPush(
  provider: PushProvider,
  row: OutboxRow,
  tenantPlan: string,
  jobs: PushJob[],
  settings: Map<string, Settings>,
  stats: DispatchStats,
): Promise<void> {
  if (jobs.length === 0 || provider.name === "none") return;
  const def = EVENTS[row.eventType as EventType];
  const channel = CHANNELS[def.channel];

  const devices = await controlDb
    .select()
    .from(pushDevices)
    .where(inArray(pushDevices.userId, jobs.map((j) => j.userId)));

  for (const job of jobs) {
    const userDevices = devices.filter((d) => d.userId === job.userId && provider.supports(d.platform as DevicePlatform));
    if (userDevices.length === 0) continue;

    const denied = await consumePushQuota({
      tenantId: row.tenantId,
      tenantPlan,
      userId: job.userId,
      urgent: def.urgent,
    });
    if (denied) {
      logger.info({ scope: denied, tenantId: row.tenantId }, "[notifications] push quota reached — inbox only");
      continue;
    }

    const s = settings.get(job.userId);
    const locale = s?.locale ?? DEFAULT_LOCALE;
    const privateText = renderPrivate(def.type, locale);
    const display = s?.lockScreenPrivacy ? privateText : { title: job.title, body: job.body };
    const plaintext = JSON.stringify({
      id: job.inboxId,
      t: display.title,
      b: display.body,
      ch: def.channel,
      tenantId: row.tenantId,
      businessId: row.businessId,
      target: job.target,
    });

    for (const device of userDevices) {
      let encrypted: string | null = null;
      if (device.publicKey && device.authSecret) {
        try {
          encrypted = encryptForDevice(plaintext, device.publicKey, decryptField(device.authSecret)).toString("base64url");
        } catch (err) {
          logger.warn({ err, deviceId: device.id }, "[notifications] payload encryption failed — sending placeholder");
        }
      }
      const result = await provider.send(
        { id: device.id, platform: device.platform as DevicePlatform, token: decryptField(device.token) },
        {
          fallbackTitle: privateText.title,
          fallbackBody: privateText.body,
          encrypted,
          notificationId: job.inboxId,
          channel: def.channel,
          urgent: def.urgent,
          highPriority: channel.android === "high",
          iosInterruptionLevel: channel.ios,
          collapseKey: `${def.channel}:${row.dedupeKey}`,
        },
      );
      if (result.ok) {
        stats.pushes++;
      } else {
        stats.pushFailures++;
        if (result.permanent) {
          await controlDb.delete(pushDevices).where(eq(pushDevices.id, device.id));
          logger.info({ deviceId: device.id }, "[notifications] removed dead push registration");
        } else {
          logger.warn({ deviceId: device.id, error: result.error }, "[notifications] push failed");
        }
      }
    }
  }
}

// ── One event ───────────────────────────────────────────────────────────────

async function processRow(db: TenantDatabase, row: OutboxRow, provider: PushProvider, stats: DispatchStats): Promise<void> {
  if (!isEventType(row.eventType)) {
    await db.update(notificationOutbox)
      .set({ status: "failed", lastError: `unknown event type ${row.eventType}` })
      .where(eq(notificationOutbox.id, row.id));
    stats.failed++;
    return;
  }
  const type = row.eventType;
  const def = EVENTS[type];

  const [tenant] = await controlDb
    .select({ status: tenants.status, plan: tenants.plan })
    .from(tenants)
    .where(eq(tenants.id, row.tenantId))
    .limit(1);
  if (!tenant || tenant.status !== "active") {
    await db.update(notificationOutbox)
      .set({ status: "expired", lastError: "tenant not active", dispatchedAt: new Date() })
      .where(eq(notificationOutbox.id, row.id));
    return;
  }

  const payload = row.payload as unknown as EventPayloads[typeof type];
  const target = targetFor(type, payload as never);
  const now = new Date();
  const amountPaise = def.amountField ? amountToPaise((row.payload as Record<string, unknown>)[def.amountField]) : null;

  const { members, prefs, settings } = await loadRecipients(row.tenantId, def.channel, row.businessId);

  const inboxValues: Array<typeof notificationInbox.$inferInsert> = [];
  const decisions = new Map<string, { push: boolean; email: boolean; title: string; body: string; emailTo: string; locale: Locale }>();

  for (const m of members) {
    const s = settings.get(m.userId);
    const p = prefs.get(m.userId);
    const decision = decideDelivery(
      {
        type,
        actorUserId: row.actorUserId,
        ownerUserId: row.ownerUserId,
        subjectUserId: row.subjectUserId,
        amountPaise,
        now,
      },
      {
        userId: m.userId,
        role: m.role,
        tenantOverride: p?.tenant,
        businessOverride: p?.business,
        pausedUntil: s?.pausedUntil,
        quietStart: s ? s.quietStart : undefined,
        quietEnd: s ? s.quietEnd : undefined,
        promotionsOptIn: s?.promotionsOptIn ?? false,
      },
    );
    if (!decision.inbox) continue;

    const locale = s?.locale ?? DEFAULT_LOCALE;
    const text = renderNotification(type, payload as never, locale);
    inboxValues.push({
      tenantId: row.tenantId,
      businessId: row.businessId,
      recipientUserId: m.userId,
      outboxId: row.id,
      channel: def.channel,
      eventType: type,
      title: text.title,
      body: text.body,
      locale,
      target,
      locked: decision.locked,
    });
    decisions.set(m.userId, { push: decision.push, email: decision.email, title: text.title, body: text.body, emailTo: m.email, locale });
  }

  // Only rows inserted now get side effects; a retry after a crash skips
  // recipients who were already notified.
  const inserted = inboxValues.length
    ? await db.insert(notificationInbox)
      .values(inboxValues)
      .onConflictDoNothing({ target: [notificationInbox.outboxId, notificationInbox.recipientUserId] })
      .returning({ id: notificationInbox.id, userId: notificationInbox.recipientUserId })
    : [];
  stats.inboxRows += inserted.length;

  const pushJobs: PushJob[] = [];
  for (const ins of inserted) {
    const d = decisions.get(ins.userId);
    if (!d) continue;
    if (d.push) pushJobs.push({ inboxId: ins.id, userId: ins.userId, title: d.title, body: d.body, target });
    if (d.email) {
      try {
        await emailService.sendNotification(d.emailTo, {
          title: d.title,
          body: d.body,
          url: `${appUrl()}${targetPath(target)}`,
          locale: d.locale,
        });
        stats.emails++;
      } catch (err) {
        logger.warn({ err, outboxId: row.id }, "[notifications] email copy failed");
      }
    }
  }

  await deliverPush(provider, row, tenant.plan, pushJobs, settings, stats);

  await db.update(notificationOutbox)
    .set({ status: "dispatched", dispatchedAt: new Date(), lastError: null })
    .where(eq(notificationOutbox.id, row.id));
  stats.processed++;
}

/**
 * Dispatch everything pending in one tenant database. In self-hosted mode the
 * single database holds every tenant's rows; each row carries its tenant_id.
 */
export async function dispatchPending(
  db: TenantDatabase,
  provider: PushProvider = getPushProvider(),
  maxBatches = 20,
): Promise<DispatchStats> {
  const stats = emptyStats();
  for (let i = 0; i < maxBatches; i++) {
    const rows = await claimBatch(db, new Date());
    if (rows.length === 0) break;
    for (const row of rows) {
      try {
        await processRow(db, row, provider, stats);
      } catch (err) {
        stats.failed++;
        const giveUp = row.attempts >= MAX_ATTEMPTS;
        const backoffMs = Math.min(60 * 60 * 1000, 2 ** row.attempts * 30 * 1000);
        logger.error({ err, outboxId: row.id, attempts: row.attempts }, "[notifications] dispatch failed");
        await db.update(notificationOutbox)
          .set({
            status: giveUp ? "failed" : "pending",
            availableAt: new Date(Date.now() + backoffMs),
            lastError: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
          })
          .where(eq(notificationOutbox.id, row.id));
      }
    }
    if (rows.length < BATCH_SIZE) break;
  }
  return stats;
}

/** Retention: outbox rows 7 days after dispatch, inbox rows after 90 days. */
export async function pruneNotifications(db: TenantDatabase, now: Date = new Date()): Promise<void> {
  await db.delete(notificationOutbox).where(and(
    inArray(notificationOutbox.status, ["dispatched", "expired", "failed"]),
    lt(notificationOutbox.createdAt, new Date(now.getTime() - OUTBOX_RETENTION_MS)),
  ));
  await db.delete(notificationInbox).where(lt(notificationInbox.createdAt, new Date(now.getTime() - INBOX_RETENTION_MS)));
}

// ── Scheduler ───────────────────────────────────────────────────────────────

const TICK_MS = 3_000;
const FULL_SWEEP_MS = 60_000;
const PRUNE_MS = 60 * 60 * 1000;
const isMultiTenant = () => process.env.MULTI_TENANT === "true";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let lastFullSweep = 0;
let lastPrune = 0;

async function activeTenantIds(): Promise<string[]> {
  const rows = await controlDb.select({ id: tenants.id }).from(tenants).where(eq(tenants.status, "active"));
  return rows.map((r) => r.id);
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    const prune = now - lastPrune > PRUNE_MS;
    if (!isMultiTenant()) {
      drainKickedTenants();
      const db = await getTenantDb("single");
      await dispatchPending(db);
      if (prune) await pruneNotifications(db);
    } else {
      const fullSweep = now - lastFullSweep > FULL_SWEEP_MS;
      const ids = fullSweep ? await activeTenantIds() : drainKickedTenants();
      if (fullSweep) {
        drainKickedTenants();
        lastFullSweep = now;
      }
      for (const id of ids) {
        try {
          const db = await getTenantDb(id);
          await dispatchPending(db);
          if (prune) await pruneNotifications(db);
        } catch (err) {
          logger.error({ err, tenantId: id }, "[notifications] tenant dispatch error");
        }
      }
    }
    if (prune) {
      await pruneQuotaWindows();
      lastPrune = now;
    }
  } catch (err) {
    logger.error({ err }, "[notifications] dispatcher tick error");
  } finally {
    running = false;
  }
}

export function startNotificationDispatcher(): void {
  if (timer) return;
  timer = setInterval(() => { void tick(); }, TICK_MS);
  timer.unref();
  logger.info({ provider: getPushProvider().name }, "[notifications] dispatcher started");
}

export function stopNotificationDispatcher(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

