/**
 * Cross-process cache invalidation triggers (control DB tables only).
 *
 * SINGLE SOURCE OF TRUTH. The committed custom migrations in drizzle/ and
 * drizzle-control/ are generated from `renderCacheTriggerMigration()` (see
 * scripts/gen-cache-trigger-migration.ts) and a drift test asserts they match.
 * `db:push` databases (CI, dev) never run SQL migrations, so tests and ops
 * can also call `installCacheTriggers(sql)` directly.
 *
 * Each trigger emits `pg_notify('cache_invalidate', <json>)` AFTER the row
 * change, which Postgres delivers only on COMMIT (rollbacks never notify).
 *
 * Payload shape: {"t":"<table>","op":"INSERT|UPDATE|DELETE","k":{<col>:<value>},"o":{<col>:<old value>}}
 *   - `k` = the listed key columns (new value, or old value on DELETE)
 *   - `o` = only present for columns whose value changed (old value, so the
 *     consumer can also drop entries keyed by the previous value)
 *
 * PAYLOAD SAFETY: only identifiers are ever included (uuids, a config key
 * name, a slug). Never credentials, key hashes, emails, or session tokens.
 * The `sessions.id` column IS the secret session token (cookie value /
 * refresh token), so session triggers carry user_id + tenant_id only and the
 * consumer invalidates by user. api_keys carries the key row id (uuid), not
 * key_hash.
 *
 * HOT-PATH SAFETY: sessions.last_used_at / sliding expiry bumps (about once
 * a minute per active session) and api_keys.last_used_at must NOT notify.
 * This is enforced with WHEN clauses (sessions) and UPDATE OF column lists
 * (api_keys, users, tenants), and covered by tests.
 */
import type { Sql } from "postgres";

export const CACHE_NOTIFY_CHANNEL = "cache_invalidate";
export const CACHE_NOTIFY_FUNCTION = "hisaabo_cache_notify";

const FUNCTION_SQL = `CREATE OR REPLACE FUNCTION ${CACHE_NOTIFY_FUNCTION}() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  k jsonb := '{}'::jsonb;
  o jsonb := '{}'::jsonb;
  nj jsonb;
  oj jsonb;
  i int;
  col text;
  p jsonb;
BEGIN
  IF TG_OP <> 'DELETE' THEN nj := to_jsonb(NEW); END IF;
  IF TG_OP <> 'INSERT' THEN oj := to_jsonb(OLD); END IF;
  FOR i IN 0 .. TG_NARGS - 1 LOOP
    col := TG_ARGV[i];
    k := k || jsonb_build_object(col, coalesce(nj -> col, oj -> col));
    IF nj IS NOT NULL AND oj IS NOT NULL AND (oj -> col) IS DISTINCT FROM (nj -> col) THEN
      o := o || jsonb_build_object(col, oj -> col);
    END IF;
  END LOOP;
  p := jsonb_build_object('t', TG_TABLE_NAME, 'op', TG_OP, 'k', k);
  IF o <> '{}'::jsonb THEN p := p || jsonb_build_object('o', o); END IF;
  PERFORM pg_notify('${CACHE_NOTIFY_CHANNEL}', p::text);
  RETURN NULL;
END
$$`;

export interface CacheTriggerSpec {
  table: string;
  trigger: string;
  /** Everything after `CREATE TRIGGER <name>` up to and including EXECUTE FUNCTION. */
  body: string;
}

const fn = (...cols: string[]) =>
  `EXECUTE FUNCTION ${CACHE_NOTIFY_FUNCTION}(${cols.map((c) => `'${c}'`).join(", ")})`;

