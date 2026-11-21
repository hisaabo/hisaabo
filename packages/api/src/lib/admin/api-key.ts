/**
 * api-key.ts — `admin api-key create|list|revoke`: operator-issued API keys.
 *
 * WHY: API access is a paid feature and most customers use WebMCP, so keys are
 * issued case by case. Support and sales need to hand a customer a working key
 * without impersonating them in the web app. Like `login-link` this is
 * shell-only: there is no HTTP route to it, it runs in the API container (or a
 * dev checkout) with the control-database credentials, and shell access is the
 * authority. It never creates users or tenants.
 *
 * A key acts WITH THE USER'S AUTHORITY, so it can only be minted for a user who
 * is an owner, superadmin or admin of the tenant (the same gate the web app
 * applies to "create API key", ADMIN_ROLES) and who can reach an active tenant.
 * Everything else is the shared code path: lib/api-keys.ts generates, hashes
 * and stores the key and raises the locked "API key created" security alert
 * the tenant's owners and admins receive; lib/plan-limits.ts enforces the
 * plan's key allowance unless the operator passes --override-plan.
 *
 * AUDIT: there is no platform-level audit table (audit_log is per business, in
 * the tenant database). The trail is the key row itself (created_at, name, the
 * tenant's "API key created" alert), a stderr line printed here, and a
 * structured security event (`api_key_operator_issued` / `_revoked`, ids only).
 * The raw key is printed once on stdout and is never logged.
 *
 * Works in multi-tenant mode: users, tenants, memberships and api_keys live in
 * the control database (CONTROL_DATABASE_URL, else DATABASE_URL).
 */

import { createApiKeySchema, revokeApiKeySchema } from "@hisaabo/shared";
import { emailEq, normalizeEmail } from "../normalize-email.js";
import { maskEmail, tenantHandle } from "./privacy.js";
import { logSecurityEvent } from "../logger.js";
import { deriveOnceDatabaseUrl } from "./login-link.js";

/** Who the tenant's "API key created" alert says created an operator-issued key. */
export const OPERATOR_LABEL = "Hisaabo operator";
export const MAX_EXPIRES_DAYS = 365;

export const API_KEY_HELP = `
hisaabo admin api-key — issue, list and revoke API keys from the shell (operator only)

USAGE
  node packages/api/dist/bin/admin.js api-key create <email> --tenant <slug|id> --name "<label>" [options]
  node packages/api/dist/bin/admin.js api-key list <email> [--tenant <slug|id>] [--reveal]
  node packages/api/dist/bin/admin.js api-key revoke <key-id>

Run it inside the API container, where DATABASE_URL is set:

  docker compose --env-file .env.prod -f docker-compose.prod.yml exec api \\
    node packages/api/dist/bin/admin.js api-key create owner@example.com --tenant acme --name "MCP server"

create OPTIONS
  --tenant <slug|id>     Organisation the key belongs to (required)
  --name "<label>"       Display label, 1-100 characters (required)
  --expires-days <n>     Lifetime in days, 1-${MAX_EXPIRES_DAYS} (default: 90)
  --override-plan        Issue the key even if the tenant's plan has no API keys or the key
                         allowance is used up. Logged as a plan override.

list OPTIONS
  --tenant <slug|id>     Only that organisation's keys
  --reveal               Show the real tenant name and slug (default: masked, "Tenant 3f9a2c")

A key acts with the authority of the user it is issued to: it can do whatever that
user can in the organisation, so only owners, superadmins and admins can hold one.
The raw key is printed once; only its hash is stored, and it cannot be shown again.
Never prints a stored key or hash. Tenant owners and admins are alerted ("API key
created"); the alert names "${OPERATOR_LABEL}" as the creator.
`;

export type ApiKeyCommand = "create" | "list" | "revoke";

export interface ApiKeyArgs {
  command: ApiKeyCommand | null;
  email: string | null;
  keyId: string | null;
  tenant: string | null;
  name: string | null;
  expiresDays: number | null;
  overridePlan: boolean;
  reveal: boolean;
  help: boolean;
}

