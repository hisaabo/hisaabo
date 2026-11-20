import { describe, it, expect, afterEach } from "vitest";
import {
  resolveApiPublicUrl,
  getApiPublicUrl,
  describeApiPublicUrlFallback,
  isValidHttpUrl,
} from "../lib/public-url";

const KEYS = ["API_PUBLIC_URL", "APP_URL", "CORS_ORIGINS", "PORT", "NODE_ENV"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function setEnv(env: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
}

describe("resolveApiPublicUrl", () => {
  it("prefers a valid API_PUBLIC_URL over everything else and strips trailing slashes", () => {
    setEnv({ API_PUBLIC_URL: "https://api.example.com/", APP_URL: "https://app.example.com", CORS_ORIGINS: "https://x.example.com" });
    expect(resolveApiPublicUrl({ requestOrigin: "https://req.example.com", trustRequestOrigin: true })).toEqual({
      url: "https://api.example.com",
      source: "API_PUBLIC_URL",
    });
  });

  it("falls back to the request origin only when the caller trusts it", () => {
    setEnv({ APP_URL: "https://app.example.com" });
    expect(resolveApiPublicUrl({ requestOrigin: "https://api.example.com", trustRequestOrigin: true })).toEqual({
      url: "https://api.example.com",
      source: "request",
    });
    // Untrusted (public/cacheable route): the request origin is ignored.
    expect(resolveApiPublicUrl({ requestOrigin: "https://evil.example", trustRequestOrigin: false })).toEqual({
      url: "https://app.example.com",
      source: "APP_URL",
    });
    expect(resolveApiPublicUrl({ requestOrigin: "https://evil.example" }).url).toBe("https://app.example.com");
  });

  it("falls back to APP_URL, then the first valid CORS_ORIGINS entry", () => {
    setEnv({ APP_URL: "https://app.example.com/", CORS_ORIGINS: "https://a.example.com,https://b.example.com" });
    expect(resolveApiPublicUrl()).toEqual({ url: "https://app.example.com", source: "APP_URL" });

    setEnv({ CORS_ORIGINS: " not-a-url , https://b.example.com/ ,https://c.example.com" });
    expect(resolveApiPublicUrl()).toEqual({ url: "https://b.example.com", source: "CORS_ORIGINS" });
  });

  it("ignores an invalid API_PUBLIC_URL (validateEnv is what rejects it in production)", () => {
    setEnv({ API_PUBLIC_URL: "not a url", APP_URL: "https://app.example.com" });
    expect(resolveApiPublicUrl().source).toBe("APP_URL");
    setEnv({ API_PUBLIC_URL: "ftp://api.example.com", APP_URL: "https://app.example.com" });
    expect(resolveApiPublicUrl().source).toBe("APP_URL");
  });

  it("uses localhost:<PORT> as the last resort", () => {
    setEnv({ PORT: "8080" });
    expect(resolveApiPublicUrl()).toEqual({ url: "http://localhost:8080", source: "localhost" });
    setEnv({});
    expect(resolveApiPublicUrl().url).toBe("http://localhost:3000");
  });
});

describe("getApiPublicUrl", () => {
  it("returns just the URL string", () => {
    setEnv({ APP_URL: "https://app.example.com" });
    expect(getApiPublicUrl()).toBe("https://app.example.com");
  });
});

describe("describeApiPublicUrlFallback", () => {
  it("returns null when API_PUBLIC_URL is set", () => {
    setEnv({ API_PUBLIC_URL: "https://api.example.com" });
    expect(describeApiPublicUrlFallback()).toBeNull();
  });

  it("names the source of the fallback when it is unset", () => {
    setEnv({ APP_URL: "https://app.example.com" });
    const msg = describeApiPublicUrlFallback();
    expect(msg).toContain("API_PUBLIC_URL is not set");
    expect(msg).toContain("https://app.example.com (from APP_URL)");
  });

  it("calls out a localhost fallback", () => {
    setEnv({});
    expect(describeApiPublicUrlFallback()).toContain("localhost");
  });
});

describe("isValidHttpUrl", () => {
  it("accepts http(s) and rejects everything else", () => {
    expect(isValidHttpUrl("https://a.example.com")).toBe(true);
    expect(isValidHttpUrl("http://10.0.0.5:3000")).toBe(true);
    expect(isValidHttpUrl("ftp://a.example.com")).toBe(false);
    expect(isValidHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isValidHttpUrl("nope")).toBe(false);
  });
});
