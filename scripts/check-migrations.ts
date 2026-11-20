/**
 * Migration Safety Check
 *
 * Every migration must be safe to apply while the PREVIOUS app version is
 * still serving traffic (expand/contract). This lints new migration files in
 * packages/db/drizzle*, flagging statements that break old code, fail on
 * existing data, or lock a live table for long:
 *
 *   drop                       DROP TABLE/COLUMN/TYPE/VIEW/FUNCTION/SCHEMA/SEQUENCE,
 *                              ALTER COLUMN … DROP DEFAULT
 *   rename                     any RENAME (table, column, constraint, enum value)
 *   alter-column-type          ALTER COLUMN … [SET DATA] TYPE
 *   add-not-null-column        ADD COLUMN … NOT NULL without a DEFAULT
 *   set-not-null               ALTER COLUMN … SET NOT NULL
 *   index-existing-table       CREATE [UNIQUE] INDEX on an existing table
 *   constraint-existing-table  ADD UNIQUE / PRIMARY KEY / EXCLUDE, or FOREIGN KEY /
 *                              CHECK without NOT VALID, on an existing table
 *   edited-migration           a migration file that already exists on the base
 *                              branch was modified or deleted (--base mode only)
 *
 * Tables created by a new migration in the same change are exempt from the
 * rules that only matter for existing data (everything except edited-migration
 * and bad-allow-marker), so a new table with its FKs and indexes is fine.
 *
 * Intentional exceptions — e.g. the "contract" step dropping a column the
 * previous release stopped using — are allowed with a marker comment inside
 * the statement (after the preceding `--> statement-breakpoint`):
 *
 *   -- migration-lint-allow drop: contract step for #123, column unused since v0.10
 *   ALTER TABLE "items" DROP COLUMN "legacy_code";
 *
 * Several rules: `-- migration-lint-allow drop,rename: reason`. A reason is
 * required. Markers cannot allow edited-migration.
 *
 * Usage (Node >= 22.6):
 *   node --experimental-strip-types scripts/check-migrations.ts --base origin/main
 *   node --experimental-strip-types scripts/check-migrations.ts packages/db/drizzle/0016_foo.sql
 *
 * Exits 1 if any finding is reported, 2 on usage errors.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const MIGRATION_DIRS = [
  "packages/db/drizzle",
  "packages/db/drizzle-control",
  "packages/db/drizzle-tenant",
];

export const RULES = {
  drop: "Dropping an object breaks the previous app version, which still uses it. Stop using it in code first, then drop it in a later release.",
  rename: "Renaming breaks the previous app version, which still uses the old name. Add the new name, migrate code, then drop the old one in a later release.",
  "alter-column-type": "Changing a column type rewrites the table under an ACCESS EXCLUSIVE lock and can break the previous app version. Add a new column and backfill instead.",
  "add-not-null-column": "ADD COLUMN … NOT NULL without a DEFAULT fails on any table with rows, and the previous app version will not set it on insert. Add a DEFAULT, or add it nullable and tighten later.",
  "set-not-null": "SET NOT NULL scans the whole table under an ACCESS EXCLUSIVE lock and fails if any row is NULL; the previous app version may still insert NULLs.",
  "index-existing-table": "CREATE INDEX on an existing table blocks writes for the whole build (drizzle runs migrations in a transaction, so CONCURRENTLY is unavailable). A UNIQUE index also fails on existing duplicates. Allow it only for a table known to be small, or build the index out of band.",
  "constraint-existing-table": "Adding this constraint to an existing table scans it under a lock and fails on existing rows that violate it. Use NOT VALID for FOREIGN KEY / CHECK and VALIDATE CONSTRAINT in a later migration; UNIQUE needs a pre-built unique index.",
  "edited-migration": "This migration already exists on the base branch and may have been applied. Never edit or delete an applied migration — add a new one instead.",
  "bad-allow-marker": "Malformed migration-lint-allow marker: it needs known rule names and a reason, e.g. `-- migration-lint-allow drop: why`.",
} as const;

export type Rule = keyof typeof RULES;

export interface Finding {
  file: string;
  line: number;
  rule: Rule;
  message: string;
  snippet: string;
}

const ALLOWABLE = new Set<string>(
  Object.keys(RULES).filter((r) => r !== "edited-migration" && r !== "bad-allow-marker"),
);

// ── SQL helpers ──────────────────────────────────────────────

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)`;
const QNAME = String.raw`(?:${IDENT}\s*\.\s*)?${IDENT}`;

/** Last part of a possibly schema-qualified identifier, unquoted (unquoted names folded to lower case). */
export function normalizeName(qname: string): string {
  const parts = qname.match(new RegExp(IDENT, "g")) ?? [qname];
  const last = parts[parts.length - 1].trim();
  return last.startsWith('"') ? last.slice(1, -1) : last.toLowerCase();
}

