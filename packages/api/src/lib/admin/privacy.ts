/**
 * privacy.ts — PII masking for the admin dashboard.
 *
 * The dashboard masks personal data by default so a screenshot can be
 * shared without leaking who the customers are. `--reveal` (or the `p` key)
 * shows the real values. Masking is a pure transform over PlatformStats;
 * screens never know whether they are rendering masked or real data.
 *
 * What counts as PII here: tenant names, slugs and database names, user
 * emails and names, and any of those strings echoed inside error messages.
 * Where the databases live is masked too: tenant DB host and port (the
 * `dbHost`/`dbPort` columns, the `host:port/db` key, the same text inside
 * connection errors and the footer, and database user names in auth errors).
 * Counts, amounts, plans, statuses and other infrastructure facts stay visible.
 */

import type { PlatformStats, TenantWithMetrics } from "./stats.js";

const DOT = "•";
/** Stand-in for a tenant database port. */
export const MASKED_PORT = DOT.repeat(3);

function bullets(n: number): string {
  return DOT.repeat(Math.min(6, Math.max(2, n)));
}

/** Keep the first `keep` characters, bullet the rest: "sharma" → "sh••••" */
export function maskWord(word: string, keep = 1): string {
  if (!word) return word;
  const head = [...word].slice(0, keep).join("");
  return head + bullets([...word].length - keep);
}

/** "Verma Electricals" → "V•••• E••••••" (one initial per word). */
export function maskName(name: string | null | undefined): string {
  if (!name) return name ?? "";
  return name.trim().split(/\s+/).map((w) => maskWord(w, 1)).join(" ");
}

/** "priya@sharmatraders.in" → "pr•••@sh••••••.in" (keeps the TLD). */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return maskWord(email, 2);
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const parts = domain.split(".");
  const tld = parts.length > 1 ? "." + parts.pop() : "";
  return `${maskWord(local, 2)}@${maskWord(parts.join("."), 2)}${tld}`;
}

/**
 * Stable, non-identifying handle for a tenant derived from its id: "3f9a2c".
 * FNV-1a over the whole id, so sequential or structured ids still get
 * distinct handles and the same tenant always gets the same one.
 */
export function tenantHandle(id: string): string {
  let h = 0x811c9dc5;
  for (const ch of id) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(-6);
}

/** "tenant_sharma_traders" → "tenant_••••••"; keeps a leading tenant_ prefix. */
export function maskDbName(name: string | null): string | null {
  if (!name) return name;
  const m = /^(tenant_)(.+)$/.exec(name);
  return m ? m[1] + bullets(m[2].length) : maskWord(name, 1);
}

/** Replace every occurrence of a tenant's identifying strings inside free text. */
function scrub(text: string | null, replacements: [string, string][]): string | null {
  if (!text) return text;
  let out = text;
  for (const [from, to] of replacements) {
    if (from.length >= 3) out = out.split(from).join(to);
  }
  return out;
}

// ── Where the databases live ────────────────────────────────────

/** "db-host-3f9a2c": a tenant database host, masked with the same handle as the tenant. */
export function maskHost(host: string | null, tenantId: string): string | null {
  return host ? `db-host-${tenantHandle(tenantId)}` : host;
}

/** `host:port/db`, rebuilt from masked parts the same way stats.ts builds the real key. "control" stays. */
export function maskDbKey(t: Pick<TenantWithMetrics, "id" | "dbKey" | "dbName" | "dbHost" | "dbPort">): string {
  if (t.dbKey === "control" || !t.dbName) return t.dbKey;
  const server = [maskHost(t.dbHost, t.id), t.dbPort ? MASKED_PORT : null].filter(Boolean).join(":");
  return `${server ? server + "/" : ""}${maskDbName(t.dbName)}`;
}

/**
 * Connection details that are unmistakable wherever they appear (so safe to
 * strip from any free text, including job failure messages): URLs with
 * credentials, the address node/postgres.js put in socket errors, bare IPv4
 * addresses, and database user / role names in auth errors.
 */
