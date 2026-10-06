import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";

export const HOSTED_API_URL = "https://api.hisaabo.in";
export const HOSTED_WEB_URL = "https://app.hisaabo.in";
export const CALLBACK_TIMEOUT_MS = 5 * 60_000;

const CALLBACK_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Hisaabo CLI</title></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:4rem 1rem">
<h1>Signed in</h1><p>You can close this tab and return to your terminal.</p></body></html>`;

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** RFC 7636 S256 verifier (43 chars) and its challenge. */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function generateState(): string {
  return base64url(randomBytes(24));
}

export function redirectUriFor(port: number): string {
  return `http://127.0.0.1:${port}/callback`;
}

export function buildAuthorizeUrl(webUrl: string, requestId: string): string {
  const base = webUrl.replace(/\/+$/, "");
  return `${base}/auth/native?request=${encodeURIComponent(requestId)}`;
}

/** Normalise a web URL to origin[/path]; returns null when invalid or not http(s). */
export function normalizeWebUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) return null;
  return u.origin + u.pathname.replace(/\/+$/, "");
}

/** --web-url, then HISAABO_WEB_URL, then the hosted default for the hosted API; otherwise null. */
export function resolveWebUrl(
  apiUrl: string,
  flag: string | undefined,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const explicit = flag || env["HISAABO_WEB_URL"];
  if (explicit) return normalizeWebUrl(explicit);
  if (apiUrl.replace(/\/+$/, "") === HOSTED_API_URL) return HOSTED_WEB_URL;
  return null;
}

/** Platform command that opens a URL in the default browser. The URL is always a separate argv entry. */
export function browserCommand(url: string, platform: NodeJS.Platform = process.platform): { cmd: string; args: string[] } {
  if (!/^https?:\/\//i.test(url)) throw new Error("Refusing to open a non-http(s) URL");
  if (platform === "darwin") return { cmd: "open", args: [url] };
  if (platform === "win32") return { cmd: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  return { cmd: "xdg-open", args: [url] };
}

/** Resolves true when the launcher started, false when it could not be spawned. */
export function openBrowser(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let spec: { cmd: string; args: string[] };
    try {
      spec = browserCommand(url);
    } catch {
      resolve(false);
      return;
    }
    try {
      const child = spawn(spec.cmd, spec.args, { stdio: "ignore", detached: true });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

export interface CallbackResult {
  code: string;
  state: string;
}

/**
 * Returns the code/state of a well-formed callback request, or null.
 * Rejects wrong paths, methods, hosts (DNS rebinding) and a mismatched state.
 */
export function parseCallback(
  method: string | undefined,
  rawUrl: string | undefined,
  host: string | undefined,
  port: number,
  expectedState: string,
): CallbackResult | null {
  if (method !== "GET" || !rawUrl) return null;
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return null;
  let u: URL;
  try {
    u = new URL(rawUrl, `http://127.0.0.1:${port}`);
  } catch {
    return null;
  }
  if (u.pathname !== "/callback") return null;
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  if (!code || !state || code.length > 512 || state !== expectedState) return null;
  return { code, state };
}

export interface CallbackListener {
  port: number;
  result: Promise<CallbackResult>;
  close: () => void;
}

/** Binds 127.0.0.1:0 and accepts exactly one valid GET /callback, or rejects on timeout. */
export function startCallbackServer(expectedState: string, timeoutMs = CALLBACK_TIMEOUT_MS): Promise<CallbackListener> {
  return new Promise((resolveStart, rejectStart) => {
    let settle: { resolve: (r: CallbackResult) => void; reject: (e: Error) => void };
    const result = new Promise<CallbackResult>((resolve, reject) => {
      settle = { resolve, reject };
    });
    result.catch(() => {});

    let done = false;
    let timer: NodeJS.Timeout | undefined;
    let port = 0;

    const server: Server = createServer((req, res) => {
      if (done) {
        res.writeHead(404).end();
        return;
      }
      const parsed = parseCallback(req.method, req.url, req.headers.host, port, expectedState);
      if (!parsed) {
        res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
        return;
      }
      done = true;
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        Connection: "close",
      });
      res.end(CALLBACK_PAGE, () => {
        close();
        settle.resolve(parsed);
      });
    });

    function close() {
      if (timer) clearTimeout(timer);
      server.close();
      server.closeAllConnections();
    }

    server.once("error", rejectStart);
    server.listen(0, "127.0.0.1", () => {
      port = (server.address() as { port: number }).port;
      timer = setTimeout(() => {
        if (done) return;
        done = true;
        close();
        settle.reject(new Error("Timed out waiting for browser sign-in"));
      }, timeoutMs);
      timer.unref();
      resolveStart({ port, result, close: () => { done = true; close(); } });
    });
  });
}