/** An operator-facing failure: printed as one line, exit code 1. */
export class ApiKeyCommandError extends Error {}

export function parseApiKeyArgs(argv: string[]): ApiKeyArgs {
  const a: ApiKeyArgs = {
    command: null, email: null, keyId: null, tenant: null, name: null, expiresDays: null,
    overridePlan: false, reveal: false, help: false,
  };
  const value = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined) throw new Error(`${flag} needs a value`);
    return v;
  };
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h": case "--help": a.help = true; break;
      case "--tenant": a.tenant = value(i++, arg).trim(); break;
      case "--name": a.name = value(i++, arg); break;
      case "--expires-days": {
        const raw = value(i++, arg);
        const n = Number(raw);
        if (!/^\d+$/.test(raw.trim()) || n < 1 || n > MAX_EXPIRES_DAYS) {
          throw new Error(`--expires-days must be a whole number between 1 and ${MAX_EXPIRES_DAYS}`);
        }
        a.expiresDays = n;
        break;
      }
      case "--override-plan": a.overridePlan = true; break;
      case "--reveal": case "--show-pii": a.reveal = true; break;
      default:
        if (arg.startsWith("-")) throw new Error(`unknown option ${arg} (try api-key --help)`);
        positionals.push(arg);
    }
  }
  if (a.help) return a;

  const [command, target, ...extra] = positionals;
  if (!command) throw new Error("api-key needs a subcommand: create, list or revoke (try api-key --help)");
  if (command !== "create" && command !== "list" && command !== "revoke") {
    throw new Error(`unknown api-key subcommand "${command}" (create, list or revoke)`);
  }
  if (extra.length > 0) throw new Error(`api-key ${command} takes exactly one ${command === "revoke" ? "key id" : "email address"}`);
  a.command = command;
  if (command === "revoke") {
    a.keyId = target ?? null;
    if (!a.keyId) throw new Error("api-key revoke needs a key id (see api-key list)");
    if (a.tenant || a.name || a.expiresDays !== null || a.overridePlan) throw new Error("api-key revoke takes only a key id");
  } else {
    a.email = target ?? null;
    if (!a.email) throw new Error(`api-key ${command} needs the user's email address`);
    if (command === "create") {
      if (!a.tenant) throw new Error("api-key create needs --tenant <slug|id>");
      if (a.name === null) throw new Error('api-key create needs --name "<label>"');
    } else if (a.name !== null || a.expiresDays !== null || a.overridePlan) {
      throw new Error("api-key list takes only an email, --tenant and --reveal");
    }
  }
  return a;
}

// ── Database access (loaded after the environment is settled) ───

type Deps = {
  db: typeof import("@hisaabo/db");
  orm: typeof import("drizzle-orm");
  keys: typeof import("../api-keys.js");
  plan: typeof import("../plan-limits.js");
  access: typeof import("../tenant-access.js");
  bus: typeof import("../cache/bus.js");
};

let depsPromise: Promise<Deps> | null = null;

/**
 * @hisaabo/db opens its connections when first imported, from DATABASE_URL, so
 * these imports must happen after runApiKey has derived it (ONCE image).
 */
function deps(): Promise<Deps> {
  depsPromise ??= (async () => ({
    db: await import("@hisaabo/db"),
    orm: await import("drizzle-orm"),
    keys: await import("../api-keys.js"),
    plan: await import("../plan-limits.js"),
    access: await import("../tenant-access.js"),
    bus: await import("../cache/bus.js"),
  }))();
  return depsPromise;
}

