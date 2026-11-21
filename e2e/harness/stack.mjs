/**
 * stack.mjs — the one process Playwright's webServer starts for E2E runs.
 *
 *   1. builds the web app (`vite build`) and the API bundle (`tsup`) once,
 *   2. runs the API from the built bundle (`node dist/server.js`),
 *   3. serves the built web app statically with the same /api proxy as the
 *      Vite dev server (web-server.mjs).
 *
 * Playwright waits for http://<web>/__e2e_ready, which is 200 only after the
 * builds finished and the API answered /health. On SIGTERM/SIGINT (Playwright
 * sends SIGTERM when the run ends or is interrupted) everything started here is
 * stopped. `E2E_DEV=1` bypasses this file entirely (see playwright.config.ts).
 *
 * `tsc -b` is deliberately not part of the web build: typechecking is its own
 * CI job (`typecheck-lint`) that the e2e job already depends on.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { startWebServer } from "./web-server.mjs";

const REPO = path.resolve(import.meta.dirname, "../..");
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5173);
const API_PORT = Number(process.env.E2E_API_PORT ?? 3000);
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;

/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
/** @type {import("node:http").Server[]} */
const servers = [];
let stopping = false;

function log(msg) {
  console.log(`[e2e-stack] ${msg}`);
}

/** Run a command to completion, inheriting stdio. */
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: REPO, stdio: "inherit", ...opts });
    children.push(child);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      children.splice(children.indexOf(child), 1);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with ${code ?? signal}`));
    });
  });
}

async function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const s of servers) {
    s.closeAllConnections?.();
    s.close();
  }
  const exits = children.map(
    (c) => new Promise((resolve) => (c.exitCode !== null || c.signalCode ? resolve() : c.once("exit", resolve))),
  );
  for (const c of children) c.kill("SIGTERM");
  // The API force-exits 5s after SIGTERM itself; don't wait for the full grace period.
  const timer = setTimeout(() => children.forEach((c) => c.kill("SIGKILL")), 3_000);
  await Promise.all(exits);
  clearTimeout(timer);
  process.exit(code);
}
process.on("SIGTERM", () => void stop(0));
process.on("SIGINT", () => void stop(0));

async function main() {
  if (process.env.E2E_SKIP_BUILD !== "1") {
    const t = Date.now();
    await run("pnpm", ["--filter", "@hisaabo/web", "exec", "vite", "build"]);
    await run("pnpm", ["--filter", "@hisaabo/api", "build"]);
    log(`builds finished in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }

  const apiEnv = { ...process.env };
  // DISABLE_RATE_LIMIT is only honoured outside production (server.ts).
  delete apiEnv.NODE_ENV;
  Object.assign(apiEnv, {
    PORT: String(API_PORT),
    CORS_ORIGINS: WEB_ORIGIN,
    DISABLE_RATE_LIMIT: "1",
    LOG_LEVEL: process.env.LOG_LEVEL ?? "warn",
  });
  const api = spawn("node", ["dist/server.js"], {
    cwd: path.join(REPO, "packages/api"),
    env: apiEnv,
    stdio: "inherit",
  });
  children.push(api);
  api.once("exit", (code, signal) => {
    if (!stopping) {
      log(`API exited unexpectedly (${code ?? signal})`);
      void stop(1);
    }
  });

  servers.push(
    await startWebServer({
      root: path.join(REPO, "apps/web/dist"),
      port: WEB_PORT,
      apiPort: API_PORT,
    }),
  );
  log(`web ${WEB_ORIGIN} -> api :${API_PORT}`);
}

main().catch((err) => {
  console.error(`[e2e-stack] ${err.message}`);
  void stop(1);
});
