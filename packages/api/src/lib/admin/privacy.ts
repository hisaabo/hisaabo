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

import type { PlatformStats, TenantWithMetrics, TenantMetrics, OpsFailure } from "./stats.js";

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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One-pass replacer for identifying strings (names, slugs, db names, hosts, keys).
 * A string only matches as a whole token, `(?<![\w.-])x(?![\w-])`, so a tenant
 * called "err" or a host called "postgres" never rewrites the middle of
 * "error" or "/var/run/postgresql". Longest first, so a whole `host:port/db`
 * key wins over the host or db name inside it; strings under 3 characters are
 * ignored; for duplicates the first pair wins.
 */
function makeReplacer(pairs: [string, string][]): (text: string) => string {
  const map = new Map<string, string>();
  for (const [from, to] of pairs) if (from.length >= 3 && !map.has(from)) map.set(from, to);
  if (map.size === 0) return (text) => text;
  const alternatives = [...map.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
  const re = new RegExp(`(?<![\\w.-])(?:${alternatives.join("|")})(?![\\w-])`, "g");
  return (text) => text.replace(re, (m) => map.get(m) ?? m);
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
 * strip from any free text, including job failure messages): database URLs,
 * the credentials and query string of any URL, the address node/postgres.js put
 * in socket errors, `host "x"` in Postgres' own messages, TLS certificate names
 * (CN=, DNS:), HTTP Host headers, IP addresses (v4, bracketed and bare v6) and
 * database user / role names in auth errors.
 */
export function maskConnectionInfo(text: string): string {
  return (
    text
      // The placeholder has no "postgres" in it: a later bare-host pass must not rewrite it.
      .replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi, "db://•••")
      .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@"'<>]*@/gi, "$1•••@")
      .replace(/\b([a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>]*)\?[^\s#"'<>]*/gi, "$1?•••")
      // `connect ECONNREFUSED 10.0.0.5:5432`, `write CONNECT_TIMEOUT db.internal:5432`, `getaddrinfo ENOTFOUND db`
      .replace(/\b(ENOTFOUND|EAI_AGAIN)\s+[^\s,;()"']+/g, "$1 •••")
      .replace(
        /\b(ECONNREFUSED|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|ENETUNREACH|EADDRNOTAVAIL|CONNECT_TIMEOUT)\s+(?=[^\s,;()"']*(?::\d|\.[A-Za-z0-9]))[^\s,;()"']+/g,
        "$1 •••",
      )
      // libpq: `connection to server at "db" (10.0.0.5), port 5432 failed`
      .replace(/\bat "[^"]+"(?: \([^)]*\))?, port \d+/g, "at •••")
      // Postgres: `could not translate host name "db" to address`, `Is the server running on host "db" (…)`
      .replace(/\bhost(?: name)? "[^"]*"/g, (m) => m.replace(/"[^"]*"/, '"•••"'))
      .replace(/\bHost:[ \t]*[^\s,;]+/g, "Host: •••")
      .replace(/\bCN=[^\s,;]+/g, "CN=•••")
      .replace(/\bDNS:[^\s,;]+/g, "DNS:•••")
      .replace(/\[[0-9a-fA-F:.]{2,}\](?::\d{1,5})?/g, "•••")
      // Bare IPv6: eight groups, or any `::` form (never a plain 10:30:00 time).
      .replace(/(?<![\w:])(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}(?![\w:])/g, "•••")
      .replace(/(?<![\w:.])(?:[0-9a-fA-F]{1,4}:){1,6}:(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,5})?(?![\w:])/g, "•••")
      .replace(/(?<![\w:.])::(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6})(?![\w:])/g, "•••")
      .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g, "•••")
      .replace(/\b(for user|role|user) "[^"]*"/g, '$1 "•••"')
  );
}

/**
 * Anything shaped like `host:port` or `host:port/db`. Only for text that is
 * known to come from a database connection or query (tenant and database
 * errors, the footer): in free text a token like `ErrorCode:2150` is data.
 */
export function maskHostPorts(text: string): string {
  return text.replace(/(?<![\w.-])(?=[A-Za-z0-9._-]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9._-]*:\d{3,5}(?:\/[A-Za-z0-9_]+)?(?!\w)/g, "•••");
}

export interface MaskOptions {
  /**
   * Host names the dashboard itself connects to (the control database), masked
   * wherever they appear in error text. They come from the runner, never from
   * PlatformStats, so they are not in the JSON snapshot to begin with.
   */
  hosts?: readonly string[];
}

const hostPairs = (hosts: readonly string[]): [string, string][] => hosts.map((h) => [h, "•••"]);

/**
 * Scrub an error that came from connecting to or querying a database but is
 * not tied to a known tenant (a failed control query, a crash): connection
 * details of every shape, never the real host:port. `hosts` are names the
 * runner knows it connects to.
 */
export function maskErrorText(text: string, hosts: readonly string[] = []): string {
  return maskHostPorts(makeReplacer(hostPairs(hosts))(maskConnectionInfo(text)));
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

interface Scrubber {
  /** Text from a database connection or query (tenant/database errors, the footer): real identifiers, then anything shaped like an address. */
  dbError(text: string | null): string | null;
  /** Free text that is not a database error (job failures, ops messages); here `ErrorCode:2150` is data, so only unmistakable connection details go. */
  free(text: string | null): string | null;
}

/**
 * Replacement tables for a set of tenants: whole `host:port/db` keys, `host:port`,
 * then names, slugs and db names (all whole-token matches, longest first), then
 * any bare host (the tenants' and the runner's own).
 */
function makeScrubber(tenants: TenantWithMetrics[], masks: TenantMask[], extraHosts: readonly string[] = []): Scrubber {
  const known: [string, string][] = [];
  const bareHosts: [string, string][] = [];
  tenants.forEach((t, i) => {
    const m = masks[i];
    if (t.dbKey && t.dbKey !== "control") known.push([t.dbKey, m.dbKey]);
    if (t.dbHost && t.dbPort) known.push([`${t.dbHost}:${t.dbPort}`, `${m.dbHost}:${MASKED_PORT}`]);
    known.push([t.dbName ?? "", m.dbName ?? ""], [t.name, m.name], [t.slug, m.slug]);
    if (t.dbHost) bareHosts.push([t.dbHost, m.dbHost ?? ""]);
  });
  bareHosts.push(...hostPairs(extraHosts));
  const replaceKnown = makeReplacer(known);
  const replaceBare = makeReplacer(bareHosts);
  // Unmistakable connection details first: a lower-case "postgres" host must not be
  // replaced inside a postgres:// URL before the URL itself is recognised.
  const scrubbed = (text: string) => replaceBare(replaceKnown(maskConnectionInfo(text)));
  return {
    dbError: (text) => (text ? maskHostPorts(scrubbed(text)) : text),
    free: (text) => (text ? maskFreeText(scrubbed(text)) : text),
  };
}

/** Invoice and order numbers are business references, not PII; template names and statement file names can carry party names. */
function maskFailureRef(f: Pick<OpsFailure, "kind" | "ref">): string {
  return f.kind === "recurring" || f.kind === "bank_import" ? maskWord(f.ref, 3) : f.ref;
}

/** A tenant's metrics with its per-tenant failure list masked like the platform-level one. Never mutates. */
function maskMetrics(m: TenantMetrics | null, free: (s: string) => string): TenantMetrics | null {
  if (!m) return m;
  return {
    ...m,
    ops: {
      ...m.ops,
      failures: m.ops.failures.map((f) => ({ ...f, ref: maskFailureRef(f), message: free(f.message) })),
    },
  };
}

function maskTenantWith(t: TenantWithMetrics, m: TenantMask, scrubber: Scrubber, metrics: (m: TenantMetrics | null) => TenantMetrics | null): TenantWithMetrics {
  return {
    ...t,
    name: m.name,
    slug: m.slug,
    dbName: m.dbName,
    dbHost: m.dbHost,
    dbPort: m.dbPort,
    dbKey: m.dbKey,
    metrics: metrics(t.metrics),
    error: scrubber.dbError(t.error),
  };
}

export function maskTenant(t: TenantWithMetrics, opts: MaskOptions = {}): TenantWithMetrics {
  const m = tenantMask(t);
  const scrubber = makeScrubber([t], [m], opts.hosts);
  return maskTenantWith(t, m, scrubber, (x) => maskMetrics(x, (s) => scrubber.free(s) ?? s));
}

/** Deep-copy `stats` with all PII masked. The input is never mutated. */
export function maskStats(stats: PlatformStats, opts: MaskOptions = {}): PlatformStats {
  const masks = stats.tenants.map(tenantMask);
  const scrubber = makeScrubber(stats.tenants, masks, opts.hosts);
  const dbError = scrubber.dbError;
  const free = (s: string) => scrubber.free(s) ?? s;
  // Shared-db mode: several tenant rows point at one metrics object; keep them sharing one masked copy.
  const maskedMetrics = new WeakMap<TenantMetrics, TenantMetrics>();
  const metricsFor = (m: TenantMetrics | null): TenantMetrics | null => {
    if (!m) return m;
    let out = maskedMetrics.get(m);
    if (!out) maskedMetrics.set(m, (out = maskMetrics(m, free) as TenantMetrics));
    return out;
  };
  const tenants = stats.tenants.map((t, i) => maskTenantWith(t, masks[i], scrubber, metricsFor));
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
        ref: maskFailureRef(f),
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
const PAN_RE = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?<!\d)(?:\+91[\s-]?)?[6-9]\d{9}(?!\d)/g;

/**
 * Mask identifiers that tend to show up inside error messages: GSTINs, PANs,
 * emails, Indian mobile numbers, and unmistakable connection details
 * (database URLs, URL credentials and query strings, the address in a socket
 * error, IP addresses, database user names).
 */
export function maskFreeText(text: string): string {
  return maskConnectionInfo(text)
    .replace(GSTIN_RE, (g) => g.slice(0, 2) + DOT.repeat(11) + g.slice(-2))
    .replace(PAN_RE, (p) => p.slice(0, 2) + DOT.repeat(7) + p.slice(-1))
    .replace(EMAIL_RE, (e) => maskEmail(e))
    .replace(PHONE_RE, (ph) => ph.slice(0, 2) + DOT.repeat(ph.length - 2));
}