export interface IssuedKey {
  id: string;
  /** The raw key; shown once and never stored. */
  key: string;
  keyPrefix: string;
  name: string;
  expiresAt: Date | null;
  userId: string;
  email: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: string;
  planOverride: boolean;
  /** The tenant's plan when the key was issued (for the audit line). */
  plan: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TenantRef { id: string; slug: string; name: string; plan: string; status: string }

async function findUser(email: string): Promise<{ id: string; email: string }> {
  const { db } = await deps();
  const [row] = await db.controlDb.select({ id: db.users.id, email: db.users.email }).from(db.users).where(emailEq(db.users.email, email)).limit(1);
  if (!row) throw new ApiKeyCommandError(`no user with email ${normalizeEmail(email)}. api-key only works for existing users (it never creates accounts).`);
  return row;
}

async function findTenant(ref: string): Promise<TenantRef> {
  const { db, orm } = await deps();
  const cols = { id: db.tenants.id, slug: db.tenants.slug, name: db.tenants.name, plan: db.tenants.plan, status: db.tenants.status };
  if (UUID.test(ref)) {
    const [byId] = await db.controlDb.select(cols).from(db.tenants).where(orm.eq(db.tenants.id, ref.toLowerCase())).limit(1);
    if (byId) return byId;
  }
  const [bySlug] = await db.controlDb.select(cols).from(db.tenants).where(orm.eq(db.tenants.slug, ref)).limit(1);
  if (!bySlug) throw new ApiKeyCommandError(`no organisation with slug or id "${ref}"`);
  return bySlug;
}

/** Create a key for `email` in a tenant. Every refusal is an ApiKeyCommandError; nothing is written unless all checks pass. */
export async function issueApiKey(opts: {
  email: string;
  tenant: string;
  name: string;
  expiresDays?: number | null;
  overridePlan?: boolean;
}): Promise<IssuedKey> {
  const name = createApiKeySchema.shape.name.safeParse(opts.name);
  if (!name.success) throw new ApiKeyCommandError("--name must be 1-100 characters");

  const { db, orm, keys, plan, access } = await deps();
  const user = await findUser(opts.email);
  const tenant = await findTenant(opts.tenant);

  const [member] = await db.controlDb
    .select({ role: db.tenantMembers.role })
    .from(db.tenantMembers)
    .where(orm.and(orm.eq(db.tenantMembers.tenantId, tenant.id), orm.eq(db.tenantMembers.userId, user.id)))
    .limit(1);
  if (!member) {
    throw new ApiKeyCommandError(`${normalizeEmail(user.email)} is not a member of ${tenant.slug}. A key acts with the user's authority, so the user must be a member.`);
  }
  if (!access.hasRole(member.role, access.ADMIN_ROLES)) {
    throw new ApiKeyCommandError(
      `${normalizeEmail(user.email)} is "${member.role}" in ${tenant.slug}; API keys need ${access.ADMIN_ROLES.join(", ")}. ` +
        "A key acts with the user's authority, so it cannot be issued to a lower role.",
    );
  }
  if (tenant.status !== "active") {
    throw new ApiKeyCommandError(`${tenant.slug} is ${tenant.status}; a key for it would not authenticate.`);
  }

  if (!opts.overridePlan) {
    try {
      await plan.enforceApiKeyLimit(tenant.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new ApiKeyCommandError(`${msg} Pass --override-plan to issue the key anyway.`);
    }
  }

  const expiresAt = opts.expiresDays ? new Date(Date.now() + opts.expiresDays * 86_400_000) : undefined;
  const created = await keys.createApiKeyRecord({
    userId: user.id,
    tenantId: tenant.id,
    name: name.data,
    expiresAt,
    createdByName: OPERATOR_LABEL,
    actorUserId: null,
  });

  return {
    id: created.id,
    key: created.key,
    keyPrefix: created.keyPrefix,
    name: created.name,
    expiresAt: created.expiresAt,
    userId: user.id,
    email: normalizeEmail(user.email),
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    role: member.role,
    planOverride: Boolean(opts.overridePlan),
    plan: tenant.plan,
  };
}

export interface KeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
}

/** A user's keys (optionally one tenant's). Display-safe columns only: never the hash. */
export async function listApiKeys(opts: { email: string; tenant?: string | null }): Promise<{ user: { id: string; email: string }; keys: KeyRow[] }> {
  const { db, orm } = await deps();
  const user = await findUser(opts.email);
  const tenant = opts.tenant ? await findTenant(opts.tenant) : null;
  const rows = await db.controlDb
    .select({
      id: db.apiKeys.id,
      name: db.apiKeys.name,
      keyPrefix: db.apiKeys.keyPrefix,
      tenantId: db.apiKeys.tenantId,
      tenantSlug: db.tenants.slug,
      tenantName: db.tenants.name,
      createdAt: db.apiKeys.createdAt,
      lastUsedAt: db.apiKeys.lastUsedAt,
      expiresAt: db.apiKeys.expiresAt,
    })
    .from(db.apiKeys)
    .innerJoin(db.tenants, orm.eq(db.tenants.id, db.apiKeys.tenantId))
    .where(tenant ? orm.and(orm.eq(db.apiKeys.userId, user.id), orm.eq(db.apiKeys.tenantId, tenant.id)) : orm.eq(db.apiKeys.userId, user.id))
    .orderBy(orm.asc(db.apiKeys.createdAt));
  return { user, keys: rows };
}

export interface RevokedKey { id: string; name: string; keyPrefix: string; userId: string; tenantId: string }

/** Delete a key by id (the same hard delete `apiKey.revoke` does) and drop it from the auth cache. */
export async function revokeApiKey(id: string): Promise<RevokedKey> {
  if (!revokeApiKeySchema.safeParse({ id }).success) throw new ApiKeyCommandError(`"${id}" is not a key id (a UUID; see api-key list)`);
  const { db, orm, bus } = await deps();
  const [row] = await db.controlDb
    .select({ id: db.apiKeys.id, name: db.apiKeys.name, keyPrefix: db.apiKeys.keyPrefix, userId: db.apiKeys.userId, tenantId: db.apiKeys.tenantId })
    .from(db.apiKeys)
    .where(orm.eq(db.apiKeys.id, id.toLowerCase()))
    .limit(1);
  if (!row) throw new ApiKeyCommandError(`no API key with id ${id}`);
  // Same event the router emits; running API processes also hear it from the api_keys DB trigger.
  const deleted = await bus.cacheBus.afterWrite(
    [{ kind: "apiKey", keyId: row.id, userId: row.userId, tenantId: row.tenantId }],
    () => db.controlDb.delete(db.apiKeys).where(orm.eq(db.apiKeys.id, row.id)).returning({ id: db.apiKeys.id }),
  );
  if (deleted.length === 0) throw new ApiKeyCommandError(`API key ${id} was already revoked`);
  return row;
}

// ── Output ──────────────────────────────────────────────────────

function iso(d: Date | null): string {
  return d ? d.toISOString() : "never";
}

function renderTable(rows: string[][]): string {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => [...r[c]].length)));
  return rows.map((r) => "  " + r.map((cell, c) => cell + " ".repeat(widths[c] - [...cell].length)).join("  ").trimEnd()).join("\n");
}

