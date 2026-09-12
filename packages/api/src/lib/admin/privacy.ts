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
 * Counts, amounts, plans, statuses and infrastructure facts stay visible.
 */

import type { PlatformStats, TenantWithMetrics } from "./stats.js";

const DOT = "•";

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

export function maskTenant(t: TenantWithMetrics): TenantWithMetrics {
  const handle = tenantHandle(t.id);
  const name = `Tenant ${handle}`;
  const slug = handle;
  const dbName = maskDbName(t.dbName);
  const pairs: [string, string][] = [
    [t.dbName ?? "", dbName ?? ""],
    [t.name, name],
    [t.slug, slug],
  ];
  return {
    ...t,
    name,
    slug,
    dbName,
    dbKey: scrub(t.dbKey, pairs) ?? t.dbKey,
    error: scrub(t.error, pairs),
  };
}

/** Deep-copy `stats` with all PII masked. The input is never mutated. */
export function maskStats(stats: PlatformStats): PlatformStats {
  const tenants = stats.tenants.map(maskTenant);
  const pairs: [string, string][] = stats.tenants.flatMap((t, i) => [
    [t.dbName ?? "", tenants[i].dbName ?? ""] as [string, string],
    [t.name, tenants[i].name] as [string, string],
    [t.slug, tenants[i].slug] as [string, string],
  ]);
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
    errors: stats.errors.map((e) => scrub(e, pairs) ?? e),
  };
}
