/**
 * runners.ts — The two ways the admin dashboard reaches Postgres.
 *
 *   DockerPsqlRunner  — shells out to `docker compose … exec -T postgres psql`
 *                       from an operator's machine. Needs only Docker.
 *   DirectRunner      — connects with postgres.js using DATABASE_URL, for use
 *                       inside the hisaabo-api container or a dev checkout.
 *
 * Both expose the same tiny interface: run one SQL statement that yields a
 * single json column, hand back the parsed value.
 *
 * Both are also bounded: a statement_timeout on every query, and a connection
 * count that does not grow with the number of tenants (see DirectRunner).
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import type { DbTarget, SqlRunner } from "./stats.js";

const SAFE_DB_NAME = /^[A-Za-z0-9_]+$/;
const SAFE_HOST = /^[A-Za-z0-9._-]+$/;
const SAFE_PORT = /^\d{1,5}$/;

/** Server-side statement_timeout applied to every dashboard query (ms). */
export const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;
/**
 * The client-side deadline (collectPlatformStats' queryTimeoutMs, the docker
 * process timeout) sits this far above the server's statement_timeout, so the
 * server's own "canceling statement" error wins whenever it can answer at all.
 */
export const QUERY_TIMEOUT_GRACE_MS = 5_000;

/**
 * Tenant rows come from the database; refuse anything that psql would parse as
 * a connection string / option or that could redirect the control credentials.
 */
export function assertSafeTarget(target: DbTarget): void {
  if (target.name != null && !SAFE_DB_NAME.test(target.name)) throw new Error("unsafe database name in tenant row");
  if (target.host && !SAFE_HOST.test(target.host)) throw new Error("unsafe database host in tenant row");
  if (target.port && !SAFE_PORT.test(target.port)) throw new Error("unsafe database port in tenant row");
}

// ── Docker compose + psql ───────────────────────────────────────

export interface DockerRunnerOptions {
  composeFiles: string[];
  envFile: string | null;
  service: string;
  user: string;
  /** Default database (the control DB). */
  database: string;
  /** Override the whole command prefix, e.g. ["docker", "exec", "-i", "hisaabo-db"]. */
  command?: string[];
  /** Server-side statement_timeout, ms (default 15s). */
  statementTimeoutMs?: number;
  /** Kill the psql process after this long, ms (default: statement timeout + 5s). */
  timeoutMs?: number;
}

/**
 * One `docker exec psql` process (and so one backend connection) per query,
 * never kept between queries. Each carries a statement_timeout so the backend
 * stops even if the docker client is killed on the process deadline.
 *
 * Forking a process per query makes this the slow path on installs with many
 * tenant databases; prefer the direct runner there.
 */
export class DockerPsqlRunner implements SqlRunner {
  constructor(private readonly o: DockerRunnerOptions) {}

  describe(reveal = false): string {
    const user = reveal ? this.o.user : "•••";
    if (this.o.command) return `${this.o.command.join(" ")} · psql -U ${user}`;
    return `docker compose exec ${this.o.service} · psql -U ${user}`;
  }

  private prefix(): string[] {
    if (this.o.command) return this.o.command;
    const args = ["compose"];
    if (this.o.envFile) args.push("--env-file", this.o.envFile);
    for (const f of this.o.composeFiles) args.push("-f", f);
    args.push("exec", "-T", this.o.service);
    return ["docker", ...args];
  }

  async queryJson(target: DbTarget, sql: string): Promise<unknown> {
    assertSafeTarget(target);
    const [bin, ...pre] = this.prefix();
    const statementMs = Math.max(1, Math.floor(this.o.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS));
    const args = [
      ...pre,
      "psql",
      "-U", this.o.user,
      "-d", target.name ?? this.o.database,
      "-X", "-q", "-A", "-t",
      "-v", "ON_ERROR_STOP=1",
      // A session-level timeout first, then the query: with -q only the query's rows are printed.
      "-c", `SET statement_timeout = ${statementMs}`,
      "-c", sql,
    ];
    const stdout = await new Promise<string>((resolve, reject) => {
      const timeout = this.o.timeoutMs ?? statementMs + QUERY_TIMEOUT_GRACE_MS;
      execFile(bin, args, { maxBuffer: 64 * 1024 * 1024, timeout }, (err, out, errOut) => {
        if (err) {
          reject(new Error(pickPsqlError(String(errOut ?? ""), err.message)));
          return;
        }
        resolve(String(out));
      });
    });
    const line = stdout.trim();
    if (!line) throw new Error("psql returned no output");
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`unexpected psql output: ${line.slice(0, 120)}`);
    }
  }

  async close(): Promise<void> {
    /* stateless */
  }
}

/**
 * Pull the one line worth showing out of psql's stderr: the ERROR/FATAL line
 * (never the SQL echo or the caret line that follows it), falling back to the
 * last non-empty line, then to the process error.
 */
export function pickPsqlError(stderr: string, fallback: string): string {
  const lines = stderr.split("\n").map((l) => l.trim()).filter((l) => l && !/^\^+$/.test(l));
  const hit = lines.find((l) => /\b(ERROR|FATAL|PANIC):/.test(l) || l.startsWith("psql: error:"));
  const chosen = hit ?? lines[lines.length - 1] ?? fallback ?? "psql failed";
  const msg = chosen.replace(/^psql: error: /, "").replace(/^connection to server .*? failed: /, "").replace(/^(ERROR|FATAL):\s+/, "$1: ");
  return /canceling statement due to statement timeout/.test(msg) ? "timeout: query exceeded the statement timeout" : msg;
}

/** Minimal KEY=VALUE parser for .env files (no interpolation). */
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

