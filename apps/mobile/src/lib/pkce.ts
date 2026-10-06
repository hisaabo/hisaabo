import { getRandomBytes as nativeRandomBytes } from "expo-crypto";
import { sha256Hex } from "./sha256";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function base64UrlEncode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2] + B64[((b0 & 3) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += B64[((b1 & 15) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += B64[b2 & 63];
  }
  return out;
}

/** CSPRNG bytes from the OS (expo-crypto). PKCE secrets must be unguessable. */
export function getRandomBytes(length: number): Uint8Array {
  return nativeRandomBytes(length);
}

/** 32 random bytes -> 43-char base64url verifier (RFC 7636 section 4.1). */
export function generateCodeVerifier(): string {
  return base64UrlEncode(getRandomBytes(32));
}

/** 24 random bytes -> 32-char base64url state. */
export function generateState(): string {
  return base64UrlEncode(getRandomBytes(24));
}

/** S256 challenge: base64url(sha256(ascii(verifier))) -> 43 chars. */
export function codeChallengeS256(verifier: string): string {
  const hex = sha256Hex(verifier);
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return base64UrlEncode(bytes);
}
