/** PKCE (RFC 7636) helpers built on WebCrypto. */

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomBase64Url(byteLength: number): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** 32 random bytes -> 43-character verifier (the RFC's recommended size). */
export function generateCodeVerifier(): string {
  return randomBase64Url(32);
}

/** 24 random bytes -> 32-character opaque state value. */
export function generateState(): string {
  return randomBase64Url(24);
}

/** `S256` challenge: base64url(sha256(ascii(verifier))). */
export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}
