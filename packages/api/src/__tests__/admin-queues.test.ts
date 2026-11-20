/**
 * Tests for the admin dashboard's Queues view (lib/admin/queues.ts and the
 * queues screen). Pure: a fake SqlRunner feeds the JSON the pg-boss queries
 * return, so no database is needed.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { setColorEnabled, width } from "../lib/admin/tui.js";
import {
  collectQueueStats, parseQueueStats, emptyQueueStats, queueSql, QUEUE_PROBE_SQL, LIVE_WORKER_SECONDS,
} from "../lib/admin/queues.js";
import type { SqlRunner, DbTarget, PlatformStats } from "../lib/admin/stats.js";
import { buildDemoStats } from "../lib/admin/demo.js";
import { renderFrame, type ViewState } from "../lib/admin/screens.js";
import { maskStats, tenantHandle } from "../lib/admin/privacy.js";
import { deriveAlerts } from "../lib/admin/alerts.js";

beforeAll(() => setColorEnabled(false));

const NOW = new Date("2026-09-12T10:00:00Z");
const TENANT = "8f1d0c2e-3b4a-4c5d-9e6f-7a8b9c0d1e2f";

const queueJson = {
  queues: [
    { name: "einvoice.submit", policy: "standard", queued: 3, active: "1", retry: 1, failed: 2, done_15m: 40, failed_15m: 1, oldest_wait_seconds: 620, paused: false },
    { name: "system.ping", policy: "standard", queued: 0, active: 0, retry: 0, failed: 0, done_15m: 1, failed_15m: 0, oldest_wait_seconds: null, paused: true },
  ],
  dead_15m: 6,
  workers: [
    { name: "worker:default,heavy,system", host: "c0ffee12ab34", pid: 7, version: "12.37.1", started_on: "2026-09-12T08:00:00Z", stopped_on: null, heartbeat_age_seconds: 8 },
    { name: "worker:heavy", host: "deadbeef9876", pid: 9, version: "12.37.1", started_on: "2026-09-12T08:00:00Z", stopped_on: null, heartbeat_age_seconds: LIVE_WORKER_SECONDS + 30 },
    { name: "api", host: "a1b2c3d4e5f6", pid: 1, version: "12.37.1", started_on: "2026-09-12T08:00:00Z", stopped_on: null, heartbeat_age_seconds: 5 },
  ],
  recent_failures: [
    { queue: "einvoice.submit", job_id: "j1", failed_at: "2026-09-12T09:58:00Z", created_at: "2026-09-12T09:50:00Z", attempts: 4, type: "RetryableError", error: "upstream down for ops@acme.in", tenant_id: TENANT },
    { queue: "system.ping", job_id: "j2", failed_at: "2026-09-12T09:00:00Z", created_at: null, attempts: 0, type: "PermanentError", error: "bad input", tenant_id: null },
  ],
};

class QueueRunner implements SqlRunner {
  calls: string[] = [];
  constructor(private readonly probe: unknown, private readonly data: unknown = queueJson, private readonly fail = false) {}
  describe() { return "fake"; }
  async queryJson(_target: DbTarget, sql: string): Promise<unknown> {
    this.calls.push(sql);
    if (sql === QUEUE_PROBE_SQL) return this.probe;
    if (this.fail) throw new Error('ERROR:  permission denied for schema pgboss\nLINE 3: ...');
    return this.data;
  }
  async close() { /* noop */ }
}

describe("parseQueueStats", () => {
  it("coerces counts, totals the queues and only counts fresh worker heartbeats as live", () => {
    const q = parseQueueStats(queueJson);
    expect(q.installed).toBe(true);
    expect(q.queues[0]).toMatchObject({ name: "einvoice.submit", active: 1, failed: 2, oldestWaitSeconds: 620, paused: false });
    expect(q.queues[1].oldestWaitSeconds).toBeNull();
    expect(q.queues[1].paused).toBe(true);
    expect(q.totals).toEqual({ queued: 3, active: 1, retry: 1, failed: 2, done15m: 41, failed15m: 1, dead15m: 6, oldestWaitSeconds: 620 });
    // The API's own pg-boss instance is never a worker, and a stale heartbeat is not live.
    expect(q.workers.map((w) => w.live)).toEqual([true, false, false]);
    expect(q.liveWorkers).toBe(1);
    expect(q.recentFailures[1].tenantId).toBeNull();
  });

  it("tolerates an empty payload", () => {
    const q = parseQueueStats(null);
    expect(q.queues).toEqual([]);
    expect(q.totals.oldestWaitSeconds).toBeNull();
    expect(q.liveWorkers).toBe(0);
  });
});

