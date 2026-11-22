export { emitNotificationEvent, emitNotificationEventSafe, withNotificationSavepoint, emitTenantEvent, userDisplayName, resolveBusinessTenantId } from "./emit.js";
export type { EmitInput, ActorKind, TenantDbOrTx } from "./emit.js";
export { dispatchPending, pruneNotifications, targetPath, fullSweepMs } from "./dispatcher.js";

import { startNotificationDispatcher, stopNotificationDispatcher } from "./dispatcher.js";
import { startCollectionsSweep, stopCollectionsSweep } from "./collections-sweep.js";
import { logger } from "../logger.js";

export interface NotificationWorkerDecision {
  enabled: boolean;
  /** Human-readable explanation; logged once at startup when the workers are off. */
  reason: string;
  /** Set when NOTIFICATIONS_WORKER held something other than true/false and the default was used instead. */
  invalidValue?: string;
}

/**
 * Whether this process runs the background workers (the outbox dispatcher,
 * every 3 s, and the hourly collections sweep).
 *
 *   NOTIFICATIONS_WORKER=true   on (any mode)
 *   NOTIFICATIONS_WORKER=false  off (e.g. replicas that should only serve requests)
 *   unset / empty               on for self-hosted single-tenant, OFF when MULTI_TENANT=true
 *
 * The multi-tenant default is off because today's dispatcher scans every active
 * tenant database (NOTIFICATIONS_FULL_SWEEP_SECONDS), one short-lived connection
 * per tenant; an operator who upgrades with an untouched env must not get that
 * load. Cloud operators opt in with
 * NOTIFICATIONS_WORKER=true until the queue-backed dispatcher lands
 * (docs/architecture/notifications.md §6). While it is off, events queue in
 * notification_outbox and are delivered once a worker is enabled.
 *
 * Values are matched case-insensitively and trimmed. Anything else is a typo,
 * not a decision: it is reported (invalidValue) and the default applies.
 * MULTI_TENANT is read exactly as the rest of the API does (=== "true").
 */
export function notificationWorkersEnabled(env: NodeJS.ProcessEnv = process.env): NotificationWorkerDecision {
  const multiTenant = env.MULTI_TENANT === "true";
  const raw = (env.NOTIFICATIONS_WORKER ?? "").trim();
  const value = raw.toLowerCase();

  if (value === "true") return { enabled: true, reason: "NOTIFICATIONS_WORKER=true" };
  if (value === "false") return { enabled: false, reason: "worker disabled by NOTIFICATIONS_WORKER=false" };

  const byDefault: NotificationWorkerDecision = multiTenant
    ? {
        enabled: false,
        reason:
          "worker off by default in multi-tenant mode; set NOTIFICATIONS_WORKER=true to enable " +
          "(events queue in notification_outbox meanwhile)",
      }
    : { enabled: true, reason: "worker on by default (single-tenant)" };
  return raw === "" ? byDefault : { ...byDefault, invalidValue: raw };
}

/**
 * Starts the background workers unless notificationWorkersEnabled() says
 * otherwise. Outbox claiming is safe across replicas, so several can run it.
 * Off is harmless: emit() still writes its outbox row inside the domain
 * transaction and the row waits there until a worker runs.
 */
export function startNotificationWorkers(env: NodeJS.ProcessEnv = process.env): void {
  const decision = notificationWorkersEnabled(env);
  if (decision.invalidValue !== undefined) {
    logger.warn(
      { value: decision.invalidValue },
      `[notifications] NOTIFICATIONS_WORKER must be "true" or "false"; ignoring it (worker ${decision.enabled ? "on" : "off"} by default)`,
    );
  }
  if (!decision.enabled) {
    logger.info(`[notifications] ${decision.reason}`);
    return;
  }
  startNotificationDispatcher();
  startCollectionsSweep();
}

export function stopNotificationWorkers(): void {
  stopNotificationDispatcher();
  stopCollectionsSweep();
}
