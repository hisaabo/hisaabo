import { describe, it, expect, afterEach, vi } from "vitest";
import { validateEnv } from "../lib/env";

const KEYS = ["NODE_ENV", "API_PUBLIC_URL", "DATABASE_URL", "CORS_ORIGINS", "ENCRYPTION_KEY", "RESEND_API_KEY", "MULTI_TENANT"] as const;
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

describe("validateEnv — API_PUBLIC_URL", () => {
  it("is required in production", () => {
    setProd();
    expect(() => validateEnv()).toThrow(/API_PUBLIC_URL/);
  });

  it("must be a valid http(s) URL in production", () => {
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
