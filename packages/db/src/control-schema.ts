import { pgTable, text, timestamp, uuid, pgEnum, index, uniqueIndex, boolean, jsonb, check } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ── Enums ──────────────────────────────────────────────────────

export const tenantStatusEnum = pgEnum("tenant_status", ["active", "suspended", "deleted"]);
export const tenantPlanEnum = pgEnum("tenant_plan", ["free", "pro", "business", "enterprise"]);
export const memberRoleEnum = pgEnum("member_role", [
  // Legacy values (kept for backward compat with existing DB rows)
  "owner", "admin", "member", "viewer",
  // New CASL-based roles (require ALTER TYPE migration in production)
  "superadmin", "seller_manager", "seller", "accountant",
]);

// ── Tenants ────────────────────────────────────────────────────

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  // DB connection info (null in self-hosted mode — uses same DB)
  dbName: text("db_name"),
  dbHost: text("db_host"),
  dbPort: text("db_port"),
  dbUser: text("db_user"),
  // Encrypted at rest via AES-256-GCM when DB_ENCRYPTION_KEY is set (see crypto.ts).
  // Legacy plaintext values are handled gracefully on read.
  dbPassword: text("db_password"),
  plan: tenantPlanEnum("plan").default("free").notNull(),
  status: tenantStatusEnum("status").default("active").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("tenants_slug_idx").on(t.slug),
]);

// ── Users (moved from schema.ts) ───────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name"),
  passwordHash: text("password_hash"),
  emailVerified: boolean("email_verified").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("users_email_idx").on(t.email),
]);

// ── Session auth method enum ───────────────────────────────────

export const sessionAuthMethodEnum = pgEnum("session_auth_method", ["cookie", "bearer"]);

// ── Sessions (modified — added tenantId) ───────────────────────

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  // tenantId can be null for users who haven't selected a tenant yet
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  // authMethod distinguishes cookie-based sessions (web) from Bearer-token sessions
  // (mobile + desktop). Default 'cookie' keeps all existing rows valid.
  authMethod: sessionAuthMethodEnum("auth_method").notNull().default("cookie"),
  // maxExpiresAt is the absolute hard cap for Bearer sessions (createdAt + 30 days).
  // Null for cookie sessions — they use the existing 30-day expiresAt semantics.
  maxExpiresAt: timestamp("max_expires_at", { withTimezone: true }),
}, (t) => [
  index("sessions_user_idx").on(t.userId),
  index("sessions_tenant_idx").on(t.tenantId),
]);

// ── Access Tokens (short-lived, 15-min, desktop only) ─────────
//
// Each row represents a single issued access token for a Bearer session.
// Clients send these as `Authorization: Bearer at_<token>` for normal API
// calls; the long-lived session_id (refresh token) is held in the OS
// keychain and is only sent to `auth.issueAccessToken`.
//
// Cascade-delete on session delete is load-bearing: when a refresh token
// is revoked (logout, privilege rotation, admin action), all access tokens
// it spawned die immediately — stolen access tokens cannot outlive the
// revocation window of their parent session.

export const accessTokens = pgTable("access_tokens", {
  id: text("id").primaryKey(), // "at_" + base64url(randomBytes(48))
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("access_tokens_session_idx").on(t.sessionId),
  index("access_tokens_expires_idx").on(t.expiresAt),
]);

// ── Tenant Members ─────────────────────────────────────────────

export const tenantMembers = pgTable("tenant_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: memberRoleEnum("role").default("member").notNull(),
  invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("tenant_members_unique_idx").on(t.tenantId, t.userId),
  index("tenant_members_user_idx").on(t.userId),
]);

// ── Invitations ────────────────────────────────────────────────

export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: memberRoleEnum("role").default("member").notNull(),
  token: text("token").notNull(),
  invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("invitations_token_idx").on(t.token),
  index("invitations_email_idx").on(t.email),
  index("invitations_tenant_idx").on(t.tenantId),
]);

// ── Magic Link Tokens ─────────────────────────────────────────

export const magicLinkTokens = pgTable("magic_link_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull(),
  // Populated for email-change tokens so confirmEmailChange doesn't trust client-supplied userId
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("magic_link_tokens_email_idx").on(t.email),
  index("magic_link_tokens_hash_idx").on(t.tokenHash),
]);

// ── Native Auth Requests (system-browser handoff + PKCE) ──────

export const nativeAuthRequests = pgTable("native_auth_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  // 'desktop' | 'mobile' | 'cli'
  client: text("client").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  state: text("state").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  // sha256 of the one-time authorization code; the code itself is never stored
  codeHash: text("code_hash"),
  authorizedAt: timestamp("authorized_at", { withTimezone: true }),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("native_auth_requests_expires_idx").on(t.expiresAt),
]);