/** Expected triggers, in install order. */
export const expectedCacheTriggers: readonly CacheTriggerSpec[] = [
  {
    // authz bundle: role, creator membership, active-membership
    table: "tenant_members",
    trigger: "hisaabo_cache_tenant_members",
    body: `AFTER INSERT OR UPDATE OR DELETE ON tenant_members FOR EACH ROW ${fn("tenant_id", "user_id")}`,
  },
  {
    // authz bundle (status), plan cache
    table: "tenants",
    trigger: "hisaabo_cache_tenants",
    body: `AFTER UPDATE OF status, plan OR DELETE ON tenants FOR EACH ROW ${fn("id")}`,
  },
  {
    // Deleting an already-expired session (hourly cleanup) cannot change any
    // cached outcome, so it is filtered out to avoid bulk-delete churn.
    table: "sessions",
    trigger: "hisaabo_cache_sessions_del",
    body: `AFTER DELETE ON sessions FOR EACH ROW WHEN (OLD.expires_at > now()) ${fn("user_id", "tenant_id")}`,
  },
  {
    // Only security-relevant updates: tenant switch, owner change, expiry
    // shortened. last_used_at and sliding-expiry extension do NOT notify.
    table: "sessions",
    trigger: "hisaabo_cache_sessions_upd",
    body: `AFTER UPDATE ON sessions FOR EACH ROW WHEN (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.user_id <> NEW.user_id OR NEW.expires_at < OLD.expires_at) ${fn("user_id", "tenant_id")}`,
  },
  {
    // email/name are embedded in cached session / api key entries
    table: "users",
    trigger: "hisaabo_cache_users",
    body: `AFTER UPDATE OF email, name OR DELETE ON users FOR EACH ROW ${fn("id")}`,
  },
  {
    // immediate revocation; last_used_at is deliberately not in the column list
    table: "api_keys",
    trigger: "hisaabo_cache_api_keys",
    body: `AFTER DELETE OR UPDATE OF key_hash, user_id, tenant_id, expires_at ON api_keys FOR EACH ROW ${fn("id", "user_id", "tenant_id")}`,
  },
  {
    // maintenance mode is toggled by a CLI in another process
    table: "system_config",
    trigger: "hisaabo_cache_system_config",
    body: `AFTER INSERT OR UPDATE OR DELETE ON system_config FOR EACH ROW ${fn("key")}`,
  },
  {
    // storefront slug caches (slug registry); slug is public, not a secret
    table: "store_slugs",
    trigger: "hisaabo_cache_store_slugs",
    body: `AFTER INSERT OR UPDATE OR DELETE ON store_slugs FOR EACH ROW ${fn("slug")}`,
  },
];

/** Every statement, one per array entry, in install order (no trailing semicolons). */
export const CACHE_TRIGGER_STATEMENTS: readonly string[] = [
  FUNCTION_SQL,
  ...expectedCacheTriggers.flatMap((t) => [
    `DROP TRIGGER IF EXISTS ${t.trigger} ON ${t.table}`,
    `CREATE TRIGGER ${t.trigger} ${t.body}`,
  ]),
];

export const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

/**
 * Text of the custom drizzle migration. Statements are separated by
 * drizzle's breakpoint marker so both drizzle's migrator and the lenient
 * migrator in migrate.ts (which splits on it) handle `$$` bodies.
 */
export function renderCacheTriggerMigration(): string {
  return CACHE_TRIGGER_STATEMENTS.map((s) => `${s};`).join(`\n${STATEMENT_BREAKPOINT}\n`) + "\n";
}

/** Install (or re-install) the function and all triggers atomically. Idempotent. */
export async function installCacheTriggers(sql: Sql): Promise<void> {
  await sql.begin(async (tx) => {
    for (const stmt of CACHE_TRIGGER_STATEMENTS) {
      await tx.unsafe(stmt);
    }
  });
}

/** Check that the notify function and every expected trigger exist and are enabled. */
export async function verifyCacheTriggers(sql: Sql): Promise<{ ok: boolean; missing: string[] }> {
  const missing: string[] = [];

  const fnRows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE p.proname = ${CACHE_NOTIFY_FUNCTION} AND ns.nspname = current_schema()
  `;
  if (!fnRows[0] || fnRows[0].n === 0) missing.push(`function:${CACHE_NOTIFY_FUNCTION}`);

  const rows = await sql<{ table_name: string; trigger_name: string }[]>`
    SELECT c.relname AS table_name, t.tgname AS trigger_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE NOT t.tgisinternal AND t.tgenabled <> 'D' AND ns.nspname = current_schema()
  `;
  const present = new Set(rows.map((r) => `${r.table_name}.${r.trigger_name}`));
  for (const t of expectedCacheTriggers) {
    if (!present.has(`${t.table}.${t.trigger}`)) missing.push(`${t.table}.${t.trigger}`);
  }
  return { ok: missing.length === 0, missing };
}