export function formatKeyList(user: { email: string }, keys: KeyRow[], reveal: boolean, now = new Date()): string {
  const who = reveal ? normalizeEmail(user.email) : maskEmail(normalizeEmail(user.email));
  if (keys.length === 0) return `\nNo API keys for ${who}.\n\n`;
  const tenantCell = (k: KeyRow) => (reveal ? `${k.tenantName} (${k.tenantSlug})` : `Tenant ${tenantHandle(k.tenantId)}`);
  const expiry = (k: KeyRow) => (k.expiresAt ? iso(k.expiresAt) + (k.expiresAt <= now ? " (expired)" : "") : "never");
  const rows = [
    ["ID", "NAME", "PREFIX", "TENANT", "CREATED", "LAST USED", "EXPIRES"],
    ...keys.map((k) => [k.id, k.name, k.keyPrefix + "…", tenantCell(k), iso(k.createdAt), iso(k.lastUsedAt), expiry(k)]),
  ];
  return `\n${keys.length} API key${keys.length === 1 ? "" : "s"} for ${who}:\n\n${renderTable(rows)}\n\n`;
}

export function formatIssued(k: IssuedKey): string {
  return (
    `\nAPI key created for ${k.email} in ${k.tenantName} (${k.tenantSlug}).\n\n` +
    `  Key      ${k.key}\n` +
    `  ID       ${k.id}\n` +
    `  Prefix   ${k.keyPrefix}\n` +
    `  Name     ${k.name}\n` +
    `  Expires  ${iso(k.expiresAt)}\n` +
    `  Acts as  ${k.email} (${k.role})\n\n` +
    "Store this key now: it is shown only once and cannot be recovered (only its hash is kept).\n" +
    `It acts with ${k.email}'s authority in this organisation: treat it like that user's password.\n` +
    "The organisation's owners and admins are alerted that a key was created (queued now; delivered by the running notification dispatcher, about a minute later on the multi-tenant cloud).\n\n"
  );
}

