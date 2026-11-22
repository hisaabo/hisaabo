/**
 * webmcp.ts — a fake WebMCP browser for the e2e suite.
 *
 * Chromium here has no `document.modelContext`, and the real one belongs to a
 * browser agent we cannot drive. The app only needs the *surface* (it registers
 * tools through `registerTool` and unregisters them by aborting a signal), so
 * `installFakeModelContext` plays the browser's side of it:
 *
 *   window.__webmcp.tools          what is registered right now (name, title, annotations, schema)
 *   window.__webmcp.registrations  every registerTool call, in order (a re-registration shows up twice)
 *   window.__webmcp.unregistered   every tool that was withdrawn by an abort, in order
 *   window.__webmcp.getTool(name)  the live tool object (hold on to it to call a STALE tool later)
 *   window.__webmcp.call(name, i)  what a browser agent does: execute a registered tool, get its result
 *
 * It also writes the user's opt-in preference (the key is scoped per user and
 * organization, see apps/web/src/lib/webmcp/preferences.ts), because that is the
 * one thing a human has to do before any tool is offered.
 *
 * Also here: role members created straight in the control database. The free
 * plan caps a team at three, so the usual invite flow cannot produce an admin, an
 * accountant, a sales manager and a seller next to the owner.
 */
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import type { Page } from "@playwright/test";
import { databaseUrl } from "./worker";

// ── The fake browser surface ───────────────────────────────────

export type ModelContextSurface = "document" | "navigator" | "none";

export interface FakeModelContextOptions {
  /** Where the fake lives: the spec location, the older navigator location, or nowhere. */
  surface: ModelContextSurface;
  /** localStorage entries to write before the app starts (the scoped preference key = "on"). */
  storage?: Record<string, string>;
}

export interface WebMcpToolInfo {
  name: string;
  title?: string;
  description: string;
  annotations?: { readOnlyHint?: boolean; consequentialHint?: boolean; untrustedContentHint?: boolean };
  inputSchema?: { properties?: Record<string, unknown> };
}

export interface WebMcpResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

declare global {
  interface Window {
    __webmcp?: {
      tools: WebMcpToolInfo[];
      registrations: string[];
      unregistered: string[];
      getTool(name: string): { execute(input: unknown, options: unknown): Promise<WebMcpResult> } | undefined;
      call(name: string, input?: unknown): Promise<WebMcpResult>;
    };
  }
}

/** Install the fake before the app starts (and on every later navigation). Call before `page.goto`. */
export async function installFakeModelContext(page: Page, options: FakeModelContextOptions): Promise<void> {
  await page.addInitScript(
    ({ surface, storage }) => {
      try {
        for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);
      } catch {
        // storage unavailable (about:blank, opaque origins): the preference simply is not set
      }
      if (surface === "none") return;

      type Tool = {
        name: string;
        title?: string;
        description: string;
        annotations?: Record<string, boolean>;
        inputSchema?: { properties?: Record<string, unknown> };
        execute: (input: unknown, options: unknown) => Promise<unknown>;
      };
      const live = new Map<string, Tool>();
      const api = {
        tools: [] as unknown[],
        registrations: [] as string[],
        unregistered: [] as string[],
        getTool: (name: string) => live.get(name),
        call: (name: string, input?: unknown) => {
          const tool = live.get(name);
          if (!tool) return Promise.reject(new Error(`tool not registered: ${name}`));
          return Promise.resolve(tool.execute(input ?? {}, { signal: new AbortController().signal }));
        },
      };
      const refresh = () => {
        api.tools = [...live.values()].map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          annotations: t.annotations,
          inputSchema: t.inputSchema,
        }));
      };
      // Two declared parameters on purpose: the app reads registerTool.length to tell the spec
      // surface (signal-based teardown) from the old single-argument one.
      const modelContext = {
        registerTool(tool: Tool, opts?: { signal?: AbortSignal }) {
          const signal = opts && opts.signal;
          if (signal && signal.aborted) return Promise.resolve();
          live.set(tool.name, tool);
          api.registrations.push(tool.name);
          refresh();
          if (signal) {
            signal.addEventListener(
              "abort",
              () => {
                if (live.get(tool.name) === tool) {
                  live.delete(tool.name);
                  api.unregistered.push(tool.name);
                  refresh();
                }
              },
              { once: true },
            );
          }
          return Promise.resolve();
        },
        ontoolchange: null,
      };
      (window as unknown as { __webmcp: typeof api }).__webmcp = api;
      Object.defineProperty(surface === "document" ? document : navigator, "modelContext", {
        value: modelContext,
        configurable: true,
      });
    },
    { surface: options.surface, storage: options.storage ?? {} },
  );
}

