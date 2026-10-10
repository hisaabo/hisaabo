export { emitNotificationEvent, emitNotificationEventSafe, emitTenantEvent, userDisplayName, resolveBusinessTenantId } from "./emit.js";
export type { EmitInput, ActorKind, TenantDbOrTx } from "./emit.js";
export { dispatchPending, pruneNotifications, targetPath } from "./dispatcher.js";

import { startNotificationDispatcher, stopNotificationDispatcher } from "./dispatcher.js";
import { startCollectionsSweep, stopCollectionsSweep } from "./collections-sweep.js";

/**
 * Background workers: the outbox dispatcher (every 3 s) and the hourly
 * collections sweep. Set NOTIFICATIONS_WORKER=false on replicas that should
 * only serve requests; outbox claiming is safe across replicas either way.
 */
export function startNotificationWorkers(): void {
  if (process.env.NOTIFICATIONS_WORKER === "false") return;
  startNotificationDispatcher();
  startCollectionsSweep();
}

export function stopNotificationWorkers(): void {
  stopNotificationDispatcher();
  stopCollectionsSweep();
}
