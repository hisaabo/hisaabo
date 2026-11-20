/**
 * cache-write-guard.test.ts — static guard: every code path that WRITES a
 * cached control/tenant table must be known, and must either emit a cache bus
 * event or carry an explicit `// cache-guard: <reason>` opt-out.
 *
 * WHY: the authz / session / api-key / slug / maintenance caches are only
 * correct if every writer invalidates (same-request via `cacheBus`, and
 * cross-process via the DB triggers). A new writer that forgets is a
 * stale-allow bug that no behavioural test will notice. This test fails the
 * build instead.
 *
 * HOW IT WORKS: scans packages/api/src (excluding __tests__) with comments and
 * regex literals stripped (string contents are kept so raw SQL is seen) for
 *   - Drizzle writes: `.insert(T)`, `.update(T)`, `.delete(T)` (multi-line,
 *     `schema.T` and `import { T as alias }` tolerant)
 *   - raw SQL writes: INSERT INTO / UPDATE / DELETE FROM <table>
 * and compares the set of (table, file) pairs with ALLOWED_WRITERS below.
 *
 * TO ADD A WRITER: see the failure message; short version:
 *   1. emit the right event AFTER the write settles
 *      (`await cacheBus.afterWrite([{ kind: ... }], () => write)` or
 *      `cacheBus.invalidate(...)`), then
 *   2. add the file under the table in ALLOWED_WRITERS, or
 *   3. for writes that must NOT invalidate (hot-path `last_used_at` bumps,
 *      expiry sweeps, CLI-only processes covered by the DB triggers) add
 *      `// cache-guard: <reason>` within a few lines of the write.
 * Limitation: the emission requirement is per file, not per statement.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

interface Guarded {
  /** Drizzle export names of the table (camelCase). */
  idents: string[];
  /** SQL table name. */
  sqlName: string;
  /** Which write verbs are guarded (businesses: only create/delete matter). */
  verbs: ("insert" | "update" | "delete")[];
}

const ALL: Guarded["verbs"] = ["insert", "update", "delete"];
export const GUARDED: Record<string, Guarded> = {
  sessions: { idents: ["sessions"], sqlName: "sessions", verbs: ALL },
  access_tokens: { idents: ["accessTokens"], sqlName: "access_tokens", verbs: ALL },
  users: { idents: ["users"], sqlName: "users", verbs: ALL },
  tenant_members: { idents: ["tenantMembers"], sqlName: "tenant_members", verbs: ALL },
  tenants: { idents: ["tenants"], sqlName: "tenants", verbs: ALL },
  api_keys: { idents: ["apiKeys"], sqlName: "api_keys", verbs: ALL },
  system_config: { idents: ["systemConfig"], sqlName: "system_config", verbs: ALL },
  store_slugs: { idents: ["storeSlugs"], sqlName: "store_slugs", verbs: ALL },
  // Only existence + creator are cached; ordinary UPDATEs (counters, store
  // settings) are not cache-relevant.
  businesses: { idents: ["businesses"], sqlName: "businesses", verbs: ["insert", "delete"] },
};

/** table -> files (relative to packages/api/src, posix) allowed to write it. */
export const ALLOWED_WRITERS: Record<string, string[]> = {
  sessions: [
    "context.ts", // lastUsedAt/expiresAt bumps + max-expired delete (cache-guard)
    "routers/auth.ts",
    "routers/tenant.ts",
    "lib/plan-limits.ts",
    "lib/session-rotation.ts",
    "server.ts", // hourly expired-session sweep (cache-guard)
  ],
  access_tokens: ["routers/auth.ts"],
  users: ["routers/auth.ts"],
  tenant_members: ["routers/auth.ts", "routers/tenant.ts"],
  tenants: [
    "routers/auth.ts",
    "routers/tenant.ts",
    "bin/encrypt-sensitive-fields.ts", // CLI process (cache-guard: DB trigger)
    "bin/rotate-key.ts", // CLI process (cache-guard: DB trigger)
  ],
  api_keys: ["context.ts", "routers/apiKey.ts", "routers/auth.ts", "routers/tenant.ts"],
  system_config: ["bin/maintenance.ts"], // CLI process (cache-guard: DB trigger)
  store_slugs: ["lib/store-slug-registry.ts"],
  businesses: ["routers/business.ts"],
};

