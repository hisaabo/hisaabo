/**
 * login-link.ts — `admin login-link <email>`: operator break-glass sign-in.
 *
 * WHY: production refuses to start sending mail without RESEND_API_KEY, and on a
 * self-hosted install whose email delivery is misconfigured nobody can request
 * a magic link — including the owner who needs to fix it. This command mints a
 * magic-link token for an EXISTING user straight in the database and prints the
 * URL, so an operator with shell access to the API container can sign in.
 *
 * It creates the exact row `auth.sendMagicLink` would (same generator, same
 * table, same sha256 hashing — see lib/magic-link.ts), redeemed by the normal
 * `auth.verifyMagicLink`: single use, short expiry, no new auth code path.
 *
 * Shell access to the container is the authority here (the same as running
 * psql); the command is therefore deliberately scoped: it never creates users,
 * only prints a link for an email that already exists.
 *
 * Works in multi-tenant mode: users and magic_link_tokens live in the control
 * database, which `controlDb` targets (CONTROL_DATABASE_URL, else DATABASE_URL).
 *
 * AUDIT: there is no platform-level audit table (audit_log is per-business, in
 * the tenant database). The durable trail is the token row itself — its
 * `ip_address` is stamped `admin-cli`, `created_at` is the issue time and
 * `used_at` the redemption time — plus the stderr line printed here.
 */

import { existsSync, readFileSync } from "node:fs";
import { generateMagicLinkToken, buildMagicLinkUrl, MAGIC_LINK_TTL_MS } from "../magic-link.js";
import { normalizeEmail } from "../normalize-email.js";
import { isValidHttpUrl } from "../public-url.js";

/** Marker stored in magic_link_tokens.ip_address so issued-by-operator rows are identifiable. */
export const ADMIN_LOGIN_LINK_MARKER = "admin-cli";

export const DEFAULT_TTL_MINUTES = MAGIC_LINK_TTL_MS / 60_000;
export const MAX_TTL_MINUTES = 60;

export const LOGIN_LINK_HELP = `
hisaabo admin login-link — one-time sign-in link for an existing user (break-glass)

USAGE
  node packages/api/dist/bin/admin.js login-link <email> [options]

Prints a single-use sign-in URL for a user that already exists. Use it when
email delivery is not working and nobody can request a magic link. Run it
inside the API container, where DATABASE_URL is set:

  docker compose --env-file .env.prod -f docker-compose.prod.yml exec api \\
    node packages/api/dist/bin/admin.js login-link owner@example.com

OPTIONS
  --ttl-minutes <n>   Link lifetime in minutes (default: ${DEFAULT_TTL_MINUTES}, max: ${MAX_TTL_MINUTES})
  --base-url <url>    Web app origin to build the link from (default: APP_URL)
  -h, --help          Show this help

The link signs in as that user. Treat it like a password: anyone who opens it
before it is used or expires becomes that user. It is consumed on first use.
`;

export interface LoginLinkArgs {
  email: string | null;
  ttlMinutes: number;
  baseUrl: string | null;
  help: boolean;
}

export function parseLoginLinkArgs(argv: string[]): LoginLinkArgs {
  const a: LoginLinkArgs = { email: null, ttlMinutes: DEFAULT_TTL_MINUTES, baseUrl: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        a.help = true;
        break;
      case "--ttl-minutes": {
        const raw = argv[++i];
        if (raw === undefined) throw new Error("--ttl-minutes needs a value");
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 1 || n > MAX_TTL_MINUTES) {
          throw new Error(`--ttl-minutes must be a number between 1 and ${MAX_TTL_MINUTES}`);
        }
        a.ttlMinutes = n;
        break;
      }
      case "--base-url": {
        const raw = argv[++i];
        if (raw === undefined) throw new Error("--base-url needs a value");
        a.baseUrl = raw;
        break;
      }
      default:
        if (arg.startsWith("-")) throw new Error(`unknown option ${arg} (try login-link --help)`);
        if (a.email !== null) throw new Error("login-link takes exactly one email address");
        a.email = arg;
    }
  }
  return a;
}

/** The two database operations the command needs; the real one wraps controlDb. */
export interface LoginLinkStore {
  findUserByEmail(normalizedEmail: string): Promise<{ id: string; email: string } | null>;
  insertToken(row: { email: string; tokenHash: string; expiresAt: Date; ipAddress: string }): Promise<void>;
}

export interface LoginLink {
  url: string;
  email: string;
  userId: string;
  expiresAt: Date;
}

export class LoginLinkError extends Error {}

/** Pick the web origin for the link: --base-url, then APP_URL. Must be http(s). */
export function resolveLoginLinkBaseUrl(
  override: string | null,
  env: Record<string, string | undefined>,
): string {
  const raw = (override ?? env.APP_URL ?? "").trim();
  if (!raw) {
    throw new LoginLinkError("APP_URL is not set in this environment; pass --base-url https://app.example.com");
  }
  if (!isValidHttpUrl(raw)) {
    throw new LoginLinkError(`${override !== null ? "--base-url" : "APP_URL"} must be a valid http(s) URL, got "${raw}"`);
  }
  return raw.replace(/\/+$/, "");
}

