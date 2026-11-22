// Run: node --experimental-strip-types --test scripts/wait-for-api-version.test.ts
//
// Exercises scripts/wait-for-api-version.sh (the release.yml `wait-for-api`
// gate) against a local HTTP server that plays the production API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

const SCRIPT = new URL("./wait-for-api-version.sh", import.meta.url).pathname;

type Reply = { status: number; body: string };

async function withApi<T>(replies: Reply[], fn: (baseUrl: string, hits: () => number) => Promise<T>): Promise<T> {
  let n = 0;
  const server: Server = createServer((req, res) => {
    const reply = replies[Math.min(n, replies.length - 1)]!;
    n += 1;
    assert.equal(req.url, "/api/version");
    res.writeHead(reply.status, { "content-type": "application/json" });
    res.end(reply.body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`, () => n);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

async function run(env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "wait-for-api-"));
  const out = join(dir, "output");
  const summary = join(dir, "summary");
  try {
    return await new Promise<{ code: number | null; log: string; outputs: Record<string, string>; summary: string }>(
      (resolve, reject) => {
        const child = spawn("bash", [SCRIPT], {
          env: {
            PATH: process.env.PATH ?? "",
            INITIAL_INTERVAL_SECONDS: "1",
            MAX_INTERVAL_SECONDS: "1",
            GITHUB_OUTPUT: out,
            GITHUB_STEP_SUMMARY: summary,
            ...env,
          },
        });
        let log = "";
        child.stdout.on("data", (d) => (log += d));
        child.stderr.on("data", (d) => (log += d));
        child.on("error", reject);
        child.on("close", (code) => {
          const read = (f: string) => {
            try {
              return readFileSync(f, "utf8");
            } catch {
              return "";
            }
          };
          const outputs = Object.fromEntries(
            read(out)
              .split("\n")
              .filter(Boolean)
              .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
          );
          resolve({ code, log, outputs, summary: read(summary) });
        });
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("passes at once when production already reports the tagged version (the v prefix is stripped)", async () => {
  await withApi([{ status: 200, body: '{"version":"0.10.1"}' }], async (url, hits) => {
    const r = await run({ API_URL: url, EXPECTED_VERSION: "v0.10.1", TIMEOUT_SECONDS: "20" });
    assert.equal(r.code, 0, r.log);
    assert.match(r.log, /production reports 0\.10\.1, expected 0\.10\.1: MATCH/);
    assert.equal(r.outputs.result, "ready");
    assert.equal(r.outputs.observed_version, "0.10.1");
    assert.equal(hits(), 1);
  });
});

test("keeps polling through 404 (pre-endpoint API), 5xx and an older version, then passes", async () => {
  const replies: Reply[] = [
    { status: 404, body: '{"error":"Not found"}' },
    { status: 502, body: "bad gateway" },
    { status: 200, body: '{"version":"0.10.0"}' },
    { status: 200, body: '{"version":"0.10.1"}' },
  ];
  await withApi(replies, async (url, hits) => {
    const r = await run({ API_URL: url, EXPECTED_VERSION: "0.10.1", TIMEOUT_SECONDS: "30" });
    assert.equal(r.code, 0, r.log);
    assert.match(r.log, /HTTP 404: the running API predates/);
    assert.match(r.log, /HTTP 502/);
    assert.match(r.log, /production reports 0\.10\.0, expected 0\.10\.1; next check in/);
    assert.equal(r.outputs.result, "ready");
    assert.equal(hits(), 4);
  });
});

test("times out (exit 1) when production never reaches the version", async () => {
  await withApi([{ status: 200, body: '{"version":"0.10.0"}' }], async (url) => {
    const r = await run({ API_URL: url, EXPECTED_VERSION: "v0.10.1", TIMEOUT_SECONDS: "3" });
    assert.equal(r.code, 1, r.log);
    assert.match(r.log, /::error title=Timed out waiting for the production API::/);
    assert.match(r.log, /last: 0\.10\.0/);
    assert.equal(r.outputs.result, "timeout");
    assert.equal(r.outputs.observed_version, "0.10.0");
  });
});

test("times out when the API is unreachable", async () => {
  // Port 1 on loopback refuses the connection immediately.
  const r = await run({ API_URL: "http://127.0.0.1:1", EXPECTED_VERSION: "v0.10.1", TIMEOUT_SECONDS: "2" });
  assert.equal(r.code, 1, r.log);
  assert.match(r.log, /API not reachable \(curl exit/);
  assert.equal(r.outputs.result, "timeout");
});

test("warns when production is already newer than the tag", async () => {
  await withApi([{ status: 200, body: '{"version":"0.11.0"}' }], async (url) => {
    const r = await run({ API_URL: url, EXPECTED_VERSION: "v0.10.1", TIMEOUT_SECONDS: "2" });
    assert.equal(r.code, 1, r.log);
    assert.match(r.log, /production is NEWER than this release/);
  });
});

test("never echoes an untrusted version string (no workflow-command injection)", async () => {
  await withApi([{ status: 200, body: JSON.stringify({ version: "::error::pwned" }) }], async (url) => {
    const r = await run({ API_URL: url, EXPECTED_VERSION: "v0.10.1", TIMEOUT_SECONDS: "2" });
    assert.equal(r.code, 1, r.log);
    assert.doesNotMatch(r.log, /pwned/);
    assert.match(r.log, /without a usable "version" field/);
  });
});

test("skip_api_wait bypasses the check loudly and never calls the API", async () => {
  await withApi([{ status: 200, body: '{"version":"0.0.1"}' }], async (url, hits) => {
    const r = await run({ API_URL: url, EXPECTED_VERSION: "v0.10.1", SKIP_API_WAIT: "true" });
    assert.equal(r.code, 0, r.log);
    assert.match(r.log, /::warning title=API wait SKIPPED::/);
    assert.match(r.log, /API WAIT BYPASSED/);
    assert.equal(r.outputs.result, "skipped");
    assert.match(r.summary, /API wait bypassed/);
    assert.equal(hits(), 0);
  });
});

test("caps an over-long timeout at the GitHub job limit and says so", async () => {
  await withApi([{ status: 200, body: '{"version":"0.10.1"}' }], async (url) => {
    const r = await run({ API_URL: url, EXPECTED_VERSION: "v0.10.1", TIMEOUT_MINUTES: "999" });
    assert.equal(r.code, 0, r.log);
    assert.match(r.log, /exceeds the 350-minute cap/);
    assert.match(r.log, /deadline : 350 min/);
  });
});

test("rejects missing or malformed configuration (exit 2)", async () => {
  const missing = await run({ API_URL: "http://127.0.0.1:1" });
  assert.equal(missing.code, 2, missing.log);
  const bad = await run({ API_URL: "http://127.0.0.1:1", EXPECTED_VERSION: "v0.10.1", TIMEOUT_MINUTES: "soon" });
  assert.equal(bad.code, 2, bad.log);
});

// ── MODE=check: the one-shot decision at the start of every production deploy ──

const check = (api: string, expected: string, extra: Record<string, string> = {}) =>
  run({ MODE: "check", API_URL: api, EXPECTED_VERSION: expected, OVERRIDE_NAME: "allow_api_mismatch", ...extra });

test("check: passes with one request when production reports exactly the tagged version", async () => {
  await withApi([{ status: 200, body: '{"version":"0.10.1"}' }], async (url, hits) => {
    const r = await check(url, "v0.10.1");
    assert.equal(r.code, 0, r.log);
    assert.match(r.log, /production reports 0\.10\.1, deploying 0\.10\.1: MATCH/);
    assert.equal(r.outputs.result, "ready");
    assert.equal(hits(), 1);
  });
});

test("check: refuses when production is OLDER (the frontend would run ahead of its API), without waiting", async () => {
  await withApi([{ status: 200, body: '{"version":"0.10.0"}' }], async (url, hits) => {
    const r = await check(url, "v0.10.1");
    assert.equal(r.code, 1, r.log);
    assert.match(r.log, /::error title=Production API is older than this release::/);
    assert.match(r.log, /set allow_api_mismatch to deploy anyway/);
    assert.equal(r.outputs.result, "older");
    assert.equal(hits(), 1);
  });
});

test("check: refuses when production is NEWER (an older tag would downgrade the frontend)", async () => {
  await withApi([{ status: 200, body: '{"version":"0.10.2"}' }], async (url) => {
    const r = await check(url, "v0.10.1");
    assert.equal(r.code, 1, r.log);
    assert.match(r.log, /::error title=Production API is newer than this release::/);
    assert.match(r.log, /stale approval|rollback/);
    assert.equal(r.outputs.result, "newer");
  });
});

test("check: orders versions numerically and ranks a pre-release below its release", async () => {
  // 0.10.10 is newer than 0.10.9 (not a string comparison) ...
  await withApi([{ status: 200, body: '{"version":"0.10.10"}' }], async (url) => {
    assert.equal((await check(url, "v0.10.9")).outputs.result, "newer");
  });
  // ... and production on a release candidate is older than the final it is deploying.
  await withApi([{ status: 200, body: '{"version":"0.10.1-rc.1"}' }], async (url) => {
    assert.equal((await check(url, "v0.10.1")).outputs.result, "older");
  });
  await withApi([{ status: 200, body: '{"version":"0.10.1"}' }], async (url) => {
    assert.equal((await check(url, "v0.10.1-rc.1")).outputs.result, "newer");
  });
});

test("check: retries a network blip, then decides", async () => {
  await withApi(
    [
      { status: 502, body: "bad gateway" },
      { status: 200, body: '{"version":"0.10.1"}' },
    ],
    async (url, hits) => {
      const r = await check(url, "v0.10.1", { CHECK_RETRY_SECONDS: "1" });
      assert.equal(r.code, 0, r.log);
      assert.match(r.log, /#1: HTTP 502/);
      assert.equal(hits(), 2);
    },
  );
});

test("check: fails closed when the version cannot be read (404, unreachable)", async () => {
  await withApi([{ status: 404, body: '{"error":"Not found"}' }], async (url, hits) => {
    const r = await check(url, "v0.10.1", { CHECK_ATTEMPTS: "2", CHECK_RETRY_SECONDS: "1" });
    assert.equal(r.code, 1, r.log);
    assert.match(r.log, /::error title=Cannot verify the production API::/);
    assert.equal(r.outputs.result, "unknown");
    assert.equal(hits(), 2);
  });
  const down = await check("http://127.0.0.1:1", "v0.10.1", { CHECK_ATTEMPTS: "1" });
  assert.equal(down.code, 1, down.log);
  assert.equal(down.outputs.result, "unknown");
});

test("check: the override bypasses it loudly under the caller's input name, without calling the API", async () => {
  await withApi([{ status: 200, body: '{"version":"0.10.2"}' }], async (url, hits) => {
    const r = await check(url, "v0.10.1", { SKIP_API_WAIT: "true" });
    assert.equal(r.code, 0, r.log);
    assert.match(r.log, /::warning title=API check SKIPPED::allow_api_mismatch=true/);
    assert.match(r.log, /API CHECK BYPASSED \(allow_api_mismatch=true\)/);
    assert.equal(r.outputs.result, "skipped");
    assert.equal(hits(), 0);
  });
});

test("rejects an unknown MODE (exit 2)", async () => {
  const r = await run({ MODE: "poll", API_URL: "http://127.0.0.1:1", EXPECTED_VERSION: "v0.10.1" });
  assert.equal(r.code, 2, r.log);
});
