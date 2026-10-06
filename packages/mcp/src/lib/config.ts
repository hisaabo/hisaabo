/**
 * Startup validation of the API URL and credential.
 * Pure functions (throw Error) so they can be unit tested; index.ts turns a
 * thrown error into a stderr message and exit(1).
 */

const API_KEY_PREFIX = "hisaabo_key_";

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "::1" || /^127(?:\.\d{1,3}){3}$/.test(h);
}

export function validateApiUrl(raw: string, env: NodeJS.ProcessEnv = process.env): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("HISAABO_API_URL is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("HISAABO_API_URL must use http: or https: protocol.");
  }
  if (url.username || url.password) {
    throw new Error("HISAABO_API_URL must not contain credentials (user:password@). Use HISAABO_API_KEY.");
  }
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname) && env.HISAABO_ALLOW_INSECURE !== "1") {
    throw new Error(
      "HISAABO_API_URL uses plain http:// to a non-loopback host, which would send your API key unencrypted. " +
      "Use https://, or set HISAABO_ALLOW_INSECURE=1 to override.",
    );
  }
  return url.origin;
}

export function validateToken(token: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!token.startsWith(API_KEY_PREFIX) && env.HISAABO_ALLOW_SESSION_TOKEN !== "1") {
    throw new Error(
      `HISAABO_API_KEY does not look like an API key (expected "${API_KEY_PREFIX}..."). ` +
      "Create a dedicated, least-privilege API key, or set HISAABO_ALLOW_SESSION_TOKEN=1 to use a login session token.",
    );
  }
  return token;
}
