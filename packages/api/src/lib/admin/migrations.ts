/**
 * migrations.ts — Migration drift detection for the admin dashboard.
 *
 * Drizzle records each applied migration as a row (sha256 of the SQL file,
 * journal timestamp) in a tracking table inside every database. The build
 * ships the expected set as meta/_journal.json next to the SQL files. This
 * module reads those journals from disk and compares them with what each
 * database reports, so a tenant that was skipped during a deploy, restored
 * from an older backup, or set up with db:push and never tracked, shows up.
 *
 * Pure except for `loadJournals`, which touches the filesystem.
 */

import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

export interface JournalEntry {
  tag: string;
  when: number;
  hash: string | null; // sha256 of the SQL file, null when the file is missing
}

export interface Journal {
  dir: string;
  entries: JournalEntry[];
}

export type JournalKind = "control" | "tenant" | "unified";

export type Journals = Record<JournalKind, Journal | null>;

/** Tracking table names, exactly as packages/db/src/migrate.ts creates them. */
export const MIGRATION_TABLES = {
  control: "__drizzle_control_migrations",
  tenant: "__drizzle_tenant_migrations",
  unified: "__drizzle_migrations",
} as const;

const SUBDIRS: Record<JournalKind, string> = {
  control: "drizzle-control",
  tenant: "drizzle-tenant",
  unified: "drizzle",
};

/**
 * Candidate locations for a migrations folder, mirroring migrate.ts:
 * explicit override → next to the running bundle (dist/bin → ../../../db)
 * → monorepo checkout relative to cwd.
 */
export function journalDirCandidates(kind: JournalKind, opts: { here: string; cwd: string; override?: string | null }): string[] {
  const sub = SUBDIRS[kind];
  return [
    ...(opts.override ? [resolve(opts.override, sub)] : []),
    resolve(opts.here, "..", "..", "..", "db", sub), // packages/api/{dist,src}/bin → packages/db
    resolve(opts.here, "..", "..", "db", sub),       // packages/api/dist → packages/db (server-style layout)
    resolve(opts.cwd, "packages", "db", sub),
    resolve(opts.cwd, sub),
  ];
}

export function readJournal(dir: string): Journal | null {
  const journalPath = resolve(dir, "meta", "_journal.json");
  if (!existsSync(journalPath)) return null;
  let parsed: { entries?: { tag?: string; when?: number }[] };
  try {
    parsed = JSON.parse(readFileSync(journalPath, "utf8"));
  } catch {
    return null;
  }
  const entries = (parsed.entries ?? [])
    .filter((e) => typeof e.tag === "string" && typeof e.when === "number")
    .map((e) => {
      const sqlPath = resolve(dir, `${e.tag}.sql`);
      let hash: string | null = null;
      if (existsSync(sqlPath)) hash = createHash("sha256").update(readFileSync(sqlPath, "utf8")).digest("hex");
      return { tag: e.tag as string, when: e.when as number, hash };
    })
    .sort((a, b) => a.when - b.when);
  return { dir, entries };
}

export function loadJournals(opts: { here: string; cwd: string; override?: string | null }): Journals {
  const out: Journals = { control: null, tenant: null, unified: null };
  for (const kind of Object.keys(SUBDIRS) as JournalKind[]) {
    for (const dir of journalDirCandidates(kind, opts)) {
      const j = readJournal(dir);
      if (j) {
        out[kind] = j;
        break;
      }
    }
  }
  return out;
}

// ── Comparison ──────────────────────────────────────────────────

export type MigrationStatus = "in_sync" | "behind" | "ahead" | "untracked" | "no_journal";

export interface AppliedMigrations {
  /** Tracking table that was found, or null when the database has none. */
  table: string | null;
  applied: number;
  /** Journal timestamp (ms) of the latest applied migration. */
  latestWhen: number | null;
  hashes: string[];
}

export interface MigrationState {
  kind: JournalKind;
  status: MigrationStatus;
  applied: number;
  expected: number;
  /** Tags the build expects but the database has not applied, in order. */
  pending: string[];
  /** Applied hashes this build's journal does not contain. */
  unknownApplied: number;
  latestApplied: string | null; // tag, when known
  latestAppliedAt: string | null; // ISO
}

/**
 * Drizzle's own rule for "pending": every journal entry whose timestamp is
 * newer than the latest applied row. Hashes are compared on top of that to
 * catch migrations applied by a newer build (or edited after being applied).
 */
export function compareMigrations(kind: JournalKind, journal: Journal | null, applied: AppliedMigrations): MigrationState {
  const base: MigrationState = {
    kind, status: "in_sync", applied: applied.applied, expected: journal?.entries.length ?? 0,
    pending: [], unknownApplied: 0, latestApplied: null, latestAppliedAt: applied.latestWhen ? new Date(applied.latestWhen).toISOString() : null,
  };
  if (!journal) return { ...base, status: "no_journal" };
  if (!applied.table) return { ...base, status: "untracked" };

  const latest = applied.latestWhen ?? 0;
  base.pending = journal.entries.filter((e) => e.when > latest).map((e) => e.tag);
  const known = new Set(journal.entries.map((e) => e.hash).filter((h): h is string => Boolean(h)));
  if (known.size > 0) base.unknownApplied = applied.hashes.filter((h) => !known.has(h)).length;
  const latestEntry = [...journal.entries].reverse().find((e) => e.when <= latest);
  base.latestApplied = latestEntry?.tag ?? null;

  if (base.pending.length > 0) base.status = "behind";
  else if (base.unknownApplied > 0) base.status = "ahead";
  return base;
}

/** The query that reads a tracking table. The name comes from MIGRATION_TABLES only. */
export function appliedMigrationsSql(table: string): string {
  if (!Object.values(MIGRATION_TABLES).includes(table as (typeof MIGRATION_TABLES)[keyof typeof MIGRATION_TABLES])) {
    throw new Error(`unexpected migrations table ${table}`);
  }
  return `select json_build_object(
  'applied', count(*),
  'latest', max(created_at),
  'hashes', coalesce(json_agg(hash order by id), '[]'::json)
) as data from "drizzle"."${table}"`;
}