// ── Reading and driving the fake from a test ───────────────────

/** Names of the tools registered right now, sorted. */
export async function registeredToolNames(page: Page): Promise<string[]> {
  return page.evaluate(() => (window.__webmcp?.tools ?? []).map((t) => t.name).sort());
}

/** Number of registerTool calls so far (0 = the app never tried). */
export async function registrationCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__webmcp?.registrations.length ?? 0);
}

/**
 * Start a tool call the way a browser agent does and return its promise WITHOUT
 * waiting: a write blocks on the user's confirmation, which the test answers.
 */
export function startToolCall(page: Page, name: string, input: unknown = {}): Promise<WebMcpResult> {
  return page.evaluate(([n, i]) => window.__webmcp!.call(n as string, i), [name, input] as const);
}

/** Parse the JSON envelope ({ notice, untrusted, data | error }) a tool returns. */
export function envelope<T = Record<string, unknown>>(result: WebMcpResult): T {
  return JSON.parse(result.content[0].text) as T;
}

// ── Role members, created directly in the control database ─────

export interface RoleMember {
  role: string;
  email: string;
  userId: string;
  sessionToken: string;
}

/** A signed-in member of `tenantId` with `role`. No invitation, no plan limit: rows are written directly. */
export async function createRoleMember(tenantId: string, role: string): Promise<RoleMember> {
  const sql = postgres(databaseUrl(), { max: 1 });
  try {
    const email = `e2e-webmcp-${role.replace(/_/g, "-")}-${Date.now()}@test.hisaabo.in`;
    const sessionToken = randomBytes(32).toString("hex");
    const [user] = await sql<{ id: string }[]>`
      insert into users (email, name, email_verified) values (${email}, ${`E2E WebMCP ${role}`}, true) returning id`;
    await sql`
      insert into tenant_members (tenant_id, user_id, role, accepted_at)
      values (${tenantId}, ${user.id}, ${role}::member_role, now())`;
    await sql`
      insert into sessions (id, user_id, expires_at, tenant_id, auth_method)
      values (${sessionToken}, ${user.id}, now() + interval '1 day', ${tenantId}, 'cookie')`;
    return { role, email, userId: user.id, sessionToken };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Remove members created by createRoleMember (their sessions and memberships go with the user row). */
export async function removeRoleMembers(members: RoleMember[]): Promise<void> {
  if (members.length === 0) return;
  const sql = postgres(databaseUrl(), { max: 1 });
  try {
    await sql`delete from users where id in ${sql(members.map((m) => m.userId))}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** A second business in the owner's organization, written directly (the free plan allows one). */
export async function createSecondBusiness(ownerUserId: string, name: string): Promise<{ id: string; name: string }> {
  const sql = postgres(databaseUrl(), { max: 1 });
  try {
    const [row] = await sql<{ id: string }[]>`
      insert into businesses (name, created_by_user_id) values (${name}, ${ownerUserId}) returning id`;
    return { id: row.id, name };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function removeBusiness(businessId: string): Promise<void> {
  const sql = postgres(databaseUrl(), { max: 1 });
  try {
    await sql`delete from businesses where id = ${businessId}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Who a session cookie belongs to, as `auth.me` reports it: the pieces of the preference key. */
export async function whoAmI(apiBase: string, sessionToken: string): Promise<{ userId: string; tenantId: string }> {
  const res = await fetch(`${apiBase}/api/trpc/auth.me`, {
    headers: { "X-Requested-With": "hisaabo", Cookie: `session_id=${sessionToken}` },
  });
  if (!res.ok) throw new Error(`auth.me failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { result: { data: { json?: { user: { id: string }; tenantId: string } } } };
  const me = body.result.data.json ?? (body.result.data as unknown as { user: { id: string }; tenantId: string });
  return { userId: me.user.id, tenantId: me.tenantId };
}

/** The localStorage key the app uses for one person in one organization (mirrors preferences.ts). */
export function preferenceKey(userId: string, tenantId: string): string {
  return `hisaabo-webmcp:${encodeURIComponent(userId)}:${encodeURIComponent(tenantId)}`;
}