// ── Entry point ─────────────────────────────────────────────────

interface Io { out: (s: string) => void; err: (s: string) => void }

/**
 * Entry point for `admin api-key …`. Returns the process exit code. The CLI closes the
 * database connections when done; tests that share the process's connections pass `close: false`.
 */
export async function runApiKey(
  argv: string[],
  io: Io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) },
  opts: { close?: boolean } = {},
): Promise<number> {
  let args: ApiKeyArgs;
  try {
    args = parseApiKeyArgs(argv);
  } catch (e) {
    io.err(`hisaabo admin: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  if (args.help) {
    io.out(API_KEY_HELP.trimStart());
    return 0;
  }

  let opened = false;
  try {
    // ONCE all-in-one image: `docker exec` shells do not inherit DATABASE_URL (see login-link).
    const onceUrl = deriveOnceDatabaseUrl(process.env);
    if (onceUrl) process.env.DATABASE_URL = onceUrl;
    if (!process.env.CONTROL_DATABASE_URL && !process.env.DATABASE_URL) {
      throw new ApiKeyCommandError("DATABASE_URL is not set. Run this inside the API container (docker compose exec api …), where it is provided.");
    }
    opened = true;

    if (args.command === "create") {
      const issued = await issueApiKey({
        email: args.email!, tenant: args.tenant!, name: args.name!, expiresDays: args.expiresDays, overridePlan: args.overridePlan,
      });
      logSecurityEvent("api_key_operator_issued", {
        ip: null,
        reason: "admin-cli",
        extra: { keyId: issued.id, tenantId: issued.tenantId, userId: issued.userId, planOverride: issued.planOverride },
      });
      if (issued.planOverride) {
        io.err(`hisaabo admin: WARNING --override-plan: plan limits were bypassed for ${issued.tenantSlug} (plan ${issued.plan}).\n`);
      }
      io.err(
        `[audit] admin api-key created: key ${issued.id} (${issued.keyPrefix}…, "${issued.name}") for ${issued.email} (user ${issued.userId}) ` +
          `in ${issued.tenantSlug} (${issued.tenantId}), role ${issued.role}, expires ${iso(issued.expiresAt)}` +
          `${issued.planOverride ? `, PLAN LIMIT OVERRIDDEN (plan ${issued.plan})` : ""}\n`,
      );
      io.out(formatIssued(issued));
      return 0;
    }

    if (args.command === "list") {
      const { user, keys } = await listApiKeys({ email: args.email!, tenant: args.tenant });
      io.out(formatKeyList(user, keys, args.reveal));
      return 0;
    }

    const revoked = await revokeApiKey(args.keyId!);
    logSecurityEvent("api_key_operator_revoked", {
      ip: null,
      reason: "admin-cli",
      extra: { keyId: revoked.id, tenantId: revoked.tenantId, userId: revoked.userId },
    });
    io.err(`[audit] admin api-key revoked: key ${revoked.id} (${revoked.keyPrefix}…, "${revoked.name}") of user ${revoked.userId} in tenant ${revoked.tenantId}\n`);
    io.out(`\nRevoked API key ${revoked.id} (${revoked.keyPrefix}…, "${revoked.name}"). It no longer authenticates; running API processes are told through the database (at most a minute).\n\n`);
    return 0;
  } catch (e) {
    io.err(`hisaabo admin: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  } finally {
    if (opened && opts.close !== false && depsPromise) {
      try {
        const { db } = await depsPromise;
        await db.closeAllTenantPools().catch(() => undefined);
        await db.closeControlClient().catch(() => undefined);
      } catch {
        /* the imports themselves failed; nothing is open */
      }
    }
  }
}
