/**
 * Which processes run the notification workers (no database needed).
 *
 * Contract: NOTIFICATIONS_WORKER=true/false is explicit; unset means on for
 * single-tenant and OFF for multi-tenant, so an operator upgrading with an
 * untouched env never starts the all-tenant dispatcher sweep by accident.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const starts = vi.hoisted(() => ({
  dispatcher: vi.fn(),
  sweep: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

// Keep every real export (index.ts re-exports several) and replace only what would start timers.
vi.mock("../lib/notifications/dispatcher.js", async (orig) => ({
  ...(await orig<typeof import("../lib/notifications/dispatcher.js")>()),
  startNotificationDispatcher: starts.dispatcher,
  stopNotificationDispatcher: vi.fn(),
}));
vi.mock("../lib/notifications/collections-sweep.js", async (orig) => ({
  ...(await orig<typeof import("../lib/notifications/collections-sweep.js")>()),
  startCollectionsSweep: starts.sweep,
  stopCollectionsSweep: vi.fn(),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: starts.info, warn: starts.warn, error: vi.fn(), debug: vi.fn() },
}));

import { notificationWorkersEnabled, startNotificationWorkers } from "../lib/notifications/index.js";

const single = (workers?: string): NodeJS.ProcessEnv => ({ ...(workers !== undefined && { NOTIFICATIONS_WORKER: workers }) });
const multi = (workers?: string): NodeJS.ProcessEnv => ({ MULTI_TENANT: "true", ...(workers !== undefined && { NOTIFICATIONS_WORKER: workers }) });

describe("notificationWorkersEnabled", () => {
  describe("unset", () => {
    it("is on for self-hosted single-tenant", () => {
      expect(notificationWorkersEnabled(single()).enabled).toBe(true);
      expect(notificationWorkersEnabled({ MULTI_TENANT: "false" }).enabled).toBe(true);
    });

    it("is off in multi-tenant mode, with a reason that tells the operator how to opt in", () => {
      const d = notificationWorkersEnabled(multi());
      expect(d.enabled).toBe(false);
      expect(d.reason).toContain("NOTIFICATIONS_WORKER=true");
      expect(d.reason).toContain("notification_outbox");
      expect(d.invalidValue).toBeUndefined();
    });

    it("treats an empty or blank value as unset", () => {
      expect(notificationWorkersEnabled(single("")).enabled).toBe(true);
      expect(notificationWorkersEnabled(multi("")).enabled).toBe(false);
      expect(notificationWorkersEnabled(multi("   ")).enabled).toBe(false);
      expect(notificationWorkersEnabled(multi("")).invalidValue).toBeUndefined();
      expect(notificationWorkersEnabled(single("  ")).invalidValue).toBeUndefined();
    });
  });

  describe("explicit true", () => {
    it("turns the worker on in both modes (the cloud opt-in)", () => {
      expect(notificationWorkersEnabled(single("true")).enabled).toBe(true);
      expect(notificationWorkersEnabled(multi("true")).enabled).toBe(true);
    });
  });

  describe("explicit false", () => {
    it("turns the worker off in both modes", () => {
      const s = notificationWorkersEnabled(single("false"));
      const m = notificationWorkersEnabled(multi("false"));
      expect(s.enabled).toBe(false);
      expect(m.enabled).toBe(false);
      expect(s.reason).toContain("NOTIFICATIONS_WORKER=false");
      expect(s.invalidValue).toBeUndefined();
      expect(m.invalidValue).toBeUndefined();
    });
  });

  describe("case and whitespace", () => {
    it.each(["TRUE", "True", " true ", "\ttrue\n"])("accepts %j as true", (v) => {
      expect(notificationWorkersEnabled(multi(v))).toEqual({ enabled: true, reason: "NOTIFICATIONS_WORKER=true" });
    });

    it.each(["FALSE", "False", " false ", "\nfalse\t"])("accepts %j as false", (v) => {
      const d = notificationWorkersEnabled(single(v));
      expect(d.enabled).toBe(false);
      expect(d.invalidValue).toBeUndefined();
    });
  });

  describe("garbage", () => {
    it("falls back to the default for the mode and reports the offending value", () => {
      const s = notificationWorkersEnabled(single("flase"));
      expect(s.enabled).toBe(true);
      expect(s.invalidValue).toBe("flase");

      const m = notificationWorkersEnabled(multi("flase"));
      expect(m.enabled).toBe(false);
      expect(m.invalidValue).toBe("flase");
    });

    it.each(["0", "1", "yes", "no", "on", "off", "null", "undefined"])("does not guess what %j meant", (v) => {
      expect(notificationWorkersEnabled(single(v)).enabled).toBe(true);
      expect(notificationWorkersEnabled(single(v)).invalidValue).toBe(v);
      expect(notificationWorkersEnabled(multi(v)).enabled).toBe(false);
      expect(notificationWorkersEnabled(multi(v)).invalidValue).toBe(v);
    });
  });

  describe("MULTI_TENANT is read like the rest of the API", () => {
    it("only the exact string \"true\" means multi-tenant", () => {
      expect(notificationWorkersEnabled({ MULTI_TENANT: "TRUE" }).enabled).toBe(true);
      expect(notificationWorkersEnabled({ MULTI_TENANT: "1" }).enabled).toBe(true);
      expect(notificationWorkersEnabled({ MULTI_TENANT: "true" }).enabled).toBe(false);
    });
  });

  it("reads process.env when no env is passed", () => {
    const saved = { w: process.env.NOTIFICATIONS_WORKER, m: process.env.MULTI_TENANT };
    try {
      delete process.env.NOTIFICATIONS_WORKER;
      process.env.MULTI_TENANT = "true";
      expect(notificationWorkersEnabled().enabled).toBe(false);
      process.env.NOTIFICATIONS_WORKER = "true";
      expect(notificationWorkersEnabled().enabled).toBe(true);
    } finally {
      if (saved.w === undefined) delete process.env.NOTIFICATIONS_WORKER; else process.env.NOTIFICATIONS_WORKER = saved.w;
      if (saved.m === undefined) delete process.env.MULTI_TENANT; else process.env.MULTI_TENANT = saved.m;
    }
  });
});

describe("startNotificationWorkers", () => {
  beforeEach(() => vi.clearAllMocks());

  const started = () => ({ dispatcher: starts.dispatcher.mock.calls.length, sweep: starts.sweep.mock.calls.length });

  it("starts the dispatcher and the collections sweep on an untouched single-tenant env", () => {
    startNotificationWorkers(single());
    expect(started()).toEqual({ dispatcher: 1, sweep: 1 });
    expect(starts.info).not.toHaveBeenCalled();
    expect(starts.warn).not.toHaveBeenCalled();
  });

  it("starts nothing on an untouched multi-tenant env, and says so once at info level", () => {
    startNotificationWorkers(multi());
    expect(started()).toEqual({ dispatcher: 0, sweep: 0 });
    expect(starts.info).toHaveBeenCalledTimes(1);
    expect(String(starts.info.mock.calls[0][0])).toContain("off by default in multi-tenant mode");
    expect(starts.warn).not.toHaveBeenCalled();
  });

  it("starts both in multi-tenant mode when NOTIFICATIONS_WORKER=true", () => {
    startNotificationWorkers(multi("true"));
    expect(started()).toEqual({ dispatcher: 1, sweep: 1 });
    expect(starts.info).not.toHaveBeenCalled();
  });

  it("starts nothing when NOTIFICATIONS_WORKER=false, in either mode", () => {
    startNotificationWorkers(single("false"));
    startNotificationWorkers(multi("FALSE"));
    expect(started()).toEqual({ dispatcher: 0, sweep: 0 });
    expect(starts.warn).not.toHaveBeenCalled();
  });

  it("warns about an unrecognised value and applies the default for the mode", () => {
    startNotificationWorkers(single("flase"));
    expect(started()).toEqual({ dispatcher: 1, sweep: 1 });
    expect(starts.warn).toHaveBeenCalledTimes(1);
    expect(starts.warn.mock.calls[0][0]).toEqual({ value: "flase" });

    vi.clearAllMocks();
    startNotificationWorkers(multi("flase"));
    expect(started()).toEqual({ dispatcher: 0, sweep: 0 });
    expect(starts.warn).toHaveBeenCalledTimes(1);
  });
});