// ── API Keys ───────────────────────────────────────────────────

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  // Store the hash, never the raw key
  keyHash: text("key_hash").notNull(),
  // First 20 chars of the raw key for display: "hisaabo_key_abc12345..."
  keyPrefix: text("key_prefix").notNull(),
  name: text("name").notNull(), // User-given label like "CLI", "CI/CD", "MCP Server"
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }), // null = never expires
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("api_keys_user_idx").on(t.userId),
  index("api_keys_hash_idx").on(t.keyHash),
]);

// ── System Config ─────────────────────────────────────────────
export const systemConfig = pgTable("system_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Store slug registry ───────────────────────────────────────
//
// Global (cross-tenant) registry of public storefront slugs, used only in
// multi-tenant mode so /store/<slug> resolves with one PK lookup instead of
// scanning every tenant DB.
//
// Semantics (enforced by application code, see the slug-registry design):
//   - A LIVE row has released_at IS NULL: the slug is owned by business_id.
//   - Renaming/clearing a slug does NOT delete the row; it sets
//     released_at = now() on the old row. The slug stays reserved (PK) so old
//     links cannot be hijacked immediately.
//   - A released slug can be reclaimed by the SAME tenant at any time, and by
//     a DIFFERENT tenant only once released_at < now() - interval '30 days'.
//   - A business has at most one live slug (partial unique index below, scoped
//     by tenant); it may have any number of released rows.
//
// Indexes (every index taxes writes, so the set is deliberately minimal;
// write rate is a handful of store-settings saves per day, but each index
// still has to earn its place):
//   1. PRIMARY KEY (slug): the hot public lookup and global uniqueness.
//   2. PARTIAL UNIQUE (tenant_id, business_id) WHERE released_at IS NULL:
//      enforces one live slug per business and is the access path for rename/
//      disable/checkSlug. Partial so released history rows are neither indexed
//      nor constrained. Scoped by tenant on purpose: self-import inserts
//      business rows whose ids come from an untrusted backup file, so a global
//      unique index on business_id would let a crafted backup squat another
//      tenant's business id and block that tenant's registration.
// Deliberately NOT indexed: tenant_id (only used by the FK cascade, which the
// app never triggers; the table is O(#stores)), store_enabled and released_at
// (filtered after the PK hit; the reclaim check is also a PK hit).
//
// business_id has no FK: it points into a tenant database. It is NOT globally
// unique and must never be used alone to identify a registry row.
//
// WRITE RULES (enforced by the single registry module in packages/api):
//   - All registry writes go through that one module.
//   - tenant_id always comes from the authenticated server context (or, in the
//     backfill, from the control `tenants` row being scanned), never from
//     request input or any value read out of a tenant database.
//   - Updating or releasing an existing live row is allowed only when
//     row.tenant_id = caller tenant (SQL WHERE / ON CONFLICT ... WHERE
//     store_slugs.tenant_id = EXCLUDED.tenant_id). A released slug may be
//     claimed by another tenant only via the 30-day rule above.
//   - The slug-format CHECK stays as defence in depth.
export const storeSlugs = pgTable("store_slugs", {
  slug: text("slug").primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  businessId: uuid("business_id").notNull(),
  storeEnabled: boolean("store_enabled").notNull(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("store_slugs_live_business_idx").on(t.tenantId, t.businessId).where(sql`${t.releasedAt} IS NULL`),
  check("store_slugs_slug_format", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'`),
]);

// ── Relations ──────────────────────────────────────────────────

export const tenantsRelations = relations(tenants, ({ many }) => ({
  members: many(tenantMembers),
  invitations: many(invitations),
}));

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  tenantMemberships: many(tenantMembers, { relationName: "memberUser" }),
  invitedMembers: many(tenantMembers, { relationName: "memberInviter" }),
  apiKeys: many(apiKeys),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [sessions.tenantId], references: [tenants.id] }),
  accessTokens: many(accessTokens),
}));

export const accessTokensRelations = relations(accessTokens, ({ one }) => ({
  session: one(sessions, { fields: [accessTokens.sessionId], references: [sessions.id] }),
}));

export const tenantMembersRelations = relations(tenantMembers, ({ one }) => ({
  tenant: one(tenants, { fields: [tenantMembers.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [tenantMembers.userId], references: [users.id], relationName: "memberUser" }),
  inviter: one(users, { fields: [tenantMembers.invitedBy], references: [users.id], relationName: "memberInviter" }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  tenant: one(tenants, { fields: [invitations.tenantId], references: [tenants.id] }),
  inviter: one(users, { fields: [invitations.invitedBy], references: [users.id] }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, { fields: [apiKeys.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [apiKeys.tenantId], references: [tenants.id] }),
}));
