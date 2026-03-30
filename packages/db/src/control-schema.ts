import { pgTable, text, timestamp, uuid, pgEnum, index, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

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
  // TODO (FINDING 5 - SECURITY): dbPassword is stored in plaintext. This requires
  // encryption at rest via a KMS or envelope encryption with an env-based key (e.g., AES-256-GCM
  // with DB_ENCRYPTION_KEY). Implement before production deployment in cloud/multi-tenant mode.
  dbPassword: text("db_password"), // FIXME: encrypt with KMS/env key before production use
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

// ── Sessions (modified — added tenantId) ───────────────────────

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  // tenantId can be null for users who haven't selected a tenant yet
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
}, (t) => [
  index("sessions_user_idx").on(t.userId),
  index("sessions_tenant_idx").on(t.tenantId),
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

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [sessions.tenantId], references: [tenants.id] }),
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
