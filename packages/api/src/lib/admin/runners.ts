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
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import type { DbTarget, SqlRunner } from "./stats.js";

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
  timeoutMs?: number;
}

export class DockerPsqlRunner implements SqlRunner {
  constructor(private readonly o: DockerRunnerOptions) {}

  describe(): string {
    if (this.o.command) return `${this.o.command.join(" ")} · psql -U ${this.o.user}`;
    return `docker compose exec ${this.o.service} · psql -U ${this.o.user}`;
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
    const [bin, ...pre] = this.prefix();
    const args = [
      ...pre,
      "psql",
      "-U", this.o.user,
      "-d", target.name ?? this.o.database,
      "-X", "-q", "-A", "-t",
      "-v", "ON_ERROR_STOP=1",
      "-c", sql,
    ];
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(bin, args, { maxBuffer: 64 * 1024 * 1024, timeout: this.o.timeoutMs ?? 60_000 }, (err, out, errOut) => {
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
  return chosen.replace(/^psql: error: /, "").replace(/^connection to server .*? failed: /, "").replace(/^(ERROR|FATAL):\s+/, "$1: ");
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

export class DirectRunner implements SqlRunner {
  private clients = new Map<string, Promise<PgClient>>();
  private readonly control: URL;

  constructor(controlUrl: string) {
    this.control = new URL(controlUrl);
  }

  describe(): string {
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

  private async client(url: string): Promise<PgClient> {
    let p = this.clients.get(url);
    if (!p) {
      p = (async () => {
        // Dynamic import keeps the bundle loadable on machines without node_modules
        // (the docker runner path never touches postgres.js).
        const mod = await import("postgres");
        const postgres = (mod.default ?? mod) as unknown as (u: string, o: Record<string, unknown>) => PgClient;
        return postgres(url, { max: 2, idle_timeout: 20, connect_timeout: 10 });
      })();
      this.clients.set(url, p);
    }
    return p;
  }

  async queryJson(target: DbTarget, sql: string): Promise<unknown> {
    const client = await this.client(this.urlFor(target));
    const rows = await client.unsafe(sql);
    const first = rows[0] as Record<string, unknown> | undefined;
    if (!first) throw new Error("query returned no rows");
    const value = first.data ?? Object.values(first)[0];
    // postgres.js parses json columns already; be defensive for text.
    return typeof value === "string" ? JSON.parse(value) : value;
  }

  async close(): Promise<void> {
    const all = [...this.clients.values()];
    this.clients.clear();
    await Promise.all(all.map((p) => p.then((cl) => cl.end({ timeout: 3 })).catch(() => undefined)));
  }
}