// ─── scanner ───────────────────────────────────────────────────────────────

/**
 * Blank out comments and regex literals (keeping newlines so line numbers are
 * stable). String / template contents are kept: raw SQL lives in them.
 */
export function stripComments(src: string): string {
  const out: string[] = [];
  const n = src.length;
  let i = 0;
  let lastSig = ""; // last significant (non-space, non-comment) char, for regex detection
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  // template-literal nesting: each entry = brace depth inside a `${ }`
  const tplStack: number[] = [];
  let inTemplate = false;

  while (i < n) {
    const ch = src[i]!;
    const next = src[i + 1];

    if (inTemplate) {
      if (ch === "\\") {
        out.push(ch, next ?? "");
        i += 2;
        continue;
      }
      if (ch === "`") {
        inTemplate = false;
        out.push(ch);
        lastSig = "`";
        i++;
        continue;
      }
      if (ch === "$" && next === "{") {
        tplStack.push(0);
        inTemplate = false;
        out.push("${");
        lastSig = "{";
        i += 2;
        continue;
      }
      out.push(ch);
      i++;
      continue;
    }

    if (ch === "/" && next === "/") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      out.push(blank(src.slice(i, stop)));
      i = stop;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      out.push(blank(src.slice(i, stop)));
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && src[j] !== ch && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      out.push(src.slice(i, j + 1));
      i = j + 1;
      lastSig = ch;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      out.push(ch);
      i++;
      continue;
    }
    if (ch === "/") {
      // regex literal vs division: a regex can only start after an operator/punctuator
      if (lastSig === "" || "(,=:[!&|?{};+-*%<>~^".includes(lastSig)) {
        let j = i + 1;
        let inClass = false;
        while (j < n && src[j] !== "\n") {
          const c = src[j]!;
          if (c === "\\") j += 2;
          else {
            if (c === "[") inClass = true;
            else if (c === "]") inClass = false;
            else if (c === "/" && !inClass) break;
            j++;
          }
        }
        out.push(blank(src.slice(i, j + 1)));
        i = j + 1;
        lastSig = ")";
        continue;
      }
    }
    if (tplStack.length) {
      if (ch === "{") tplStack[tplStack.length - 1]!++;
      else if (ch === "}") {
        if (tplStack[tplStack.length - 1] === 0) {
          tplStack.pop();
          inTemplate = true;
          out.push(ch);
          i++;
          continue;
        }
        tplStack[tplStack.length - 1]!--;
      }
    }
    out.push(ch);
    if (!/\s/.test(ch)) lastSig = ch;
    i++;
  }
  return out.join("");
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** `import { users as u } from ...` -> alias -> original ident. */
function importAliases(code: string): Map<string, string> {
  const m = new Map<string, string>();
  const re = /import\s*(?:type\s*)?\{([^}]*)\}\s*from/g;
  for (const imp of code.matchAll(re)) {
    for (const part of imp[1]!.split(",")) {
      const mm = part.trim().match(/^(\w+)\s+as\s+(\w+)$/);
      if (mm) m.set(mm[2]!, mm[1]!);
    }
  }
  return m;
}

export interface WriteHit {
  table: string;
  verb: string;
  line: number;
  via: "drizzle" | "sql";
}