/**
 * Replace comments and string literals with spaces of the same length, so
 * rule regexes only see SQL keywords and match offsets still map to lines.
 */
export function maskSql(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    let end = -1;
    if (two === "--") {
      end = sql.indexOf("\n", i);
      if (end === -1) end = sql.length;
    } else if (two === "/*") {
      end = sql.indexOf("*/", i + 2);
      end = end === -1 ? sql.length : end + 2;
    } else if (sql[i] === "'") {
      end = i + 1;
      while (end < sql.length) {
        if (sql[end] === "'" && sql[end + 1] === "'") end += 2;
        else if (sql[end] === "'") { end++; break; }
        else end++;
      }
    }
    if (end === -1) {
      out += sql[i++];
    } else {
      out += sql.slice(i, end).replace(/[^\n]/g, " ");
      i = end;
    }
  }
  return out;
}

/** Table names created anywhere in the given SQL. */
export function createdTables(sql: string): Set<string> {
  const re = new RegExp(String.raw`\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QNAME})`, "gi");
  const names = new Set<string>();
  for (const m of maskSql(sql).matchAll(re)) names.add(normalizeName(m[1]));
  return names;
}

interface Chunk {
  text: string;   // raw statement text (comments included, for allow markers)
  masked: string; // comments/strings blanked out
  offset: number; // start offset within the file
}

/**
 * Split on top-level semicolons (not inside $$-quoted DO bodies). drizzle's
 * `--> statement-breakpoint` lines are comments, so they need no handling; a
 * marker comment on the lines before a statement lands in that statement's chunk.
 */
function splitStatements(sql: string): Chunk[] {
  const masked = maskSql(sql);
  const chunks: Chunk[] = [];
  let start = 0;
  let dollar: string | null = null;
  const push = (end: number) => {
    if (masked.slice(start, end).trim()) {
      chunks.push({ text: sql.slice(start, end), masked: masked.slice(start, end), offset: start });
    }
    start = end;
  };
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === "$") {
      const tag = /^\$(?:[A-Za-z_]\w*)?\$/.exec(masked.slice(i))?.[0];
      if (tag) {
        if (dollar === null) dollar = tag;
        else if (dollar === tag) dollar = null;
        i += tag.length - 1;
        continue;
      }
    }
    if (masked[i] === ";" && dollar === null) push(i + 1);
  }
  push(masked.length);
  return chunks;
}

function lineAt(sql: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < sql.length; i++) if (sql[i] === "\n") line++;
  return line;
}

// ── Linting ──────────────────────────────────────────────────

interface Hit {
  rule: Rule;
  index: number; // offset within the chunk
}

