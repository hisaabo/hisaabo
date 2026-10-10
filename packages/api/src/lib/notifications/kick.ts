/**
 * In-process nudge so the dispatcher handles fresh events within a tick instead
 * of waiting for the next full sweep. In multi-tenant mode the dispatcher only
 * scans tenants that were kicked, plus a full sweep every minute; events from
 * other API replicas are picked up by that sweep.
 */

const dirtyTenants = new Set<string>();

export function kickDispatcher(tenantId: string): void {
  dirtyTenants.add(tenantId);
}

/** Returns and clears the set of tenants with fresh events. */
export function drainKickedTenants(): string[] {
  const ids = [...dirtyTenants];
  dirtyTenants.clear();
  return ids;
}
