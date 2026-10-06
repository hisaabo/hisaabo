// Run with: node --experimental-strip-types --test packages/cli/test/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { get } from "node:http";
import {
  browserCommand,
  buildAuthorizeUrl,
  generatePkce,
  generateState,
  parseCallback,
  resolveWebUrl,
  startCallbackServer,
} from "../src/native-login.ts";

function request(port: number, path: string, host = `127.0.0.1:${port}`): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    get({ host: "127.0.0.1", port, path, headers: { host } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    }).on("error", reject);
  });
}

test("PKCE verifier is 43-128 url-safe chars and challenge is S256", () => {
  const { verifier, challenge } = generatePkce();
  assert.match(verifier, /^[A-Za-z0-9\-._~]{43,128}$/);
  assert.equal(challenge, createHash("sha256").update(verifier).digest("base64url"));
  assert.equal(challenge.length, 43);
  assert.notEqual(generatePkce().verifier, verifier);
});

test("state matches the server's required shape", () => {
  assert.match(generateState(), /^[A-Za-z0-9_-]{16,128}$/);
});

test("parseCallback accepts only a matching GET /callback on the loopback host", () => {
  const ok = parseCallback("GET", "/callback?code=abc&state=s1", "127.0.0.1:4000", 4000, "s1");
  assert.deepEqual(ok, { code: "abc", state: "s1" });
  assert.equal(parseCallback("GET", "/callback?code=abc&state=bad", "127.0.0.1:4000", 4000, "s1"), null);
  assert.equal(parseCallback("GET", "/callback?state=s1", "127.0.0.1:4000", 4000, "s1"), null);
  assert.equal(parseCallback("GET", "/favicon.ico", "127.0.0.1:4000", 4000, "s1"), null);
  assert.equal(parseCallback("POST", "/callback?code=a&state=s1", "127.0.0.1:4000", 4000, "s1"), null);
  assert.equal(parseCallback("GET", "/callback?code=a&state=s1", "evil.example:4000", 4000, "s1"), null);
});

test("resolveWebUrl: flag, env, hosted default, otherwise null", () => {
  assert.equal(resolveWebUrl("https://api.hisaabo.in", undefined, {}), "https://app.hisaabo.in");
  assert.equal(resolveWebUrl("https://api.hisaabo.in/", "https://x.test/", {}), "https://x.test");
  assert.equal(resolveWebUrl("https://my.host", undefined, { HISAABO_WEB_URL: "https://web.my.host" }), "https://web.my.host");
  assert.equal(resolveWebUrl("https://my.host", undefined, {}), null);
  assert.equal(resolveWebUrl("https://my.host", "javascript:alert(1)", {}), null);
});

test("browserCommand keeps the URL as one argv entry and rejects non-http", () => {
  const url = buildAuthorizeUrl("https://app.hisaabo.in/", "id&calc");
  assert.equal(url, "https://app.hisaabo.in/auth/native?request=id%26calc");
  assert.deepEqual(browserCommand(url, "darwin"), { cmd: "open", args: [url] });
  assert.deepEqual(browserCommand(url, "linux"), { cmd: "xdg-open", args: [url] });
  assert.deepEqual(browserCommand(url, "win32"), { cmd: "rundll32", args: ["url.dll,FileProtocolHandler", url] });
  assert.throws(() => browserCommand("file:///etc/passwd", "linux"));
});

test("callback server ignores junk and resolves once on the valid callback", async () => {
  const listener = await startCallbackServer("state-state-state-1", 10_000);
  const fav = await request(listener.port, "/favicon.ico");
  assert.equal(fav.status, 404);
  const wrongState = await request(listener.port, "/callback?code=x&state=nope");
  assert.equal(wrongState.status, 404);
  const rebind = await request(listener.port, "/callback?code=x&state=state-state-state-1", "evil.test");
  assert.equal(rebind.status, 404);
  const ok = await request(listener.port, "/callback?code=the-code&state=state-state-state-1");
  assert.equal(ok.status, 200);
  assert.match(ok.body, /Signed in/);
  assert.deepEqual(await listener.result, { code: "the-code", state: "state-state-state-1" });
  await assert.rejects(request(listener.port, "/callback?code=x&state=state-state-state-1"));
});

test("callback server times out", async () => {
  const listener = await startCallbackServer("state-state-state-1", 50);
  await assert.rejects(listener.result, /Timed out/);
});