function statementHits(s: string, isNew: (name: string) => boolean): Hit[] {
  const hits: Hit[] = [];
  // Same text with quoted identifiers blanked, so a column named "rename" or
  // "drop column" never looks like a keyword. Offsets are unchanged.
  const kw = s.replace(/"[^"]*"/g, (q) => `"${"_".repeat(q.length - 2)}"`);
  const add = (rule: Rule, index: number) => hits.push({ rule, index });

  const alter = s.match(new RegExp(String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${QNAME})`, "i"));
  const alteredExisting = alter ? !isNew(normalizeName(alter[1])) : false;

  // drop
  for (const m of s.matchAll(new RegExp(String.raw`\bDROP\s+(TABLE|TYPE|VIEW|MATERIALIZED\s+VIEW|FUNCTION|SCHEMA|SEQUENCE)\s+(?:IF\s+EXISTS\s+)?(${QNAME})`, "gi"))) {
    if (/^TABLE$/i.test(m[1]) && isNew(normalizeName(m[2]))) continue;
    add("drop", m.index!);
  }
  if (alteredExisting) {
    for (const m of kw.matchAll(/\bDROP\s+COLUMN\b/gi)) add("drop", m.index!);
    for (const m of kw.matchAll(new RegExp(String.raw`\bALTER\s+(?:COLUMN\s+)?${IDENT}\s+DROP\s+DEFAULT\b`, "gi"))) add("drop", m.index!);
  }

  // rename (ALTER TYPE … RENAME VALUE has no ALTER TABLE, so it is always checked)
  if (alteredExisting || !alter) {
    for (const m of kw.matchAll(/\bRENAME\b/gi)) add("rename", m.index!);
  }

  if (alteredExisting) {
    for (const m of kw.matchAll(new RegExp(String.raw`\bALTER\s+(?:COLUMN\s+)?${IDENT}\s+(?:SET\s+DATA\s+)?TYPE\b`, "gi"))) add("alter-column-type", m.index!);
    for (const m of kw.matchAll(new RegExp(String.raw`\bALTER\s+(?:COLUMN\s+)?${IDENT}\s+SET\s+NOT\s+NULL\b`, "gi"))) add("set-not-null", m.index!);

    // Split into ADD COLUMN clauses (an ALTER TABLE may add several columns).
    const addCol = /\bADD\s+COLUMN\b/gi;
    const starts = [...kw.matchAll(addCol)].map((m) => m.index!);
    starts.forEach((start, i) => {
      const clause = kw.slice(start, starts[i + 1] ?? s.length);
      if (/\bNOT\s+NULL\b/i.test(clause) && !/\bDEFAULT\b|\bGENERATED\b|\b(?:small|big)?serial\b/i.test(clause)) {
        add("add-not-null-column", start);
      }
    });

    for (const m of kw.matchAll(new RegExp(String.raw`\bADD\s+(?:CONSTRAINT\s+${IDENT}\s+)?(UNIQUE|PRIMARY\s+KEY|EXCLUDE|FOREIGN\s+KEY|CHECK)\b`, "gi"))) {
      const validatable = /^(FOREIGN\s+KEY|CHECK)$/i.test(m[1]);
      if (validatable && /\bNOT\s+VALID\b/i.test(kw.slice(m.index!))) continue;
      add("constraint-existing-table", m.index!);
    }
  }

  // index-existing-table
  for (const m of s.matchAll(new RegExp(String.raw`\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(CONCURRENTLY\s+)?[\s\S]*?\bON\s+(?:ONLY\s+)?(${QNAME})`, "gi"))) {
    if (m[1]) continue;
    if (!isNew(normalizeName(m[2]))) add("index-existing-table", m.index!);
  }

  return hits;
}

interface Marker {
  rules: string[];
  reason: string;
  index: number;
}

function allowMarkers(text: string): Marker[] {
  const markers: Marker[] = [];
  for (const m of text.matchAll(/--[ \t]*migration-lint-allow\b([^\n]*)/g)) {
    const body = m[1];
    const colon = body.indexOf(":");
    const rules = (colon === -1 ? body : body.slice(0, colon)).split(",").map((r) => r.trim()).filter(Boolean);
    const reason = colon === -1 ? "" : body.slice(colon + 1).trim();
    markers.push({ rules, reason, index: m.index! });
  }
  return markers;
}

/**
 * Lint one migration file's SQL. `newTables` holds tables created by any new
 * migration in the same change (see createdTables); statements touching them
 * are not checked for existing-data problems.
 */
export function lintMigration(sql: string, file: string, newTables: Set<string> = createdTables(sql)): Finding[] {
  const findings: Finding[] = [];
  const isNew = (name: string) => newTables.has(name);

  for (const chunk of splitStatements(sql)) {
    const allowed = new Set<string>();
    for (const marker of allowMarkers(chunk.text)) {
      const bad = marker.rules.length === 0 || !marker.reason || marker.rules.some((r) => !ALLOWABLE.has(r));
      if (bad) {
        findings.push(finding(sql, file, chunk, marker.index, "bad-allow-marker"));
      } else {
        marker.rules.forEach((r) => allowed.add(r));
      }
    }

    const seen = new Set<string>();
    for (const hit of statementHits(chunk.masked, isNew)) {
      if (allowed.has(hit.rule)) continue;
      const key = `${hit.rule}@${hit.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(finding(sql, file, chunk, hit.index, hit.rule));
    }
  }

  return findings.sort((a, b) => a.line - b.line);
}

