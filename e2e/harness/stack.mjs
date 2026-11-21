/**
 * stack.mjs — the one process Playwright's webServer starts for E2E runs.
 *
 *   1. builds the web app (`vite build`) and the API bundle (`tsup`) once,
 *   2. clones DATABASE_URL's database into one database per Playwright worker
 *      (`CREATE DATABASE <name>_w<k> TEMPLATE <name>`; run `pnpm db:push`
 *      against DATABASE_URL first, as CI does),
 *   3. runs one API per worker from the built bundle (`node dist/server.js`),
 *   4. serves the built web app once per worker, statically, with the same /api
 *      proxy as the Vite dev server (web-server.mjs) pointed at that worker's API.
 *
 * Every worker therefore owns its data and spec files cannot interfere with each
 * other (invitations, deletes, plan limits, ...). The topology (ports, database
 * names) is in topology.cjs.
 *
 * Playwright waits for http://<web 0>/__e2e_ready, which is 200 only after the
 * builds finished and every API answered /health. On SIGTERM/SIGINT (Playwright
 * sends SIGTERM when the run ends or is interrupted) everything started here is
 * stopped and the per-worker databases are dropped (E2E_KEEP_DB=1 keeps them);
 * the same happens if the Playwright runner disappears without saying so (see
 * E2E_RUNNER_PID below). harness/teardown.ts drops them again as a safety net
 * for the case where this process itself was killed outright. `E2E_DEV=1` bypasses
 * this file entirely (see playwright.config.ts).
 *
 * `tsc -b` is deliberately not part of the web build: typechecking is its own
 * CI job (`typecheck-lint`) that the e2e job already depends on.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { startWebServer } from "./web-server.mjs";
import topology from "./topology.cjs";

const {
  REPO,
  adminDatabaseUrl,
  apiOrigin,
  baseDatabaseName,
  quoteIdent,
  resolveWorkers,
  webOrigin,
  workerDatabaseName,
  workerDatabaseUrl,
  workerPorts,
} = topology;

const WORKERS = resolveWorkers();
const KEEP_DB = process.env.E2E_KEEP_DB === "1";

/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
/** @type {import("node:http").Server[]} */
const servers = [];
let stopping = false;
let databasesCreated = false;
let allReady = false;

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

async function withAdminSql(fn) {
  const sql = postgres(adminDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function dropDatabases() {
  await withAdminSql(async (sql) => {
    for (let k = 0; k < WORKERS; k++) {
      await sql.unsafe(`DROP DATABASE IF EXISTS ${quoteIdent(workerDatabaseName(k))} WITH (FORCE)`);
    }
  });
}

async function createDatabases() {
  const template = baseDatabaseName();
  await withAdminSql(async (sql) => {
    for (let k = 0; k < WORKERS; k++) {
      const name = workerDatabaseName(k);
      // A previous run that was killed hard may have left it behind.
      await sql.unsafe(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
      for (let attempt = 1; ; attempt++) {
        try {
          databasesCreated = true;
          await sql.unsafe(`CREATE DATABASE ${quoteIdent(name)} TEMPLATE ${quoteIdent(template)}`);
          break;
        } catch (err) {
          // 55006: the template has a connection open (e.g. Drizzle Studio, a stray API) — it may be about to close.
          if (err.code === "55006" && attempt < 10) {
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          if (err.code === "3D000") {
            throw new Error(`Template database "${template}" does not exist: run \`pnpm db:push\` against DATABASE_URL first`);
          }
          throw err;
        }
      }
    }
  });
  log(`cloned "${template}" into ${WORKERS} worker database(s)`);
}

async function waitForHealthy(origin, deadline) {
  for (;;) {
    if (stopping) throw new Error("stopped while waiting for the API");
    try {
      const res = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`${origin}/health did not become healthy in time`);
    await new Promise((r) => setTimeout(r, 150));
  }
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
  const timer = setTimeout(() => children.forEach((c) => c.kill("SIGKILL")), 2_000);
  await Promise.all(exits);
  clearTimeout(timer);
  if (databasesCreated && !KEEP_DB) {
    try {
      await dropDatabases();
    } catch (err) {
      console.error(`[e2e-stack] could not drop worker databases: ${err.message}`);
    }
  }
  // Session cookies / seed ids of stacks that no longer exist.
  if (!KEEP_DB) fs.rmSync(path.join(REPO, "e2e/.auth"), { recursive: true, force: true });
  process.exit(code);
}
process.on("SIGTERM", () => void stop(0));
process.on("SIGINT", () => void stop(0));

// Playwright stops this process with SIGTERM, but if the runner itself dies
// without cleaning up (a second Ctrl+C: the terminal and `pnpm exec` both signal
// it, which makes Playwright exit at once; SIGKILL; out of memory) nothing would
// stop the servers or drop the databases. The config passes the runner's pid so
// we notice and clean up ourselves.
const RUNNER_PID = Number(process.env.E2E_RUNNER_PID);
if (RUNNER_PID) {
  setInterval(() => {
    try {
      process.kill(RUNNER_PID, 0);
    } catch {
      log(`Playwright runner (pid ${RUNNER_PID}) is gone: shutting down`);
      void stop(1);
    }
  }, 1_000).unref();
}

async function main() {
  if (process.env.E2E_SKIP_BUILD !== "1") {
    const t = Date.now();
    await run("pnpm", ["--filter", "@hisaabo/web", "exec", "vite", "build"]);
    await run("pnpm", ["--filter", "@hisaabo/api", "build"]);
    log(`builds finished in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }

  await createDatabases();

  for (let k = 0; k < WORKERS; k++) {
    const apiEnv = { ...process.env };
    // DISABLE_RATE_LIMIT is only honoured outside production (server.ts).
    delete apiEnv.NODE_ENV;
    Object.assign(apiEnv, {
      PORT: String(workerPorts(k).api),
      CORS_ORIGINS: webOrigin(k),
      // Pinned explicitly so a CONTROL_DATABASE_URL / DATABASE_URL in the repo's
      // .env (which the API loads without overriding) can never win.
      DATABASE_URL: workerDatabaseUrl(k),
      CONTROL_DATABASE_URL: workerDatabaseUrl(k),
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
        log(`API for worker ${k} exited unexpectedly (${code ?? signal})`);
        void stop(1);
      }
    });
    servers.push(
      await startWebServer({
        root: path.join(REPO, "apps/web/dist"),
        port: workerPorts(k).web,
        apiPort: workerPorts(k).api,
        isReady: () => allReady,
      }),
    );
  }

  const deadline = Date.now() + 60_000;
  await Promise.all(Array.from({ length: WORKERS }, (_, k) => waitForHealthy(apiOrigin(k), deadline)));
  allReady = true;
  log(`${WORKERS} worker stack(s) ready (web ${webOrigin(0)}.. -> api ${apiOrigin(0)}..)`);
}

main().catch((err) => {
  console.error(`[e2e-stack] ${err.message}`);
  void stop(1);
});
