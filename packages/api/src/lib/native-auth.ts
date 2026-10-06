import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const NATIVE_REQUEST_TTL_MS = 10 * 60 * 1000;
export const NATIVE_CODE_TTL_MS = 2 * 60 * 1000;

export type NativeAuthClient = "desktop" | "mobile" | "cli";

const LOOPBACK_REDIRECT = /^http:\/\/127\.0\.0\.1:(\d{4,5})\/callback$/;

function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:5173").replace(/\/+$/, "");
}

/** Desktop and CLI use an RFC 8252 loopback redirect; mobile uses the verified https app link. */
export function isValidNativeRedirectUri(client: NativeAuthClient, redirectUri: string): boolean {
  if (client === "mobile") return redirectUri === `${appUrl()}/auth/native/callback`;
  const match = LOOPBACK_REDIRECT.exec(redirectUri);
  if (!match) return false;
  const port = Number(match[1]);
  return port >= 1024 && port <= 65535;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function generateNativeCode(): string {
  return randomBytes(32).toString("base64url");
}

export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  const computed = Buffer.from(createHash("sha256").update(codeVerifier).digest("base64url"));
  const expected = Buffer.from(codeChallenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

export function buildNativeRedirectUrl(redirectUri: string, code: string, state: string): string {
  return `${redirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
}
