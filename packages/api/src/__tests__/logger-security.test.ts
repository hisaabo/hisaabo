/**
 * logger-security.test.ts — Regression tests for logSecurityEvent in
 * packages/api/src/lib/logger.ts.
 *
 * WHY THIS FILE EXISTS:
 * The shape of these log lines is a contract with fail2ban
 * (docs/fail2ban/filter.d/hisaabo-api.conf). Field names, the
 * `sec: true` sentinel, and the closed set of event identifiers are
 * all matched by a regex on the operator's host. A silent rename here
 * means every installed jail stops banning, so this test pins the
 * wire format.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { logger, logSecurityEvent, type SecurityEvent } from "../lib/logger.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logSecurityEvent — fail2ban log contract", () => {
  it("emits at warn level with sec:true sentinel and the event/ip fields fail2ban greps for", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);

    logSecurityEvent("login_fail", { ip: "203.0.113.42", reason: "bad_password" });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [obj, msg] = warnSpy.mock.calls[0];
    expect(obj).toEqual({
      sec: true,
      event: "login_fail",
      ip: "203.0.113.42",
      reason: "bad_password",
    });
    expect(msg).toBe("sec login_fail");
  });

  it("inserts ip=\"unknown\" when the caller passes null — keeps the fail2ban regex non-optional on the ip field", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);

    logSecurityEvent("csrf_fail", { ip: null, path: "/api/foo" });

    const [obj] = warnSpy.mock.calls[0];
    expect((obj as { ip: string }).ip).toBe("unknown");
    expect((obj as { path: string }).path).toBe("/api/foo");
    expect((obj as { reason?: string }).reason).toBeUndefined();
  });

  it("inserts ip=\"unknown\" when the caller passes undefined — same guarantee for the optional-IP code paths", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);

    logSecurityEvent("origin_block", { ip: undefined });

    const [obj] = warnSpy.mock.calls[0];
    expect((obj as { ip: string }).ip).toBe("unknown");
  });

  it("omits path/reason from the structured fields when the caller does not pass them — fail2ban regex relies on a stable set of always-present fields, optional ones must not leak as undefined", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);

    logSecurityEvent("rate_limit", { ip: "10.0.0.1" });

    const [obj] = warnSpy.mock.calls[0];
    expect(obj).toEqual({ sec: true, event: "rate_limit", ip: "10.0.0.1" });
  });

  it("preserves the ip string verbatim — fail2ban's <HOST> token requires the unescaped IP, no normalisation, no truncation", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);

    // IPv6 + an unusual but valid CIDR-less form. The logger must not touch it.
    logSecurityEvent("rate_limit", { ip: "2001:db8::1" });

    const [obj] = warnSpy.mock.calls[0];
    expect((obj as { ip: string }).ip).toBe("2001:db8::1");
  });

  it("accepts every documented SecurityEvent value — guard against accidental rename of an event identifier (fail2ban filter alternation must stay in sync)", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);

    const events: SecurityEvent[] = [
      "rate_limit",
      "rate_limit_pdf",
      "rate_limit_store",
      "rate_limit_store_post",
      "rate_limit_order",
      "csrf_fail",
      "origin_block",
      "login_fail",
      "login_lockout",
    ];

    for (const ev of events) {
      logSecurityEvent(ev, { ip: "127.0.0.1" });
    }

    expect(warnSpy).toHaveBeenCalledTimes(events.length);
    for (let i = 0; i < events.length; i++) {
      const [obj] = warnSpy.mock.calls[i];
      expect((obj as { event: string }).event).toBe(events[i]);
    }
  });

  it("the JSON written to stdout in production matches the fail2ban filter regex — pinned against docs/fail2ban/filter.d/hisaabo-api.conf", () => {
    // Pino's logger.warn(obj, msg) serialises to a single-line JSON record
    // whose shape we approximate here by JSON-stringifying what the spy sees,
    // in field order, as pino does. This is the exact byte sequence fail2ban
    // greps for inside the journald MESSAGE field.
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);

    logSecurityEvent("login_fail", { ip: "203.0.113.42", path: "/api/trpc/auth.login", reason: "bad_password" });

    const [obj] = warnSpy.mock.calls[0];
    const serialised = JSON.stringify(obj);

    // This is the exact failregex shipped in docs/fail2ban/filter.d/hisaabo-api.conf,
    // with <HOST> swapped for an IPv4 capture group so we can assert the IP is
    // extracted correctly. If this regex stops matching, the operator's fail2ban
    // jail will silently stop banning offenders.
    const FAILREGEX =
      /"sec":true,"event":"(?:login_fail|login_lockout|csrf_fail|origin_block|rate_limit|rate_limit_pdf|rate_limit_store|rate_limit_store_post|rate_limit_order)","ip":"((?:\d{1,3}\.){3}\d{1,3})"/;

    const match = serialised.match(FAILREGEX);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe("203.0.113.42");
  });
});