describe("collectQueueStats", () => {
  it("reports 'not installed' without touching pgboss tables when the schema is absent", async () => {
    const runner = new QueueRunner({ installed: false, instances: false, controls: false });
    const q = await collectQueueStats(runner);
    expect(q).toEqual(emptyQueueStats(false));
    expect(runner.calls).toEqual([QUEUE_PROBE_SQL]);
  });

  it("reads the queue tables and resolves tenant names for failures", async () => {
    const runner = new QueueRunner({ installed: true, instances: true, controls: true });
    const q = await collectQueueStats(runner, new Map([[TENANT, "Acme"]]));
    expect(runner.calls).toHaveLength(2);
    expect(q.recentFailures[0].tenantName).toBe("Acme");
    expect(q.recentFailures[1].tenantName).toBeNull();
  });

  it("leaves out queue_controls and the instance registry when an older schema lacks them", async () => {
    const runner = new QueueRunner({ installed: true, instances: false, controls: false });
    await collectQueueStats(runner);
    expect(runner.calls[1]).toBe(queueSql({ controls: false, instances: false }));
    expect(runner.calls[1]).not.toContain("queue_controls");
    expect(runner.calls[1]).not.toContain("pgboss.instance");
  });

  it("captures a query failure instead of throwing", async () => {
    const q = await collectQueueStats(new QueueRunner({ installed: true, instances: true, controls: true }, queueJson, true));
    expect(q.installed).toBe(true);
    expect(q.error).toBe("ERROR:  permission denied for schema pgboss");
  });

  it("only ever issues read-only statements", () => {
    for (const sql of [QUEUE_PROBE_SQL, queueSql({ controls: true, instances: true })]) {
      expect(sql.trim().toLowerCase().startsWith("select")).toBe(true);
      expect(sql).not.toMatch(/\b(insert|update|delete|truncate|alter|drop|create)\b/i);
    }
  });
});

function statsWithQueues(queues = parseQueueStats(queueJson)): PlatformStats {
  const base = buildDemoStats(NOW);
  for (const f of queues.recentFailures) f.tenantName = f.tenantId ? "Acme Traders" : null;
  return { ...base, queues };
}

describe("masking", () => {
  it("hashes tenant ids, masks hosts and scrubs error text; reveals nothing else", () => {
    const masked = maskStats(statsWithQueues()).queues;
    expect(masked.recentFailures[0].tenantId).toBe(tenantHandle(TENANT));
    expect(masked.recentFailures[0].tenantName).toBe(`Tenant ${tenantHandle(TENANT)}`);
    expect(masked.recentFailures[0].error).not.toContain("ops@acme.in");
    expect(masked.recentFailures[1].tenantName).toBeNull();
    expect(masked.workers[0].host).not.toBe("c0ffee12ab34");
    expect(masked.workers[0].host.startsWith("c0f")).toBe(true);
    expect(masked.totals).toEqual(parseQueueStats(queueJson).totals);
    expect(JSON.stringify(masked)).not.toContain(TENANT);
  });
});

describe("queue alerts", () => {
  const texts = (st: PlatformStats) => deriveAlerts(st).filter((a) => a.view === "queues").map((a) => `${a.level}:${a.text}`);

  it("flags waiting jobs without a live worker, a failure spike and a growing backlog", () => {
    const q = parseQueueStats({ ...queueJson, workers: [] });
    expect(texts(statsWithQueues(q))).toEqual([
      "red:no live queue workers · 4 jobs waiting",
      "red:6 jobs failed · 15m",
      "yellow:queue backlog · oldest waiting 10m",
    ]);
  });

  it("is quiet when the queue is healthy, and says so when it is not installed", () => {
    const q = parseQueueStats({ ...queueJson, dead_15m: 0, queues: [{ ...queueJson.queues[1], paused: false }] });
    expect(texts(statsWithQueues(q))).toEqual([]);
    expect(texts(statsWithQueues(emptyQueueStats(false)))).toEqual([]);
    expect(texts(statsWithQueues(emptyQueueStats(true, "boom")))).toEqual(["yellow:job queue unreadable"]);
  });

  it("asks for a retry when failed jobs are parked but nothing failed recently", () => {
    const q = parseQueueStats({ ...queueJson, dead_15m: 0 });
    expect(texts(statsWithQueues(q))).toContain("yellow:2 failed jobs awaiting retry");
  });
});

function stateFor(stats: PlatformStats): ViewState {
  return {
    view: "queues", stats, loading: false, refreshing: false, error: null, selected: 0,
    interactive: true, intervalSec: 30, nextRefreshAt: null, runnerLabel: "fake", version: "0.9.0", now: NOW, masked: true,
  };
}

describe("queues screen", () => {
  it.each([[60, 30], [100, 40], [120, 45], [200, 60]])("fits %i×%i exactly", (cols, rows) => {
    const frame = renderFrame(stateFor(buildDemoStats(NOW)), cols, rows);
    expect(frame).toHaveLength(rows);
    for (const row of frame) expect(width(row)).toBe(cols);
  });

  it("shows counts, workers and recent failures from the demo data", () => {
    const text = renderFrame(stateFor(buildDemoStats(NOW)), 140, 50).join("\n");
    expect(text).toContain("Queues");
    expect(text).toContain("einvoice.submit");
    expect(text).toContain("paused");
    expect(text).toContain("Workers");
    expect(text).toContain("Recent failures");
    expect(text).toMatch(/5\s+Queues/);
  });

  it("renders a --once snapshot at natural height", () => {
    const state = { ...stateFor(buildDemoStats(NOW)), interactive: false };
    const frame = renderFrame(state, 120);
    for (const row of frame) expect(width(row)).toBe(120);
    expect(frame.join("\n")).toContain("bank.statement.process");
  });

  it("explains a missing queue schema instead of failing", () => {
    const text = renderFrame(stateFor(statsWithQueues(emptyQueueStats(false))), 100, 30).join("\n");
    expect(text).toContain("job queue not installed");
    const failed = renderFrame(stateFor(statsWithQueues(emptyQueueStats(true, "permission denied"))), 100, 30).join("\n");
    expect(failed).toContain("could not read the job queue");
    expect(failed).toContain("permission denied");
  });
});