/** Core logic, database-agnostic so it can be unit-tested without Postgres. */
export async function createLoginLink(
  store: LoginLinkStore,
  opts: { email: string; ttlMinutes: number; baseUrl: string; now?: Date },
): Promise<LoginLink> {
  const email = normalizeEmail(opts.email);
  const user = await store.findUserByEmail(email);
  if (!user) {
    throw new LoginLinkError(
      `no user with email ${email}. login-link only works for existing users (it never creates accounts).`,
    );
  }

  const { rawToken, tokenHash } = generateMagicLinkToken();
  const now = opts.now ?? new Date();
  const expiresAt = new Date(now.getTime() + opts.ttlMinutes * 60_000);

  // Stored under the user's canonical email, which is what verifyMagicLink resolves the user by.
  await store.insertToken({
    email: normalizeEmail(user.email),
    tokenHash,
    expiresAt,
    ipAddress: ADMIN_LOGIN_LINK_MARKER,
  });

  return {
    url: buildMagicLinkUrl(opts.baseUrl, rawToken),
    email: normalizeEmail(user.email),
    userId: user.id,
    expiresAt,
  };
}

/**
 * ONCE all-in-one image: the API's s6 run script exports DATABASE_URL, but a
 * `docker exec` shell does not inherit it. Rebuild the same unix-socket URL from
 * the secret the image keeps on the /storage volume.
 */
export function deriveOnceDatabaseUrl(
  env: Record<string, string | undefined>,
  fileExists: (p: string) => boolean = existsSync,
  readFile: (p: string) => string = (p) => readFileSync(p, "utf8"),
): string | null {
  if (env.CONTROL_DATABASE_URL || env.DATABASE_URL) return null;
  const secretPath = "/storage/secrets/pg_app_password";
  if (!fileExists(secretPath)) return null;
  const password = readFile(secretPath).trim();
  if (!password) return null;
  return `postgresql://postgres:${encodeURIComponent(password)}@/hisaabo?host=/storage/run`;
}

async function openControlStore(): Promise<{ store: LoginLinkStore; close: () => Promise<void> }> {
  // Loaded lazily: importing @hisaabo/db opens the control-database pool, which
  // the read-only dashboard must not do.
  const { controlDb, users, magicLinkTokens, closeControlClient } = await import("@hisaabo/db");
  const { sql } = await import("drizzle-orm");
  const store: LoginLinkStore = {
    async findUserByEmail(email) {
      const [row] = await controlDb
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(sql`lower(${users.email}) = ${email}`)
        .limit(1);
      return row ?? null;
    },
    async insertToken(row) {
      await controlDb.insert(magicLinkTokens).values(row);
    },
  };
  return { store, close: () => closeControlClient() };
}

/** Entry point for `admin login-link …`. Returns the process exit code. */
export async function runLoginLink(
  argv: string[],
  io: { out: (s: string) => void; err: (s: string) => void } = {
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
  },
): Promise<number> {
  let args: LoginLinkArgs;
  try {
    args = parseLoginLinkArgs(argv);
  } catch (e) {
    io.err(`hisaabo admin: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  if (args.help) {
    io.out(LOGIN_LINK_HELP.trimStart());
    return 0;
  }
  if (!args.email) {
    io.err("hisaabo admin: login-link needs an email address (try login-link --help)\n");
    return 2;
  }

  let close: (() => Promise<void>) | null = null;
  try {
    const baseUrl = resolveLoginLinkBaseUrl(args.baseUrl, process.env);

    const onceUrl = deriveOnceDatabaseUrl(process.env);
    if (onceUrl) process.env.DATABASE_URL = onceUrl;
    if (!process.env.CONTROL_DATABASE_URL && !process.env.DATABASE_URL) {
      throw new LoginLinkError(
        "DATABASE_URL is not set. Run this inside the API container (docker compose exec api …), where it is provided.",
      );
    }

    const opened = await openControlStore();
    close = opened.close;
    const link = await createLoginLink(opened.store, { email: args.email, ttlMinutes: args.ttlMinutes, baseUrl });

    io.err(
      `[audit] admin login-link issued for ${link.email} (user ${link.userId}), expires ${link.expiresAt.toISOString()}, ` +
        `single use; token row is marked ip_address='${ADMIN_LOGIN_LINK_MARKER}'\n`,
    );
    io.out(
      `\nOne-time sign-in link for ${link.email} (valid ${args.ttlMinutes} min, single use):\n\n  ${link.url}\n\n` +
        "Open it in a browser. Anyone who opens it before it is used or expires is signed in as this user.\n\n",
    );
    return 0;
  } catch (e) {
    io.err(`hisaabo admin: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  } finally {
    if (close) await close().catch(() => undefined);
  }
}