export function findWrites(rawSource: string): { hits: WriteHit[]; code: string } {
  const code = stripComments(rawSource);
  const aliases = importAliases(code);
  const hits: WriteHit[] = [];

  for (const [table, g] of Object.entries(GUARDED)) {
    const names = new Set(g.idents);
    for (const [alias, orig] of aliases) if (names.has(orig)) names.add(alias);
    const identAlt = [...names].join("|");
    const verbAlt = g.verbs.join("|");

    // .insert( users ...  |  .update(\n  schema.users)
    const drizzle = new RegExp(`\\.\\s*(${verbAlt})\\s*\\(\\s*(?:\\w+\\s*\\.\\s*)?(?:${identAlt})\\b`, "g");
    for (const m of code.matchAll(drizzle)) {
      hits.push({ table, verb: m[1]!, line: lineOf(code, m.index!), via: "drizzle" });
    }

    const sqlVerbs: Record<string, string> = { insert: "INSERT\\s+INTO", update: "UPDATE", delete: "DELETE\\s+FROM" };
    const sqlAlt = g.verbs.map((v) => sqlVerbs[v]).join("|");
    const raw = new RegExp(`\\b(${sqlAlt})\\s+(?:ONLY\\s+)?(?:"?public"?\\s*\\.\\s*)?"?${g.sqlName}"?(?![\\w])`, "gi");
    for (const m of code.matchAll(raw)) {
      hits.push({ table, verb: m[1]!.toLowerCase().split(/\s+/)[0]!, line: lineOf(code, m.index!), via: "sql" });
    }
  }
  return { hits, code };
}

const EMISSION_RE = /\bcacheBus\s*\.\s*(invalidate|afterWrite)\b|\bcacheBus\s*\n?\s*\.\s*(invalidate|afterWrite)\b/;

/** `// cache-guard: reason` within 12 lines before / 3 lines after the write. */
function hasGuardComment(raw: string, line: number): boolean {
  const lines = raw.split("\n");
  const from = Math.max(0, line - 1 - 12);
  const to = Math.min(lines.length, line + 3);
  return lines.slice(from, to).some((l) => /\/\/\s*cache-guard:\s*\S+/.test(l));
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|mts|cts)$/.test(name) && !name.endsWith(".d.ts")) acc.push(p);
  }
  return acc;
}

interface FileScan {
  rel: string;
  raw: string;
  hits: WriteHit[];
  code: string;
}

function scanTree(): FileScan[] {
  const out: FileScan[] = [];
  for (const file of walk(SRC)) {
    const raw = readFileSync(file, "utf8");
    const { hits, code } = findWrites(raw);
    if (hits.length) out.push({ rel: relative(SRC, file).split(sep).join("/"), raw, hits, code });
  }
  return out;
}

// ─── tests ─────────────────────────────────────────────────────────────────

describe("cache write guard: scanner", () => {
  it("finds Drizzle writes incl. multi-line, namespaced and aliased tables", () => {
    const src = `
      import { tenantMembers as tm, users } from "@hisaabo/db";
      await db.insert(tm).values({});
      await db
        .update(
          users,
        ).set({});
      await tx.delete(schema.tenants).where(x);
      await db.select().from(users);
    `;
    const { hits } = findWrites(src);
    const got = hits.map((h) => `${h.table}:${h.verb}`).sort();
    expect(got).toEqual(["tenant_members:insert", "tenants:delete", "users:update"]);
  });

  it("finds raw SQL writes with quoting / schema prefix, case-insensitive", () => {
    const src = [
      "await sql`INSERT INTO store_slugs (slug) VALUES (1)`;",
      'await sql`update "public"."tenant_members" set role = 1`;',
      'await c.query("DELETE   FROM sessions WHERE x");',
      "await sql`SELECT * FROM users`;",
    ].join("\n");
    const got = findWrites(src).hits.map((h) => `${h.table}:${h.verb}`).sort();
    expect(got).toEqual(["sessions:delete", "store_slugs:insert", "tenant_members:update"]);
  });

  it("ignores comments, regex literals and non-guarded verbs on businesses", () => {
    const src = `
      // db.insert(users)
      /* db.delete(sessions)
         INSERT INTO tenants */
      const r = /"/g; const s = x.replace(/"/g, "&quot;");
      await db.update(businesses).set({});
      await db.insert(businesses).values({});
    `;
    const got = findWrites(src).hits.map((h) => `${h.table}:${h.verb}`);
    expect(got).toEqual(["businesses:insert"]);
  });

  it("sees writes after a template literal with nested expressions", () => {
    const src = "const q = `a ${fn(`b ${c}`)} // not a comment`;\nawait db.delete(sessions);";
    expect(findWrites(src).hits.map((h) => h.table)).toEqual(["sessions"]);
  });

  it("keeps line numbers stable when stripping comments", () => {
    const src = "/* a\n b */\n// c\nawait db.insert(users);";
    expect(findWrites(src).hits[0]!.line).toBe(4);
  });
});