function finding(sql: string, file: string, chunk: Chunk, index: number, rule: Rule): Finding {
  const offset = chunk.offset + index;
  const lineStart = sql.lastIndexOf("\n", offset - 1) + 1;
  const lineEnd = sql.indexOf("\n", offset);
  return {
    file,
    line: lineAt(sql, offset),
    rule,
    message: RULES[rule],
    snippet: sql.slice(lineStart, lineEnd === -1 ? sql.length : lineEnd).trim(),
  };
}

// ── CLI ──────────────────────────────────────────────────────

function isMigrationSql(file: string): boolean {
  return file.endsWith(".sql") && MIGRATION_DIRS.includes(path.posix.dirname(file));
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

interface Plan {
  added: string[];
  edited: string[];
}

/** Compares base with the working tree, so uncommitted and untracked migrations are checked locally too. */
function planFromBase(base: string): Plan {
  const plan: Plan = { added: [], edited: [] };
  const diff = git(["diff", "--name-status", "--no-renames", base, "--", ...MIGRATION_DIRS]);
  for (const line of diff.split("\n").filter(Boolean)) {
    const [status, file] = line.split("\t");
    if (!isMigrationSql(file)) continue;
    if (status === "A") plan.added.push(file);
    else plan.edited.push(file);
  }
  const untracked = git(["ls-files", "--others", "--exclude-standard", "--", ...MIGRATION_DIRS]);
  for (const file of untracked.split("\n").filter(Boolean)) {
    if (isMigrationSql(file)) plan.added.push(file);
  }
  return plan;
}

function lintFiles(plan: Plan): Finding[] {
  const findings: Finding[] = [];

  for (const file of plan.edited) {
    findings.push({ file, line: 1, rule: "edited-migration", message: RULES["edited-migration"], snippet: "" });
  }

  // Tables created by new migrations count as new across all new files in the
  // same folder (e.g. 0016 creates a table, 0017 indexes it).
  const byDir = new Map<string, string[]>();
  for (const file of plan.added) {
    const dir = path.posix.dirname(file);
    byDir.set(dir, [...(byDir.get(dir) ?? []), file]);
  }
  for (const files of byDir.values()) {
    const sources = files.sort().map((file) => ({ file, sql: fs.readFileSync(file, "utf8") }));
    const newTables = new Set<string>();
    for (const { sql } of sources) createdTables(sql).forEach((t) => newTables.add(t));
    for (const { file, sql } of sources) findings.push(...lintMigration(sql, file, newTables));
  }

  return findings;
}

function escapeAnnotation(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function main(argv: string[]): number {
  let base: string | undefined;
  const files: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") base = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log("Usage: check-migrations.ts --base <git-ref> | <migration.sql>...");
      return 0;
    } else files.push(argv[i]);
  }
  if ((base === undefined) === (files.length === 0)) {
    console.error("Usage: check-migrations.ts --base <git-ref> | <migration.sql>...");
    return 2;
  }

  let plan: Plan;
  if (base !== undefined) {
    try {
      // git prints repo-root-relative paths; read files from there too.
      process.chdir(git(["rev-parse", "--show-toplevel"]).trim());
      plan = planFromBase(base);
    } catch (err) {
      console.error(`git diff against ${base} failed: ${(err as Error).message}`);
      return 2;
    }
  } else {
    plan = { added: files.map((f) => path.relative(process.cwd(), f).split(path.sep).join("/")), edited: [] };
  }

  const checked = plan.added.length + plan.edited.length;
  const findings = lintFiles(plan);
  const annotate = process.env.GITHUB_ACTIONS === "true";

  for (const f of findings) {
    console.log(`${f.file}:${f.line}: [${f.rule}] ${f.message}`);
    if (f.snippet) console.log(`    ${f.snippet}`);
    if (annotate) {
      console.log(`::error file=${f.file},line=${f.line},title=migration-lint ${f.rule}::${escapeAnnotation(f.message)}`);
    }
  }

  if (checked === 0) {
    console.log("No migration changes to check.");
  } else if (findings.length === 0) {
    console.log(`Checked ${checked} migration file(s): no unsafe statements.`);
  } else {
    console.log(
      `\n${findings.length} unsafe statement(s) in ${checked} migration file(s).` +
        "\nSee the header of scripts/check-migrations.ts for the expand/contract rules and how to allow an intentional exception.",
    );
  }
  return findings.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