export function maskConnectionInfo(text: string): string {
  return text
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi, "postgres://•••")
    // `connect ECONNREFUSED 10.0.0.5:5432`, `write CONNECT_TIMEOUT db.internal:5432`, `getaddrinfo ENOTFOUND db`
    .replace(/\b(ENOTFOUND|EAI_AGAIN)\s+[^\s,;()"']+/g, "$1 •••")
    .replace(
      /\b(ECONNREFUSED|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|ENETUNREACH|EADDRNOTAVAIL|CONNECT_TIMEOUT)\s+(?=[^\s,;()"']*(?::\d|\.[A-Za-z0-9]))[^\s,;()"']+/g,
      "$1 •••",
    )
    .replace(/\bat "[^"]+"(?: \([^)]*\))?, port \d+/g, "at •••")
    .replace(/\[[0-9a-fA-F:.]{2,}\](?::\d{1,5})?/g, "•••")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g, "•••")
    .replace(/\b(for user|role|user) "[^"]*"/g, '$1 "•••"');
}

/**
 * Anything shaped like `host:port` or `host:port/db`. Only for text that is
 * known to come from a database connection or query (tenant and database
 * errors, the footer): in free text a token like `ErrorCode:2150` is data.
 */
export function maskHostPorts(text: string): string {
  return text.replace(/(?<![\w.-])(?=[A-Za-z0-9._-]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9._-]*:\d{3,5}(?:\/[A-Za-z0-9_]+)?(?!\w)/g, "•••");
}

/**
 * Scrub an error that came from connecting to or querying a database but is
 * not tied to a known tenant (a failed control query, a crash): connection
 * details of every shape, never the real host:port.
 */
export function maskErrorText(text: string): string {
  return maskHostPorts(maskConnectionInfo(text));
}

interface TenantMask {
  name: string;
  slug: string;
  dbName: string | null;
  dbHost: string | null;
  dbPort: string | null;
  dbKey: string;
}

function tenantMask(t: TenantWithMetrics): TenantMask {
  const handle = tenantHandle(t.id);
  return {
    name: `Tenant ${handle}`,
    slug: handle,
    dbName: maskDbName(t.dbName),
    dbHost: maskHost(t.dbHost, t.id),
    dbPort: t.dbPort ? MASKED_PORT : t.dbPort,
    dbKey: maskDbKey(t),
  };
}

type Pairs = [string, string][];
const longestFirst = (a: [string, string], b: [string, string]) => b[0].length - a[0].length;

interface Scrubber {
  /** Text from a database connection or query (tenant/database errors, the footer): real identifiers, then anything shaped like an address. */
  dbError(text: string | null): string | null;
  /** Free text that is not a database error (job failures, ops messages); here `ErrorCode:2150` is data, so only unmistakable connection details go. */
  free(text: string | null): string | null;
}

/**
 * Replacement tables for a set of tenants. Order matters and is fixed: the
 * whole `host:port/db` key before the `host:port` inside it before the names,
 * each longest-first so one tenant's string is never cut out of another's, and
 * a bare host last (it is the most likely to collide with ordinary words).
 */
function makeScrubber(tenants: TenantWithMetrics[], masks: TenantMask[]): Scrubber {
  const keys: Pairs = [];
  const hostPorts: Pairs = [];
  const names: Pairs = [];
  const bareHosts: Pairs = [];
  tenants.forEach((t, i) => {
    const m = masks[i];
    if (t.dbKey && t.dbKey !== "control") keys.push([t.dbKey, m.dbKey]);
    if (t.dbHost && t.dbPort) hostPorts.push([`${t.dbHost}:${t.dbPort}`, `${m.dbHost}:${MASKED_PORT}`]);
    names.push([t.dbName ?? "", m.dbName ?? ""], [t.name, m.name], [t.slug, m.slug]);
    if (t.dbHost) bareHosts.push([t.dbHost, m.dbHost ?? ""]);
  });
  const known: Pairs = [...keys.sort(longestFirst), ...hostPorts.sort(longestFirst), ...names.sort(longestFirst)];
  bareHosts.sort(longestFirst);
  return {
    dbError(text) {
      if (!text) return text;
      // Unmistakable connection details first: a lower-case "postgres" host must not
      // be replaced inside a postgres:// URL before the URL itself is recognised.
      let out = maskConnectionInfo(text);
      out = scrub(out, known) ?? out;
      out = scrub(out, bareHosts) ?? out;
      return maskHostPorts(out);
    },
    free(text) {
      if (!text) return text;
      return maskFreeText(scrub(maskConnectionInfo(text), known) ?? text);
    },
  };
}

export function maskTenant(t: TenantWithMetrics): TenantWithMetrics {
  const m = tenantMask(t);
  return {
    ...t,
    name: m.name,
    slug: m.slug,
    dbName: m.dbName,
    dbHost: m.dbHost,
    dbPort: m.dbPort,
    dbKey: m.dbKey,
    error: makeScrubber([t], [m]).dbError(t.error),
  };
}

/** Deep-copy `stats` with all PII masked. The input is never mutated. */
export function maskStats(stats: PlatformStats): PlatformStats {
  const tenants = stats.tenants.map(maskTenant);
  const masks = stats.tenants.map(tenantMask);
  const scrubber = makeScrubber(stats.tenants, masks);
  const dbError = scrubber.dbError;
  const free = (s: string) => scrubber.free(s) ?? s;
  return {
    ...stats,
    control: {
      ...stats.control,
      tenants: tenants.map(({ dbKey: _k, sharedDb: _s, metrics: _m, error: _e, ...row }) => row),
      recentUsers: stats.control.recentUsers.map((u) => ({
        ...u,
        email: maskEmail(u.email),
        name: u.name ? maskName(u.name) : u.name,
      })),
      maintenance: stats.control.maintenance,
    },
    tenants,
    dbs: stats.dbs.map((d) => {
      const idx = d.tenantId ? stats.tenants.findIndex((t) => t.id === d.tenantId) : -1;
      return {
        ...d,
        // A tenant database's key is its (real) host:port/db: rebuild it from masked parts.
        key: d.key === "control" ? d.key : idx >= 0 ? tenants[idx].dbKey : dbError(d.key) ?? d.key,
        name: d.kind === "control" ? d.name : maskDbName(d.name) ?? d.name,
        tenantName: d.tenantName ? (idx >= 0 ? tenants[idx].name : `Tenant ${tenantHandle(d.tenantId ?? "")}`) : d.tenantName,
        error: dbError(d.error),
      };
    }),
    failures: stats.failures.map((f) => {
      const idx = stats.tenants.findIndex((t) => t.id === f.tenantId);
      return {
        ...f,
        tenantName: f.tenantName ? (idx >= 0 ? tenants[idx].name : `Tenant ${tenantHandle(f.tenantId)}`) : "",
        // Invoice and order numbers are business references, not PII; template
        // names and statement file names can carry party names, so mask those.
        ref: f.kind === "recurring" || f.kind === "bank_import" ? maskWord(f.ref, 3) : f.ref,
        message: free(f.message),
      };
    }),
    queues: {
      ...stats.queues,
      error: stats.queues.error ? maskFreeText(dbError(stats.queues.error) ?? stats.queues.error) : null,
      // Container hostnames identify infrastructure, not people, but are kept
      // out of shareable snapshots all the same.
      workers: stats.queues.workers.map((w) => ({ ...w, host: maskWord(w.host, 3) })),
      recentFailures: stats.queues.recentFailures.map((f) => ({
        ...f,
        tenantId: f.tenantId ? tenantHandle(f.tenantId) : null,
        tenantName: f.tenantId ? `Tenant ${tenantHandle(f.tenantId)}` : null,
        error: free(f.error),
      })),
    },
    errors: stats.errors.map((e) => dbError(e) ?? e),
  };
}

const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?<!\d)(?:\+91[\s-]?)?[6-9]\d{9}(?!\d)/g;

/**
 * Mask identifiers that tend to show up inside error messages: GSTINs, emails,
 * Indian mobile numbers, and unmistakable connection details (connection URLs,
 * the address in a socket error, IP addresses, database user names).
 */
export function maskFreeText(text: string): string {
  return maskConnectionInfo(text)
    .replace(GSTIN_RE, (g) => g.slice(0, 2) + DOT.repeat(11) + g.slice(-2))
    .replace(EMAIL_RE, (e) => maskEmail(e))
    .replace(PHONE_RE, (ph) => ph.slice(0, 2) + DOT.repeat(ph.length - 2));
}
