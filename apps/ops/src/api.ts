// Thin client for the API's /ops/api (same origin, cookie auth). Every request
// carries X-Requested-With; the browser adds Origin to POSTs, which the API
// checks against its own origin.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "X-Requested-With": "hisaabo" },
  };
  if (method === "POST") {
    init.headers = { "X-Requested-With": "hisaabo", "Content-Type": "application/json" };
    init.body = JSON.stringify(body ?? {});
  }
  const res = await fetch(`/ops/api/${path}`, init);
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? "error", data.message ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
};

// ── Response shapes ─────────────────────────────────────────

export interface Me {
  appUrl: string | null;
  hisaabo: { email: string } | null;
  operator: { email: string; role: "admin" | "viewer"; enrolled: boolean } | null;
  ops: { expiresAt: string; stepUpValidUntil: string | null; idleMinutes: number } | null;
}

export interface QueueSummary {
  name: string;
  pool: string;
  scope: string;
  policy: string;
  paused: boolean;
  queued: number;
  deferred: number;
  active: number;
  failed: number;
  completedPerMin: number | null;
  failedPerMin: number | null;
  oldestReadySeconds: number | null;
}

export interface JobSummary {
  id: string;
  queue: string;
  state: string;
  attempt: number;
  retryLimit: number;
  tenant: string | null;
  tags: string[];
  createdOn: string;
  startedOn: string | null;
  completedOn: string | null;
  error: string | null;
}

export interface JobDetail extends JobSummary {
  sourceQueue: string | null;
  scope: string | null;
  business: string | null;
  requestId: string | null;
  payloadFields: string[];
  timeline: { event: string; at: string }[];
}

export interface Overview {
  totals: {
    queued: number;
    deferred: number;
    active: number;
    failed: number;
    completedPerMin: number;
    failedPerMin: number;
    oldestReadySeconds: number | null;
    waitP95Seconds: number | null;
    runP95Seconds: number | null;
    liveWorkers: number;
    pausedQueues: number;
  };
  throughput: { at: string; completed: number; failed: number }[];
  recentFailures: JobSummary[];
}

export interface StatPoint {
  at: string;
  queued: number;
  active: number;
  completed: number;
  failed: number;
  waitP50: number | null;
  waitP95: number | null;
  runP50: number | null;
  runP95: number | null;
}

export interface Worker {
  id: string;
  name: string | null;
  role: string;
  host: string;
  pid: number;
  version: string;
  nodeVersion: string;
  workers: number;
  startedOn: string;
  lastHeartbeat: string;
  live: boolean;
}

export interface Schedule {
  name: string;
  key: string;
  cron: string;
  timezone: string;
  updatedOn: string;
  nextRun: string | null;
}

export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  queue: string | null;
  jobIds: string[] | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  result: string;
}
