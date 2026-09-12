/**
 * admin.ts — Hisaabo admin dashboard (TUI).
 *
 * A full-screen terminal dashboard with platform-wide statistics: tenants,
 * users, businesses, invoices, amount managed, collections, receivables,
 * a 12-month sales chart, plan/status breakdowns and a per-tenant table.
 *
 * WHERE IT RUNS
 *   Inside the API container (direct DB connection via DATABASE_URL):
 *     docker exec -it hisaabo-api node packages/api/dist/bin/admin.js
 *   From an operator shell with Docker only (shells out to psql in the
 *   postgres container, exactly like running psql by hand):
 *     node packages/api/dist/bin/admin.js --via docker --env-file .env.prod
 *   Dev checkout:
 *     pnpm --filter @hisaabo/api admin
 *
 * Run with --help for all flags. Read-only: it never writes to the database.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { collectPlatformStats, type PlatformStats, type SqlRunner } from "../lib/admin/stats.js";
import { DockerPsqlRunner, DirectRunner, parseEnvFile, defaultEnvFile } from "../lib/admin/runners.js";
import { renderFrame, frameToString, type ViewState, type View } from "../lib/admin/screens.js";
import { buildDemoStats } from "../lib/admin/demo.js";
import { setColorEnabled, c } from "../lib/admin/tui.js";
import { splitKeys } from "../lib/admin/keys.js";
import { maskStats } from "../lib/admin/privacy.js";

// ── CLI args ────────────────────────────────────────────────────

interface Args {
  via: "auto" | "direct" | "docker" | "demo";
  once: boolean;
  json: boolean;
  interval: number;
  width: number | null;
  color: boolean;
  forceColor: boolean;
  reveal: boolean;
  view: View;
  databaseUrl: string | null;
  envFile: string | null;
  composeFiles: string[];
  service: string;
  user: string | null;
  database: string | null;
  command: string[] | null;
  concurrency: number;
  help: boolean;
}

const HELP = `
hisaabo admin — live platform dashboard for Hisaabo operators

USAGE
  node packages/api/dist/bin/admin.js [options]

OPTIONS
  --via <auto|direct|docker|demo>  How to reach Postgres (default: auto)
                                   direct  → DATABASE_URL / --database-url (inside hisaabo-api)
                                   docker  → docker compose exec <service> psql (from the host)
                                   demo    → synthetic data, no database needed
  --database-url <url>             Control DB URL for --via direct
  --env-file <file>                Compose env file (default: .env.prod, then .env if present)
  --compose-file <file>            Compose file, repeatable (default: docker-compose.yml)
  --service <name>                 Postgres compose service (default: postgres)
  --user <name>                    psql user (default: POSTGRES_USER from env file, else hisaabo)
  --database <name>                Control database (default: POSTGRES_DB from env file, else hisaabo)
  --command "<prefix>"             Replace the docker compose prefix, e.g. "docker exec -i hisaabo-db"
  --interval <seconds>             Auto-refresh period (default: 30, 0 = manual only)
  --concurrency <n>                Tenant databases queried in parallel (default: 4)
  --view <overview|tenants>        Initial view (default: overview)
  --reveal                         Show real tenant names, slugs, emails and hosts. By default all
                                   PII is masked (Tenant 3f9a2c, pr•••@sh••••.in) so screenshots
                                   and --json output are safe to share.
  --once                           Print one snapshot and exit (implied when stdout is not a TTY)
  --json                           Print the raw statistics as JSON and exit
  --width <cols>                   Column width for --once output (default: terminal width or 120)
  --no-color                       Disable ANSI colours (NO_COLOR is also honoured)
  --color                          Force ANSI colours even when piping (FORCE_COLOR too)
  -h, --help                       Show this help

KEYS (interactive)
  1 / 2       switch Overview / Tenants        r        refresh now
  p           toggle PII masking
  ↑ ↓ j k     move selection (Tenants view)    g / G    jump to first / last
  q, Esc      quit                              Ctrl-C   quit
`;

function parseArgs(argv: string[]): Args {
  const a: Args = {
    via: "auto", once: false, json: false, interval: 30, width: null, color: true, forceColor: false, reveal: false, view: "overview",
    databaseUrl: null, envFile: null, composeFiles: [], service: "postgres", user: null, database: null,
    command: null, concurrency: 4, help: false,
  };
  const next = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--via": a.via = next(i++, arg) as Args["via"]; break;
      case "--demo": a.via = "demo"; break;
      case "--once": a.once = true; break;
      case "--json": a.json = true; break;
      case "--interval": a.interval = Math.max(0, Number(next(i++, arg)) || 0); break;
      case "--width": a.width = Math.max(60, Number(next(i++, arg)) || 0); break;
      case "--no-color": a.color = false; break;
      case "--color": a.forceColor = true; break;
      case "--reveal": case "--show-pii": a.reveal = true; break;
      case "--view": a.view = next(i++, arg) === "tenants" ? "tenants" : "overview"; break;
      case "--database-url": a.databaseUrl = next(i++, arg); break;
      case "--env-file": a.envFile = next(i++, arg); break;
      case "--compose-file": case "-f": a.composeFiles.push(next(i++, arg)); break;
      case "--service": a.service = next(i++, arg); break;
      case "--user": case "-U": a.user = next(i++, arg); break;
      case "--database": case "-d": a.database = next(i++, arg); break;
      case "--command": a.command = next(i++, arg).split(/\s+/).filter(Boolean); break;
      case "--concurrency": a.concurrency = Math.max(1, Number(next(i++, arg)) || 1); break;
      case "-h": case "--help": a.help = true; break;
      default:
        throw new Error(`unknown option ${arg} (try --help)`);
    }
  }
  if (!["auto", "direct", "docker", "demo"].includes(a.via)) throw new Error(`--via must be auto, direct, docker or demo`);
  return a;
}

// ── Wiring ──────────────────────────────────────────────────────

function readVersion(): string {
  if (process.env.HISAABO_VERSION && process.env.HISAABO_VERSION !== "dev") return process.env.HISAABO_VERSION;
  try {
    // dist/bin/admin.js → ../../package.json, and src/bin/admin.ts → ../../package.json
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(path.join(here, "..", "..", "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "dev";
  } catch {
    return "dev";
  }
}

function buildRunner(a: Args): SqlRunner {
  const url = a.databaseUrl ?? process.env.CONTROL_DATABASE_URL ?? process.env.DATABASE_URL ?? null;
  const via = a.via === "auto" ? (url ? "direct" : "docker") : a.via;
  if (via === "direct") {
    if (!url) throw new Error("--via direct needs DATABASE_URL (or --database-url)");
    return new DirectRunner(url);
  }
  const cwd = process.cwd();
  const envFile = a.envFile ?? defaultEnvFile(cwd);
  let fileEnv: Record<string, string> = {};
  if (envFile) {
    try {
      fileEnv = parseEnvFile(readFileSync(path.resolve(cwd, envFile), "utf8"));
    } catch (e) {
      throw new Error(`cannot read env file ${envFile}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return new DockerPsqlRunner({
    composeFiles: a.composeFiles.length ? a.composeFiles : ["docker-compose.yml"],
    envFile,
    service: a.service,
    user: a.user ?? process.env.PGUSER ?? fileEnv.POSTGRES_USER ?? "hisaabo",
    database: a.database ?? process.env.PGDATABASE ?? fileEnv.POSTGRES_DB ?? "hisaabo",
    command: a.command ?? undefined,
  });
}

// ── Interactive loop ────────────────────────────────────────────

const ALT_ON = "\x1b[?1049h";
const ALT_OFF = "\x1b[?1049l";
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";
const HOME = "\x1b[H";
const CLEAR = "\x1b[2J";

async function runInteractive(collect: () => Promise<PlatformStats>, close: () => Promise<void>, a: Args, runnerLabel: (masked: boolean) => string, version: string): Promise<void> {
  const out = process.stdout;
  const inp = process.stdin;
  const state: ViewState = {
    view: a.view, stats: null, loading: true, refreshing: false, error: null, selected: 0,
    interactive: true, intervalSec: a.interval, nextRefreshAt: null, runnerLabel: runnerLabel(!a.reveal), version, now: new Date(),
    masked: !a.reveal,
  };
  let raw: PlatformStats | null = null;
  const applyMask = () => {
    state.stats = raw ? (state.masked ? maskStats(raw) : raw) : null;
    state.runnerLabel = runnerLabel(state.masked);
  };
  let lastSize = `${out.columns}x${out.rows}`;
  let exiting = false;
  let refreshTimer: NodeJS.Timeout | null = null;

  const draw = () => {
    if (exiting) return;
    state.now = new Date();
    const size = `${out.columns}x${out.rows}`;
    const frame = renderFrame(state, out.columns || 120, out.rows || 40);
    out.write((size !== lastSize ? CLEAR : "") + HOME + frame.join("\n"));
    lastSize = size;
  };

  const scheduleRefresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    state.nextRefreshAt = null;
    if (a.interval > 0) {
      state.nextRefreshAt = Date.now() + a.interval * 1000;
      refreshTimer = setTimeout(() => void refresh(), a.interval * 1000);
    }
  };

  let inFlight = false;
  const refresh = async () => {
    if (inFlight) return;
    inFlight = true;
    state.refreshing = true;
    draw();
    try {
      raw = await collect();
      applyMask();
      state.error = state.stats?.errors.length ? state.stats.errors[0] : null;
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
    } finally {
      inFlight = false;
      state.loading = false;
      state.refreshing = false;
      scheduleRefresh();
      draw();
    }
  };

  const shutdown = async () => {
    if (exiting) return;
    exiting = true;
    if (refreshTimer) clearTimeout(refreshTimer);
    clearInterval(tick);
    try {
      if (inp.isTTY) inp.setRawMode(false);
      inp.pause();
    } catch { /* ignore */ }
    out.write(CURSOR_SHOW + ALT_OFF);
    await close();
    process.exit(0);
  };

  const move = (delta: number, absolute?: number) => {
    const n = state.stats ? state.stats.tenants.length : 0;
    if (n === 0) return;
    const target = absolute !== undefined ? absolute : state.selected + delta;
    state.selected = Math.min(n - 1, Math.max(0, target));
  };

  inp.setRawMode(true);
  inp.resume();
  inp.setEncoding("utf8");
  inp.on("data", (chunk: string) => {
    for (const k of splitKeys(chunk)) {
      switch (k) {
        case "q": case "\x1b": case "\x03": case "\x04": void shutdown(); return;
        case "r": case "R": void refresh(); break;
        case "1": state.view = "overview"; break;
        case "2": state.view = "tenants"; break;
        case "p": case "P": state.masked = !state.masked; applyMask(); if (state.stats?.errors.length) state.error = state.stats.errors[0]; break;
        case "\t": state.view = state.view === "overview" ? "tenants" : "overview"; break;
        case "j": case "\x1b[B": move(1); break;
        case "k": case "\x1b[A": move(-1); break;
        case "\x1b[6~": move(10); break;   // PgDn
        case "\x1b[5~": move(-10); break;  // PgUp
        case "g": case "\x1b[H": move(0, 0); break;
        case "G": case "\x1b[F": move(0, Number.MAX_SAFE_INTEGER); break;
        default: break;
      }
    }
    draw();
  });
  out.on("resize", draw);
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  out.write(ALT_ON + CURSOR_HIDE + CLEAR);
  const tick = setInterval(draw, 1000);
  draw();
  await refresh();
  // Keep the process alive until shutdown() calls process.exit.
  await new Promise<void>(() => undefined);
}

