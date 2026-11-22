import { describe, it, expect, afterEach, vi } from "vitest";
import { validateEnv } from "../lib/env";
import { logger } from "../lib/logger";

const KEYS = ["NODE_ENV", "API_PUBLIC_URL", "APP_URL", "DATABASE_URL", "CORS_ORIGINS", "ENCRYPTION_KEY", "RESEND_API_KEY", "MULTI_TENANT"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

function setProd(apiPublicUrl?: string) {
  process.env.NODE_ENV = "production";
  process.env.DATABASE_URL = "postgres://x";
  process.env.CORS_ORIGINS = "https://app.example.com";
  process.env.ENCRYPTION_KEY = "a".repeat(64);
  process.env.RESEND_API_KEY = "re_test";
  if (apiPublicUrl === undefined) delete process.env.API_PUBLIC_URL;
  else process.env.API_PUBLIC_URL = apiPublicUrl;
}

function warnMessages(warn: { mock: { calls: unknown[][] } }): string[] {
  return warn.mock.calls.map((c) => String(c[c.length - 1]));
}

describe("validateEnv — API_PUBLIC_URL", () => {
  it("is NOT required in production (v0.9.0 env files have no API_PUBLIC_URL)", () => {
    setProd();
    expect(() => validateEnv()).not.toThrow();
  });

  it("logs a loud WARN naming the fallback when unset in production", () => {
    setProd();
    process.env.APP_URL = "https://app.example.com";
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    validateEnv();
    const hit = warnMessages(warn).find((m) => m.includes("API_PUBLIC_URL is not set"));
    expect(hit).toBeDefined();
    expect(hit).toContain("https://app.example.com");
    expect(hit).toContain("APP_URL");
  });

  it("does not warn about the fallback when API_PUBLIC_URL is set", () => {
    setProd("https://api.example.com");
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    validateEnv();
    expect(warnMessages(warn).some((m) => m.includes("API_PUBLIC_URL is not set"))).toBe(false);
  });

  it("must be a valid http(s) URL in production when SET", () => {
    setProd("not a url");
    expect(() => validateEnv()).toThrow(/API_PUBLIC_URL/);
    setProd("ftp://api.example.com");
    expect(() => validateEnv()).toThrow(/API_PUBLIC_URL/);
  });

  it("accepts https and http URLs in production", () => {
    setProd("https://api.example.com");
    expect(() => validateEnv()).not.toThrow();
    setProd("http://10.0.0.5:3000");
    expect(() => validateEnv()).not.toThrow();
  });

  it("is not required outside production", () => {
    setProd();
    process.env.NODE_ENV = "development";
    expect(() => validateEnv()).not.toThrow();
  });
});

describe("validateEnv — ENCRYPTION_KEY format (single-tenant production)", () => {
  it("boots with a malformed key and warns (v0.9.0 only failed at use)", () => {
    setProd("https://api.example.com");
    process.env.ENCRYPTION_KEY = "not-a-64-char-hex-key";
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    expect(() => validateEnv()).not.toThrow();
    expect(warnMessages(warn).some((m) => m.includes("ENCRYPTION_KEY is not exactly 64 hex"))).toBe(true);
  });

  it("boots with a 64-char non-hex key and warns", () => {
    setProd("https://api.example.com");
    process.env.ENCRYPTION_KEY = "z".repeat(64);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    expect(() => validateEnv()).not.toThrow();
    expect(warnMessages(warn).some((m) => m.includes("ENCRYPTION_KEY is not exactly 64 hex"))).toBe(true);
  });

  it("does not warn for a valid key", () => {
    setProd("https://api.example.com");
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    validateEnv();
    expect(warnMessages(warn).some((m) => m.includes("ENCRYPTION_KEY is not exactly 64 hex"))).toBe(false);
  });

  it("stays fatal for a malformed key in multi-tenant production", () => {
    setProd("https://api.example.com");
    process.env.MULTI_TENANT = "true";
    process.env.ENCRYPTION_KEY = "short";
    expect(() => validateEnv()).toThrow(/64 hex/);
  });

  it("still requires ENCRYPTION_KEY (signing secret) in production", () => {
    setProd("https://api.example.com");
    delete process.env.ENCRYPTION_KEY;
    expect(() => validateEnv()).toThrow(/ENCRYPTION_KEY is required/);
  });
});

describe("validateEnv — multi-tenant encryption key", () => {
  it("requires ENCRYPTION_KEY when MULTI_TENANT=true (even outside production)", () => {
    setProd("https://api.example.com");
    process.env.NODE_ENV = "development";
    process.env.MULTI_TENANT = "true";
    delete process.env.ENCRYPTION_KEY;
    expect(() => validateEnv()).toThrow(/ENCRYPTION_KEY is required/);
  });

  it("rejects a malformed ENCRYPTION_KEY when MULTI_TENANT=true", () => {
    setProd("https://api.example.com");
    process.env.NODE_ENV = "development";
    process.env.MULTI_TENANT = "true";
    process.env.ENCRYPTION_KEY = "short";
    expect(() => validateEnv()).toThrow(/64 hex/);
  });

  it("does not require ENCRYPTION_KEY for self-hosted development", () => {
    setProd("https://api.example.com");
    process.env.NODE_ENV = "development";
    process.env.MULTI_TENANT = "false";
    delete process.env.ENCRYPTION_KEY;
    expect(() => validateEnv()).not.toThrow();
  });
});

describe("validateEnv — NIC public key for e-invoicing", () => {
  const IRP_KEYS = ["IRP_PUBLIC_KEY_PEM", "IRP_PUBLIC_KEY_PATH", "IRP_SANDBOX_PUBLIC_KEY_PEM", "IRP_SANDBOX_PUBLIC_KEY_PATH"] as const;
  const savedIrp: Record<string, string | undefined> = {};
  for (const k of IRP_KEYS) savedIrp[k] = process.env[k];
  afterEach(() => {
    for (const k of IRP_KEYS) {
      if (savedIrp[k] === undefined) delete process.env[k];
      else process.env[k] = savedIrp[k];
    }
  });

  it("warns (and still boots) when a key is set but invalid, naming the variable", () => {
    setProd("https://api.example.com");
    process.env.IRP_PUBLIC_KEY_PEM = "not a key";
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    expect(() => validateEnv()).not.toThrow();
    expect(warnMessages(warn).some((m) => /E-invoicing is not configured: the NIC public key is missing or invalid \(IRP_PUBLIC_KEY_PEM is set but is not a valid PEM/.test(m))).toBe(true);
  });

  it("says nothing when no key is set (e-invoicing is optional)", () => {
    setProd("https://api.example.com");
    for (const k of IRP_KEYS) delete process.env[k];
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    validateEnv();
    expect(warnMessages(warn).some((m) => /NIC public key/.test(m))).toBe(false);
  });
});
