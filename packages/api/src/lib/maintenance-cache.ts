import { controlDb, systemConfig } from "@hisaabo/db";
import { eq } from "drizzle-orm";

export interface MaintenanceStatus {
  enabled: boolean;
  message: string;
  startsAt: string | null;
  endsAt: string | null;
}

const DEFAULT_STATUS: MaintenanceStatus = { enabled: false, message: "", startsAt: null, endsAt: null };
const CACHE_TTL_MS = 30_000;

let cached: MaintenanceStatus | null = null;
let cachedAt = 0;

export async function getMaintenanceStatus(): Promise<MaintenanceStatus> {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) return cached;

  const [row] = await controlDb
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, "maintenance"))
    .limit(1);

  const value = (row?.value ?? DEFAULT_STATUS) as MaintenanceStatus;
  cached = {
    enabled: value.enabled ?? false,
    message: value.message ?? "",
    startsAt: value.startsAt ?? null,
    endsAt: value.endsAt ?? null,
  };
  cachedAt = now;
  return cached;
}

export function invalidateMaintenanceCache(): void {
  cached = null;
  cachedAt = 0;
}