describe("cache write guard: packages/api/src", () => {
  const scans = scanTree();

  it("every writer of a cached table is allowlisted", () => {
    const violations: string[] = [];
    for (const f of scans) {
      for (const table of new Set(f.hits.map((h) => h.table))) {
        if (!(ALLOWED_WRITERS[table] ?? []).includes(f.rel)) {
          const lines = f.hits.filter((h) => h.table === table).map((h) => h.line).join(", ");
          violations.push(`  ${f.rel} writes "${table}" (line ${lines})`);
        }
      }
    }
    expect(
      violations,
      [
        "Unregistered writer(s) of cached tables:",
        ...violations,
        "",
        "Cached tables are read through TTL caches (sessions, API keys, authz, slug registry, maintenance).",
        "A writer that does not invalidate leaves stale allows until the TTL expires. To fix:",
        "  1. After the write settles, emit the matching event:",
        "       await cacheBus.afterWrite([{ kind: 'membership', tenantId, userId }], () => write)",
        "     (or cacheBus.invalidate(...)); see src/lib/cache/bus.ts for the event kinds.",
        "  2. Add the file under the table in ALLOWED_WRITERS in this test.",
        "  3. If the write must NOT invalidate (hot-path last_used_at bump, expiry sweep, CLI",
        "     process covered by the DB triggers), add `// cache-guard: <reason>` next to it.",
        "See docs/architecture/caching.md (\"Adding a cached entity\").",
      ].join("\n"),
    ).toEqual([]);
  });

  it("allowlisted writers emit a cacheBus event or carry a // cache-guard: reason", () => {
    const problems: string[] = [];
    for (const f of scans) {
      const tablesHere = new Set(f.hits.map((h) => h.table));
      const allowed = [...tablesHere].filter((t) => (ALLOWED_WRITERS[t] ?? []).includes(f.rel));
      if (allowed.length === 0) continue;
      const emits = EMISSION_RE.test(f.code);
      if (emits) continue;
      for (const h of f.hits) {
        if (!allowed.includes(h.table)) continue;
        if (!hasGuardComment(f.raw, h.line)) {
          problems.push(`  ${f.rel}:${h.line} ${h.verb} ${h.table}: no cacheBus.invalidate/afterWrite in file and no "// cache-guard: <reason>" nearby`);
        }
      }
    }
    expect(problems, ["Writers without invalidation:", ...problems].join("\n")).toEqual([]);
  });

  it("allowlist has no stale entries (file no longer writes the table)", () => {
    const actual = new Set(scans.flatMap((f) => f.hits.map((h) => `${h.table}|${f.rel}`)));
    const stale: string[] = [];
    for (const [table, files] of Object.entries(ALLOWED_WRITERS)) {
      for (const file of files) if (!actual.has(`${table}|${file}`)) stale.push(`  ${table}: ${file}`);
    }
    expect(stale, ["Remove stale ALLOWED_WRITERS entries:", ...stale].join("\n")).toEqual([]);
  });

  it("every guarded table has an allowlist entry", () => {
    expect(Object.keys(GUARDED).sort()).toEqual(Object.keys(ALLOWED_WRITERS).sort());
  });
});
