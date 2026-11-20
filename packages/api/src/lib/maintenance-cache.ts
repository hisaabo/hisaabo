import { controlDb, systemConfig } from "@hisaabo/db";
import { eq } from "drizzle-orm";
import { TtlCache } from "./cache/ttl-cache.js";
import { cacheBus } from "./cache/bus.js";

export interface MaintenanceStatus {
  enabled: boolean;
  message: string;
  startsAt: string | null;
  endsAt: string | null;
}

const DEFAULT_STATUS: MaintenanceStatus = { enabled: false, message: "", startsAt: null, endsAt: null };
const CACHE_TTL_MS = 30_000;
const KEY = "maintenance";

// Single-entry cache on the shared core: 30s TTL (5s in degraded mode), loaded
// with no-resurrection semantics, dropped by the `maintenance` bus event. The
// CLI (bin/maintenance.ts) writes system_config from another process; the
// system_config trigger -> NOTIFY -> listener emits the event there.
const maintenanceCache = new TtlCache<MaintenanceStatus>({ name: "maintenance", max: 1, ttlMs: CACHE_TTL_MS });

cacheBus.on("maintenance", () => {
  maintenanceCache.delete(KEY);
});

export async function getMaintenanceStatus(): Promise<MaintenanceStatus> {
  const status = await maintenanceCache.getOrLoad(KEY, async () => {
    const [row] = await controlDb
      .select({ value: systemConfig.value })
      .from(systemConfig)
      .where(eq(systemConfig.key, "maintenance"))
      .limit(1);

    const value = (row?.value ?? DEFAULT_STATUS) as MaintenanceStatus;
    return {
      enabled: value.enabled ?? false,
      message: value.message ?? "",
      startsAt: value.startsAt ?? null,
      endsAt: value.endsAt ?? null,
    };
  });
  return status as MaintenanceStatus;
}
