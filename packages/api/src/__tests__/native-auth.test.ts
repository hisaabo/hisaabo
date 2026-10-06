import { describe, it, expect, afterEach } from "vitest";
import { createHash } from "node:crypto";
import {
  isValidNativeRedirectUri,
  verifyPkceS256,
  buildNativeRedirectUrl,
  sha256Hex,
  generateNativeCode,
} from "../lib/native-auth";
import { STRICT_PROCEDURES } from "../lib/rate-limit-tier";

const origAppUrl = process.env.APP_URL;
afterEach(() => {
  if (origAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = origAppUrl;
});

describe("isValidNativeRedirectUri", () => {
  it.each(["desktop", "cli"] as const)("%s accepts 127.0.0.1 loopback with a valid port", (client) => {
    expect(isValidNativeRedirectUri(client, "http://127.0.0.1:53124/callback")).toBe(true);
    expect(isValidNativeRedirectUri(client, "http://127.0.0.1:1024/callback")).toBe(true);
    expect(isValidNativeRedirectUri(client, "http://127.0.0.1:65535/callback")).toBe(true);
  });

  it.each(["desktop", "cli"] as const)("%s rejects everything else", (client) => {
    for (const uri of [
      "http://127.0.0.1:80/callback",
      "http://127.0.0.1:1023/callback",
      "http://127.0.0.1:65536/callback",
      "http://127.0.0.1:123456/callback",
      "http://127.0.0.1/callback",
      "http://localhost:53124/callback",
      "http://[::1]:53124/callback",
      "https://127.0.0.1:53124/callback",
      "http://127.0.0.1:53124/callback/",
      "http://127.0.0.1:53124/other",
      "http://127.0.0.1:53124/callback?x=1",
      "http://127.0.0.1:53124/callback#frag",
      "http://127.0.0.1:53124@evil.example/callback",
      "http://evil.example/callback",
      "hisaabo://native-callback",
      "",
    ]) {
      expect(isValidNativeRedirectUri(client, uri), uri).toBe(false);
    }
  });

  it("mobile must equal APP_URL + /auth/native/callback exactly", () => {
    process.env.APP_URL = "https://app.hisaabo.in";
    expect(isValidNativeRedirectUri("mobile", "https://app.hisaabo.in/auth/native/callback")).toBe(true);
    expect(isValidNativeRedirectUri("mobile", "https://app.hisaabo.in/auth/native/callback/")).toBe(false);
    expect(isValidNativeRedirectUri("mobile", "https://app.hisaabo.in/auth/native/callback?x=1")).toBe(false);
    expect(isValidNativeRedirectUri("mobile", "https://evil.example/auth/native/callback")).toBe(false);
    expect(isValidNativeRedirectUri("mobile", "http://app.hisaabo.in/auth/native/callback")).toBe(false);
    expect(isValidNativeRedirectUri("mobile", "hisaabo://auth/native/callback")).toBe(false);
    expect(isValidNativeRedirectUri("mobile", "http://127.0.0.1:53124/callback")).toBe(false);
  });

  it("mobile tolerates a trailing slash on APP_URL but loopback is not valid for it", () => {
    process.env.APP_URL = "https://app.hisaabo.in/";
    expect(isValidNativeRedirectUri("mobile", "https://app.hisaabo.in/auth/native/callback")).toBe(true);
  });
});

describe("PKCE S256", () => {
  const verifier = "a".repeat(43);
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  it("accepts the matching verifier", () => {
    expect(challenge).toHaveLength(43);
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
  });

  it("rejects a different verifier", () => {
    expect(verifyPkceS256("b".repeat(43), challenge)).toBe(false);
  });

  it("does not accept the challenge itself as the verifier (plain method)", () => {
    expect(verifyPkceS256(challenge, challenge)).toBe(false);
  });
});

describe("native auth helpers", () => {
  it("generates 43-char base64url codes that are unique", () => {
    const a = generateNativeCode();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateNativeCode()).not.toBe(a);
  });

  it("builds the redirect URL with code and state", () => {
    expect(buildNativeRedirectUrl("http://127.0.0.1:5000/callback", "abc", "st_ate-123456789012")).toBe(
      "http://127.0.0.1:5000/callback?code=abc&state=st_ate-123456789012",
    );
  });

  it("hashes with sha256 hex", () => {
    expect(sha256Hex("x")).toBe(createHash("sha256").update("x").digest("hex"));
  });

  it("nativeStart and nativeExchange are strict-rate-limited", () => {
    expect(STRICT_PROCEDURES.has("auth.nativeStart")).toBe(true);
    expect(STRICT_PROCEDURES.has("auth.nativeExchange")).toBe(true);
  });
});
