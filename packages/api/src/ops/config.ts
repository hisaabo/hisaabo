/**
 * /ops configuration from the environment (docs/architecture/queue.md §7.2,
 * §11). Read on every call so tests (and a restart-free env change in dev)
 * see the current values; parsing is cheap.
 */
import { parseCidrList, type Cidr } from "./cidr.js";

export interface OpsConfig {
  enabled: boolean;
  /** null = no IP allowlist configured. */
  allowlist: Cidr[] | null;
  idleMs: number;
  maxMs: number;
  stepUpMs: number;
}

function positiveInt(raw: string | undefined, fallback: number, key: string): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) throw new Error(`${key} must be a positive integer`);
  return n;
}

export function opsConfig(env: NodeJS.ProcessEnv = process.env): OpsConfig {
  const allowRaw = (env.OPS_IP_ALLOWLIST ?? "").trim();
  return {
    enabled: env.QUEUE_DASHBOARD_ENABLED === "true",
    allowlist: allowRaw ? parseCidrList(allowRaw) : null,
    idleMs: positiveInt(env.OPS_SESSION_IDLE_MINUTES, 15, "OPS_SESSION_IDLE_MINUTES") * 60_000,
    maxMs: positiveInt(env.OPS_SESSION_MAX_HOURS, 8, "OPS_SESSION_MAX_HOURS") * 3_600_000,
    stepUpMs: positiveInt(env.OPS_STEP_UP_MINUTES, 5, "OPS_STEP_UP_MINUTES") * 60_000,
  };
}
