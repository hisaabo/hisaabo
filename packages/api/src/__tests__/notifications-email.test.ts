/**
 * Notification email transport (no database, no network).
 *
 * - Without a provider in production, the notification copy is skipped with a
 *   single warning per process: no throw, no FATAL line per event. The inbox is
 *   written regardless (the dispatcher only logs a failed copy).
 * - With Resend configured, the request carries a timeout so a hung connection
 *   cannot stall the dispatch tick.
 * - Magic-link behaviour without a provider is unchanged (still an error in
 *   production).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const message = {
  title: "Role changed for Suresh Sharma",
  body: "Seller → Sales manager.",
  url: "https://app.example.in/settings?tab=team",
  locale: "en" as const,
};

async function loadEmailService(env: Record<string, string | undefined>) {
  vi.resetModules();
  // An empty value counts as "not set" for the provider check.
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value ?? "");
  return (await import("../lib/email.js")).emailService;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("notification email without a provider", () => {
  it("in production: does not throw, does not log FATAL, and warns exactly once per process", async () => {
    const service = await loadEmailService({ NODE_ENV: "production", RESEND_API_KEY: undefined });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(service.sendNotification("owner@acmetrading.in", message)).resolves.toBeUndefined();
    await expect(service.sendNotification("accountant@acmetrading.in", message)).resolves.toBeUndefined();
    await expect(service.sendNotification("owner@acmetrading.in", message)).resolves.toBeUndefined();

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("notification emails disabled: no email provider configured");
  });

  it("outside production: prints the notification for local development", async () => {
    const service = await loadEmailService({ NODE_ENV: "development", RESEND_API_KEY: undefined });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await service.sendNotification("owner@acmetrading.in", message);

    expect(log.mock.calls.some((c) => String(c[0]).includes("notification to owner@acmetrading.in"))).toBe(true);
  });

  it("leaves the magic-link behaviour alone: still an error in production", async () => {
    const service = await loadEmailService({ NODE_ENV: "production", RESEND_API_KEY: undefined });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(service.sendMagicLink("owner@acmetrading.in", "https://app.example.in/magic?token=t")).rejects.toThrow(
      /Email service not configured/,
    );
  });
});

describe("notification email via Resend", () => {
  it("sends with a 10 s timeout signal", async () => {
    const service = await loadEmailService({ NODE_ENV: "production", RESEND_API_KEY: "re_test_key" });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await service.sendNotification("owner@acmetrading.in", message);

    expect(timeout).toHaveBeenCalledWith(10_000);
    const init = fetchMock.mock.calls[0][1]!;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("a hung request is aborted instead of stalling the caller", async () => {
    const service = await loadEmailService({ NODE_ENV: "production", RESEND_API_KEY: "re_test_key" });
    // Shorten the real timeout so the test is quick; the production value is asserted above.
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => AbortSignal.abort(new DOMException("timed out", "TimeoutError")));
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      if (init?.signal?.aborted) reject(init.signal.reason);
    }));

    await expect(service.sendNotification("owner@acmetrading.in", message)).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