// ── Main ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  let a: Args;
  try {
    a = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`hisaabo admin: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(2);
  }
  if (a.help) {
    process.stdout.write(HELP.trimStart());
    return;
  }
  // Colour: --no-color / NO_COLOR win; --color / FORCE_COLOR force it on
  // (e.g. piping a snapshot into a file); otherwise follow the TTY.
  if (!a.color || "NO_COLOR" in process.env) setColorEnabled(false);
  else if (a.forceColor || process.env.FORCE_COLOR) setColorEnabled(true);
  else setColorEnabled(Boolean(process.stdout.isTTY));

  const version = readVersion();
  let runner: SqlRunner | null = null;
  let collect: () => Promise<PlatformStats>;
  let runnerLabel: (masked: boolean) => string;
  if (a.via === "demo") {
    collect = async () => buildDemoStats(new Date());
    runnerLabel = () => "demo data";
  } else {
    runner = buildRunner(a);
    const r = runner;
    collect = () => collectPlatformStats({ runner: r, concurrency: a.concurrency });
    runnerLabel = (masked) => r.describe(!masked);
  }
  const close = async () => { if (runner) await runner.close(); };

  const interactive = !a.once && !a.json && Boolean(process.stdout.isTTY) && Boolean(process.stdin.isTTY);
  if (interactive) {
    await runInteractive(collect, close, a, runnerLabel, version);
    return;
  }

  try {
    const stats = a.reveal ? await collect() : maskStats(await collect());
    if (a.json) {
      process.stdout.write(JSON.stringify(stats, null, 2) + "\n");
    } else {
      const cols = a.width ?? process.stdout.columns ?? 120;
      const state: ViewState = {
        view: a.view, stats, loading: false, refreshing: false, error: stats.errors[0] ?? null, selected: 0,
        interactive: false, intervalSec: 0, nextRefreshAt: null, runnerLabel: runnerLabel(!a.reveal), version, now: new Date(),
        masked: !a.reveal,
      };
      process.stdout.write(frameToString(renderFrame(state, cols)));
    }
  } catch (e) {
    process.stderr.write(c.bad("hisaabo admin: ") + (e instanceof Error ? e.message : String(e)) + "\n");
    await close();
    process.exit(1);
  }
  await close();
}

main().catch((e) => {
  process.stderr.write(`hisaabo admin: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