export function defaultEnvFile(cwd: string): string | null {
  for (const name of [".env.prod", ".env"]) {
    const p = `${cwd}/${name}`;
    if (existsSync(p)) return name;
  }
  return null;
}

// ── Direct postgres.js connection ───────────────────────────────

type PgClient = {
  unsafe: (sql: string) => Promise<unknown[]>;
  end: (opts?: { timeout?: number }) => Promise<void>;
};

/** Opens one pooled client; overridable so tests can count connections without a database. */
export type PgConnect = (url: string, options: Record<string, unknown>) => PgClient | Promise<PgClient>;

export interface DirectRunnerOptions {
  /** Server-side statement_timeout for every query, in ms (default 15s). */
  statementTimeoutMs?: number;
  /** TCP connect timeout in seconds (default 8). */
  connectTimeoutSec?: number;
  /** Alternative driver factory (tests). Defaults to postgres.js. */
  connect?: PgConnect;
}

const defaultConnect: PgConnect = async (url, options) => {
  // Dynamic import keeps the bundle loadable on machines without node_modules
  // (the docker runner path never touches postgres.js).
  const mod = await import("postgres");
  const postgres = (mod.default ?? mod) as unknown as (u: string, o: Record<string, unknown>) => PgClient;
  return postgres(url, options);
};

/**
 * Connection discipline. The dashboard runs against production, where a
 * multi-tenant install has one database per tenant and Postgres'
 * max_connections is shared with the live API:
 *
 *   - every pool is `max: 1`;
 *   - a tenant pool is closed by the pass as soon as its tenant is done
 *     (`release`), so a refresh holds at most `concurrency` tenant connections;
 *   - the control database keeps its single connection (idle-closed after 10s,
 *     reopened on demand), so the peak is concurrency + 1;
 *   - every query carries a server-side statement_timeout and every connect a
 *     connect_timeout, so one hung database fails that tenant, not the refresh;
 *   - close() ends everything and refuses to open anything afterwards.
 */
export class DirectRunner implements SqlRunner {
  private clients = new Map<string, Promise<PgClient>>();
  private readonly control: URL;
  private readonly controlUrl: string;
  private readonly statementTimeoutMs: number;
  private readonly connectTimeoutSec: number;
  private readonly connectFn: PgConnect;
  private closed = false;

  constructor(controlUrl: string, opts: DirectRunnerOptions = {}) {
    this.control = new URL(controlUrl);
    this.controlUrl = this.control.toString();
    this.statementTimeoutMs = opts.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
    this.connectTimeoutSec = opts.connectTimeoutSec ?? 8;
    this.connectFn = opts.connect ?? defaultConnect;
  }

  describe(reveal = false): string {
    if (!reveal) return "direct · postgres";
    const host = this.control.hostname || "localhost";
    const port = this.control.port || "5432";
    return `direct · ${this.control.username || "postgres"}@${host}:${port}`;
  }

  /** Same server credentials, different database (and host/port if the tenant row says so). */
  urlFor(target: DbTarget): string {
    const u = new URL(this.control.toString());
    if (target.name) {
      u.pathname = `/${target.name}`;
      if (target.host) u.hostname = target.host;
      if (target.port) u.port = target.port;
    }
    return u.toString();
  }

  /** Number of pools currently open (diagnostics and tests). */
  get openPools(): number {
    return this.clients.size;
  }

  private client(url: string): Promise<PgClient> {
    if (this.closed) return Promise.reject(new Error("runner is closed"));
    let p = this.clients.get(url);
    if (!p) {
      const created = Promise.resolve(
        this.connectFn(url, {
          max: 1,
          idle_timeout: 10,
          connect_timeout: this.connectTimeoutSec,
          // Skip postgres.js' type-introspection round trip: we only read json columns.
          fetch_types: false,
          prepare: false,
          connection: {
            application_name: "hisaabo-admin",
            statement_timeout: String(this.statementTimeoutMs),
          },
        }),
      );
      p = created;
      this.clients.set(url, created);
      // A failed open must not poison the cache.
      created.catch(() => {
        if (this.clients.get(url) === created) this.clients.delete(url);
      });
    }
    return p;
  }

  async queryJson(target: DbTarget, sql: string): Promise<unknown> {
    assertSafeTarget(target);
    const client = await this.client(this.urlFor(target));
    let rows: unknown[];
    try {
      rows = await client.unsafe(sql);
    } catch (e) {
      // 57014 = query_canceled, what statement_timeout raises.
      if ((e as { code?: string } | null)?.code === "57014") {
        throw new Error(`timeout: query exceeded ${Math.round(this.statementTimeoutMs / 100) / 10}s`);
      }
      throw e;
    }
    const first = rows[0] as Record<string, unknown> | undefined;
    if (!first) throw new Error("query returned no rows");
    const value = first.data ?? Object.values(first)[0];
    // postgres.js parses json columns already; be defensive for text.
    return typeof value === "string" ? JSON.parse(value) : value;
  }

  /**
   * Close the pool for one tenant database. The control connection is kept
   * (shared-db mode queries it as a "tenant" too) unless `force` says it hung.
   */
  async release(target: DbTarget, opts: { force?: boolean } = {}): Promise<void> {
    let url: string;
    try {
      url = this.urlFor(target);
    } catch {
      return;
    }
    if (url === this.controlUrl && !opts.force) return;
    await this.drop(url, opts.force ? 0 : 5);
  }

  private async drop(url: string, timeoutSec: number): Promise<void> {
    const p = this.clients.get(url);
    if (!p) return;
    this.clients.delete(url);
    try {
      const cl = await p;
      await cl.end({ timeout: timeoutSec });
    } catch {
      /* already gone */
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const urls = [...this.clients.keys()];
    await Promise.all(urls.map((u) => this.drop(u, 3)));
  }
}
