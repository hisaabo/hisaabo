import { fatalError, EXIT } from "./output.js";

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h === "::1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * Validate and normalise the API base URL to `origin[/path-prefix]` with no
 * trailing slash. Refuses plain http except for loopback (or
 * HISAABO_ALLOW_INSECURE=1) and rejects embedded credentials.
 */
export function validateApiUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fatalError("Invalid API URL", EXIT.USAGE);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    fatalError("API URL must use https://", EXIT.USAGE);
  }
  if (parsed.username || parsed.password) {
    fatalError("API URL must not contain credentials", EXIT.USAGE);
  }
  if (parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname) && process.env["HISAABO_ALLOW_INSECURE"] !== "1") {
    fatalError(
      "Refusing to send credentials over plain http://. Use https://, or set HISAABO_ALLOW_INSECURE=1 to override.",
      EXIT.USAGE,
    );
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, "");
}

/**
 * Resolve a server-returned (possibly relative) URL against apiUrl and ensure
 * it stays on the same origin, so bearer tokens are never sent elsewhere.
 */
export function resolveSameOriginUrl(raw: string, apiUrl: string): string {
  const base = new URL(apiUrl);
  let target: URL;
  try {
    // Keep any path prefix of apiUrl for relative paths.
    target = raw.startsWith("/") && !raw.startsWith("//")
      ? new URL(base.pathname.replace(/\/+$/, "") + raw, base.origin)
      : new URL(raw, base);
  } catch {
    return fatalError("Server returned an invalid URL", EXIT.GENERAL);
  }
  if (target.origin !== base.origin) {
    fatalError("Server returned a URL on a different origin; refusing to send credentials", EXIT.GENERAL);
  }
  return target.toString();
}
