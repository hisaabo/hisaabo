/**
 * notifications.test.ts — end-to-end notification behaviour against a real DB.
 *
 * Covers the rules in docs/architecture/notifications.md: domain events reach
 * the right recipients (eligibility, "only mine", self-suppression), per-business
 * preferences, locked alerts (inbox + email even when muted), tenant isolation
 * in the shared self-hosted database, push delivery with end-to-end encrypted
 * payloads, dead-token pruning, quotas, session-bound device registrations and
 * the collections sweep.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { createECDH, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  getTenantDb,
  invoices,
  notificationInbox,
  notificationOutbox,
  notificationPreferences,
  payments,
  pushDevices,
  sessions,
  userNotificationSettings,
  type TenantDatabase,
} from "@hisaabo/db";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { createTestContext } from "../helpers/test-context.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import {
  createTestWorld,
  createUser,
  addMember,
  createSession,
  createBusiness,
  createParty,
  createInvoiceWithItems,
  type TestWorld,
  type TestUser,
  type TestSession,
} from "../helpers/fixtures.js";
import { emailService } from "../../lib/email.js";
import { dispatchPending, emitNotificationEvent, emitNotificationEventSafe } from "../../lib/notifications/index.js";
import { decryptOnDevice } from "../../lib/notifications/push-crypto.js";
import type { PushDevice, PushMessage, PushProvider, PushResult } from "../../lib/notifications/push-provider.js";
import { sweepCollections } from "../../lib/notifications/collections-sweep.js";

// ── Fakes ───────────────────────────────────────────────────────────────────

class FakePushProvider implements PushProvider {
  readonly name = "fake";
  sent: Array<{ device: PushDevice; message: PushMessage }> = [];
  deadTokens = new Set<string>();
  supports(platform: string): boolean {
    return platform === "ios" || platform === "android";
  }
  async send(device: PushDevice, message: PushMessage): Promise<PushResult> {
    if (this.deadTokens.has(device.token)) return { ok: false, permanent: true, error: "NotRegistered" };
    this.sent.push({ device, message });
    return { ok: true };
  }
}

function deviceKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    privateKey: ecdh.getPrivateKey(),
    publicKey: ecdh.getPublicKey().toString("base64url"),
    authSecret: randomBytes(16).toString("base64url"),
  };
}

const callerFactory = createCallerFactory(appRouter);

/** A caller authenticated by a session cookie, as the web app / a device would be. */
function sessionCaller(user: TestUser, session: TestSession, tenantId: string, businessId?: string) {
  return callerFactory(createTestContext({
    user: { id: user.id, email: user.email, name: user.name },
    tenantId,
    businessId,
    authTokenKind: "cookie",
    headers: { cookie: `session_id=${session.id}`, "x-requested-with": "hisaabo" },
  }));
}

// ── World ───────────────────────────────────────────────────────────────────

let world: TestWorld;
let db: TenantDatabase;
let accountant: TestUser;
let accountantSession: TestSession;
let provider: FakePushProvider;
let rameshKeys: ReturnType<typeof deviceKeys>;
let emailSpy: MockInstance<typeof emailService.sendNotification>;

const owner = () => createTestCaller({
  userId: world.ramesh.id, email: world.ramesh.email, name: world.ramesh.name,
  tenantId: world.tenant1.id, businessId: world.business1.id,
});
const seller = () => createTestCaller({
  userId: world.suresh.id, email: world.suresh.email, name: world.suresh.name,
  tenantId: world.tenant1.id, businessId: world.business1.id,
});
const otherTenantOwner = () => createTestCaller({
  userId: world.kiran.id, email: world.kiran.email, name: world.kiran.name,
  tenantId: world.tenant2.id, businessId: world.business2.id,
});

async function inboxOf(userId: string) {
  return db.select().from(notificationInbox).where(eq(notificationInbox.recipientUserId, userId));
}

async function sentInvoice(createdByUserId: string, overrides: Record<string, unknown> = {}) {
  const { invoice } = await createInvoiceWithItems(
    world.tenantDb, world.business1.id, world.party1.id,
    [{ itemName: "Cotton", quantity: "10", unitPrice: "1000" }],
    { status: "sent", createdByUserId, ...overrides },
  );
  return invoice;
}

beforeAll(async () => {
  world = await createTestWorld();
  db = await getTenantDb("single");
  accountant = await createUser({ email: "anita.accounts@acmetrading.in", name: "Anita Rao" });
  await addMember(world.tenant1.id, accountant.id, "accountant");
  accountantSession = await createSession(accountant.id, world.tenant1.id);

  // Quiet hours off for everyone so push assertions don't depend on the clock.
  for (const u of [world.ramesh, world.suresh, world.kiran, accountant]) {
    await getControlDb().insert(userNotificationSettings).values({ userId: u.id, quietStart: null, quietEnd: null });
  }

  rameshKeys = deviceKeys();
  await sessionCaller(world.ramesh, world.rameshSession, world.tenant1.id).notification.registerDevice({
    platform: "android", appFlavor: "play", token: "fcm-token-ramesh-0001",
    publicKey: rameshKeys.publicKey, authSecret: rameshKeys.authSecret,
  });
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

beforeEach(() => {
  provider = new FakePushProvider();
  emailSpy = vi.spyOn(emailService, "sendNotification").mockResolvedValue(undefined);
});

afterEach(async () => {
  emailSpy.mockRestore();
  await db.delete(notificationInbox);
  await db.delete(notificationOutbox);
});

// ── Delivery ────────────────────────────────────────────────────────────────

describe("payment.received", () => {
  it("reaches the owner with an encrypted push; never the actor or another tenant", async () => {
    const invoice = await sentInvoice(world.ramesh.id);
    await seller().payment.create({
      partyId: world.party1.id, amount: "10000", mode: "upi",
      allocations: [{ invoiceId: invoice.id, amount: "10000" }],
    });

    const stats = await dispatchPending(db, provider);
    expect(stats.processed).toBe(1);

    const rameshInbox = await inboxOf(world.ramesh.id);
    expect(rameshInbox).toHaveLength(1);
    expect(rameshInbox[0]).toMatchObject({
      channel: "money_in",
      eventType: "payment.received",
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
      title: "₹10,000 received from Priya Textiles Pvt Ltd",
    });
    expect(rameshInbox[0].body).toContain(`${invoice.invoiceNumber} is now fully paid`);

    expect(await inboxOf(world.suresh.id)).toHaveLength(0); // actor
    expect(await inboxOf(world.kiran.id)).toHaveLength(0);  // other tenant
    expect(await inboxOf(accountant.id)).toHaveLength(1);   // accountant: inbox by default…
    expect(provider.sent.filter((s) => s.device.token === "fcm-token-accountant")).toHaveLength(0);

    // …the owner gets a push, and only the device can read it.
    expect(provider.sent).toHaveLength(1);
    const { message } = provider.sent[0];
    expect(message.fallbackTitle).toBe("Payment received");
    expect(JSON.stringify(message)).not.toContain("Priya");
    const plain = JSON.parse(decryptOnDevice(Buffer.from(message.encrypted!, "base64url"), rameshKeys.privateKey, rameshKeys.authSecret).toString());
    expect(plain).toMatchObject({
      t: "₹10,000 received from Priya Textiles Pvt Ltd",
      ch: "money_in",
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
      target: { kind: "payment" },
    });
  });

  it("sellers only hear about their own invoices", async () => {
    const mine = await sentInvoice(world.suresh.id);
    const notMine = await sentInvoice(world.ramesh.id);
    for (const inv of [mine, notMine]) {
      await owner().payment.create({
        partyId: world.party1.id, amount: "500", mode: "cash",
        allocations: [{ invoiceId: inv.id, amount: "500" }],
      });
    }
    await dispatchPending(db, provider);

    const sureshInbox = await inboxOf(world.suresh.id);
    expect(sureshInbox).toHaveLength(1);
    expect(sureshInbox[0].body).toContain(mine.invoiceNumber);
  });

  it("is dispatched once even if the dispatcher runs again", async () => {
    const invoice = await sentInvoice(world.ramesh.id);
    await seller().payment.create({ partyId: world.party1.id, amount: "100", mode: "cash", invoiceId: invoice.id });
    await dispatchPending(db, provider);
    await dispatchPending(db, provider);
    expect(await inboxOf(world.ramesh.id)).toHaveLength(1);
    expect(provider.sent).toHaveLength(1);
  });

  it("an identical dedupe key never notifies twice", async () => {
    const input = {
      tenantId: world.tenant1.id, businessId: world.business1.id, type: "store.order_placed" as const,
      payload: { orderId: "00000000-0000-4000-8000-000000000001", orderNumber: "ORD-1", customerName: "Asha", totalAmount: "999", itemCount: 1 },
      dedupeKey: "store.order_placed:dup-test",
    };
    expect(await emitNotificationEvent(db, input)).not.toBeNull();
    expect(await emitNotificationEvent(db, input)).toBeNull();
  });
});

describe("store orders from the public storefront", () => {
  it("resolve the tenant from the business when only the business is known", async () => {
    await emitNotificationEvent(db, {
      tenantId: "single", businessId: world.business1.id, type: "store.order_placed",
      payload: { orderId: "00000000-0000-4000-8000-000000000002", orderNumber: "ORD-2", customerName: "Asha", totalAmount: "1499", itemCount: 2 },
      actorKind: "system", dedupeKey: "store.order_placed:resolve-test",
    });
    await dispatchPending(db, provider);
    const [row] = await inboxOf(world.ramesh.id);
    expect(row).toMatchObject({ tenantId: world.tenant1.id, channel: "store", title: "New order ORD-2: ₹1,499" });
    expect(await inboxOf(world.suresh.id)).toHaveLength(0); // sellers: store off by default
    expect(await inboxOf(world.kiran.id)).toHaveLength(0);
  });
});

// ── Preferences ─────────────────────────────────────────────────────────────

describe("dispatcher claiming", () => {
  it("picks up an event the instant it is emitted (due-ness is judged on the database clock)", async () => {
    // Regression: the claim used to compare available_at (stamped by Postgres
    // with microsecond precision) against a millisecond-truncated JS timestamp,
    // so an event emitted less than a millisecond earlier was "not yet due".
    // payment.made is inbox-only for owners, so this stays clear of push quotas.
    for (let i = 0; i < 15; i++) {
      await emitNotificationEvent(db, {
        tenantId: world.tenant1.id, businessId: world.business1.id, type: "payment.made",
        payload: { paymentId: `00000000-0000-4000-8000-${String(200 + i).padStart(12, "0")}`, paymentNumber: `PAY-C${i}`, amount: "100", partyName: "Shree Traders" },
        actorKind: "system", dedupeKey: `payment.made:claim-timing-${i}`,
      });
      const stats = await dispatchPending(db, provider);
      expect(stats.processed).toBe(1);
    }
    expect((await inboxOf(world.ramesh.id)).filter((r) => r.eventType === "payment.made")).toHaveLength(15);
  });
});

describe("hot-path isolation", () => {
  const dropOutboxFault = async () => {
    await db.execute(sql.raw("DROP TRIGGER IF EXISTS test_outbox_fault ON notification_outbox"));
    await db.execute(sql.raw("DROP FUNCTION IF EXISTS test_outbox_fault()"));
  };
  // Make every insert into the outbox fail, like a bad payload, a constraint
  // violation or a table missing on a half-migrated database would.
  const breakOutbox = async () => {
    await db.execute(sql.raw(
      "CREATE OR REPLACE FUNCTION test_outbox_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'outbox unavailable (test)'; END $$",
    ));
    await db.execute(sql.raw(
      "CREATE TRIGGER test_outbox_fault BEFORE INSERT ON notification_outbox FOR EACH ROW EXECUTE FUNCTION test_outbox_fault()",
    ));
  };
  afterEach(dropOutboxFault);

  it("a payment still commits when the notification cannot be written", async () => {
    const invoice = await sentInvoice(world.ramesh.id);
    await breakOutbox();

    const payment = await seller().payment.create({
      partyId: world.party1.id, amount: "10000", mode: "upi",
      allocations: [{ invoiceId: invoice.id, amount: "10000" }],
    });

    // The business write is intact: the payment exists and settled the invoice…
    const [stored] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(stored).toBeDefined();
    const [settled] = await db.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(settled.status).toBe("paid");
    // …and only the notification was lost.
    expect(await db.select().from(notificationOutbox)).toHaveLength(0);

    // Once the outbox works again the next payment notifies normally.
    await dropOutboxFault();
    const next = await sentInvoice(world.ramesh.id);
    await seller().payment.create({ partyId: world.party1.id, amount: "100", mode: "cash", invoiceId: next.id });
    expect(await db.select().from(notificationOutbox)).toHaveLength(1);
  });

  it("a rolled-back outer transaction still drops the event (transactional outbox is preserved)", async () => {
    await expect(db.transaction(async (tx) => {
      await emitNotificationEventSafe(tx, {
        tenantId: world.tenant1.id, businessId: world.business1.id, type: "store.order_placed",
        payload: { orderId: "00000000-0000-4000-8000-000000000301", orderNumber: "ORD-RB", customerName: "Asha", totalAmount: "100", itemCount: 1 },
        actorKind: "system", dedupeKey: "store.order_placed:rollback-test",
      });
      throw new Error("order failed after the emit");
    })).rejects.toThrow(/order failed/);
    expect(await db.select().from(notificationOutbox)).toHaveLength(0);
  });
});

describe("preferences", () => {
  afterEach(async () => {
    for (const businessId of [null, world.business1.id]) {
      await owner().notification.updatePreference({ businessId, channel: "money_in", reset: true });
    }
  });

  it("a business-level override beats the tenant default", async () => {
    await owner().notification.updatePreference({ businessId: null, channel: "money_in", delivery: "push" });
    await owner().notification.updatePreference({ businessId: world.business1.id, channel: "money_in", delivery: "off" });

    const prefs = await owner().notification.getPreferences({ businessId: world.business1.id });
    const moneyIn = prefs.channels.find((c) => c.channel === "money_in")!;
    expect(moneyIn).toMatchObject({ source: "business", preference: { delivery: "off" } });

    const invoice = await sentInvoice(world.ramesh.id);
    await seller().payment.create({ partyId: world.party1.id, amount: "100", mode: "cash", invoiceId: invoice.id });
    await dispatchPending(db, provider);
    expect(await inboxOf(world.ramesh.id)).toHaveLength(0);
  });

  it("a threshold keeps small payments out of push but in the inbox", async () => {
    await owner().notification.updatePreference({ businessId: null, channel: "money_in", thresholdPaise: 50_000_00 });
    const invoice = await sentInvoice(world.ramesh.id);
    await seller().payment.create({ partyId: world.party1.id, amount: "100", mode: "cash", invoiceId: invoice.id });
    await dispatchPending(db, provider);
    expect(await inboxOf(world.ramesh.id)).toHaveLength(1);
    expect(provider.sent).toHaveLength(0);
  });

  it("locked channels cannot be muted, and unavailable ones cannot be enabled", async () => {
    await expect(owner().notification.updatePreference({ businessId: null, channel: "compliance", delivery: "off" }))
      .rejects.toThrow(/cannot be turned off/);
    await expect(seller().notification.updatePreference({ businessId: null, channel: "banking", delivery: "push" }))
      .rejects.toThrow(/not available for your role/);

    const prefs = await seller().notification.getPreferences();
    expect(prefs.channels.find((c) => c.channel === "security")).toMatchObject({ locked: true, available: true });
    expect(prefs.channels.find((c) => c.channel === "compliance")).toMatchObject({ available: false });
  });

  it("rejects a business from another tenant", async () => {
    await expect(owner().notification.getPreferences({ businessId: world.business2.id })).rejects.toThrow(/not found/i);
  });
});

// ── Locked alerts ───────────────────────────────────────────────────────────

describe("e-invoice failures (locked for owners and accountants)", () => {
  it("reach the inbox and email even when the channel is muted; sellers never see them", async () => {
    // A muted preference (written directly, bypassing the API's lock check)
    // must not stop a locked event.
    await getControlDb().insert(notificationPreferences).values({
      userId: accountant.id, tenantId: world.tenant1.id, channel: "compliance", delivery: "off", email: false,
    });

    await emitNotificationEvent(db, {
      tenantId: world.tenant1.id, businessId: world.business1.id, type: "einvoice.failed",
      payload: { invoiceId: "00000000-0000-4000-8000-000000000003", invoiceNumber: "INV-9", error: "Invalid GSTIN" },
      dedupeKey: "einvoice.failed:test",
    });
    await dispatchPending(db, provider);

    const [row] = await inboxOf(accountant.id);
    expect(row).toMatchObject({ channel: "compliance", locked: true });
    expect(await inboxOf(world.ramesh.id)).toHaveLength(1);
    expect(await inboxOf(world.suresh.id)).toHaveLength(0);
    const emailedTo = emailSpy.mock.calls.map((c) => c[0]);
    expect(emailedTo).toEqual(expect.arrayContaining([accountant.email, world.ramesh.email]));
    expect(emailSpy.mock.calls[0][1].url).toMatch(/\/invoices\?id=/);
  });
});

describe("team events", () => {
  it("a role change tells the member and the admins, and is locked", async () => {
    await owner().tenant.updateMemberRole({ userId: world.suresh.id, role: "seller_manager" });
    await dispatchPending(db, provider);

    const [toSuresh] = await inboxOf(world.suresh.id);
    expect(toSuresh).toMatchObject({ channel: "security", locked: true, businessId: null });
    expect(toSuresh.title).toBe("Role changed for Suresh Sharma");
    expect(toSuresh.body).toBe("Seller → Sales manager.");
    expect(await inboxOf(world.ramesh.id)).toHaveLength(0); // actor, but…
    expect(await inboxOf(accountant.id)).toHaveLength(0);   // …not an admin

    await owner().tenant.updateMemberRole({ userId: world.suresh.id, role: "seller" });
  });
});

// ── Inbox API ───────────────────────────────────────────────────────────────

describe("inbox procedures", () => {
  beforeEach(async () => {
    const invoice = await sentInvoice(world.ramesh.id);
    await seller().payment.create({ partyId: world.party1.id, amount: "250", mode: "cash", invoiceId: invoice.id });
    await dispatchPending(db, provider);
  });

  it("list / unreadCounts / markRead / markAllRead / archive", async () => {
    const page = await owner().notification.list({ limit: 10 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();

    expect(await owner().notification.unreadCounts()).toMatchObject({ total: 1, byBusiness: [{ businessId: world.business1.id, count: 1 }] });
    expect(await owner().notification.markRead({ ids: [page.items[0].id] })).toEqual({ updated: 1 });
    expect((await owner().notification.unreadCounts()).total).toBe(0);
    expect(await owner().notification.markAllRead()).toEqual({ updated: 0 });
    expect(await owner().notification.archive({ ids: [page.items[0].id] })).toEqual({ updated: 1 });
    expect((await owner().notification.list({})).items).toHaveLength(0);
  });

  it("paginates entries created in the same instant without skipping or repeating any", async () => {
    // Same timestamp on purpose: a (createdAt) cursor alone would drop rows at the page boundary.
    const at = new Date();
    for (let i = 0; i < 5; i++) {
      await db.insert(notificationInbox).values({
        tenantId: world.tenant1.id, businessId: world.business1.id, recipientUserId: world.ramesh.id,
        channel: "general", eventType: "general.announcement", title: `Tie ${i}`, body: "b",
        target: { kind: "inbox" }, createdAt: at,
      });
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    let cursorId: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = await owner().notification.list({ limit: 2, cursor, cursorId });
      seen.push(...page.items.map((i) => i.title).filter((t) => t.startsWith("Tie ")));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
      cursorId = page.nextCursorId ?? undefined;
    }
    expect([...seen].sort()).toEqual(["Tie 0", "Tie 1", "Tie 2", "Tie 3", "Tie 4"]);
  });

  it("still accepts a cursor without cursorId (older clients paginate by timestamp)", async () => {
    const first = await owner().notification.list({ limit: 1 });
    const older = await owner().notification.list({ limit: 10, cursor: new Date(Date.now() + 60_000).toISOString() });
    expect(first.items).toHaveLength(1);
    expect(older.items.map((i) => i.id)).toContain(first.items[0].id);
  });

  it("other tenants and other users cannot see or touch the entries", async () => {
    const [entry] = await inboxOf(world.ramesh.id);
    expect((await otherTenantOwner().notification.list({})).items).toHaveLength(0);
    expect(await otherTenantOwner().notification.markRead({ ids: [entry.id] })).toEqual({ updated: 0 });
    expect(await otherTenantOwner().notification.archive({ ids: [entry.id] })).toEqual({ updated: 0 });
    expect(await seller().notification.markRead({ ids: [entry.id] })).toEqual({ updated: 0 });
    const [still] = await inboxOf(world.ramesh.id);
    expect(still.readAt).toBeNull();
  });
});

// ── Devices ─────────────────────────────────────────────────────────────────

describe("push devices", () => {
  it("are bound to the session: revoking the session removes the registration", async () => {
    const session = await createSession(accountant.id, world.tenant1.id);
    const caller = sessionCaller(accountant, session, world.tenant1.id);
    await caller.notification.registerDevice({ platform: "ios", appFlavor: "appstore", token: "apns-token-accountant-1" });
    expect(await caller.notification.listDevices()).toEqual([expect.objectContaining({ platform: "ios", currentSession: true })]);

    const [stored] = await getControlDb().select().from(pushDevices).where(eq(pushDevices.userId, accountant.id));
    expect(stored.tokenHash).not.toContain("apns-token");

    await getControlDb().delete(sessions).where(eq(sessions.id, session.id));
    expect(await getControlDb().select().from(pushDevices).where(eq(pushDevices.userId, accountant.id))).toHaveLength(0);
  });

  it("rejects malformed encryption keys and API-key callers", async () => {
    const caller = sessionCaller(accountant, accountantSession, world.tenant1.id);
    await expect(caller.notification.registerDevice({
      platform: "android", appFlavor: "play", token: "fcm-bad-keys-0001", publicKey: "nope", authSecret: "nope",
    })).rejects.toThrow(/Invalid device encryption keys/);

    const viaKey = callerFactory({ ...createTestContext({ user: { id: accountant.id, email: accountant.email, name: accountant.name }, tenantId: world.tenant1.id }), viaApiKey: true });
    await expect(viaKey.notification.registerDevice({ platform: "android", appFlavor: "play", token: "fcm-api-key-0001" }))
      .rejects.toThrow(/API keys cannot register/);
  });

  it("dead tokens reported by the push service are removed", async () => {
    const session = await createSession(world.ramesh.id, world.tenant1.id);
    await sessionCaller(world.ramesh, session, world.tenant1.id).notification.registerDevice({
      platform: "android", appFlavor: "play", token: "fcm-token-dead-0001",
    });
    provider.deadTokens.add("fcm-token-dead-0001");

    const invoice = await sentInvoice(world.ramesh.id);
    await seller().payment.create({ partyId: world.party1.id, amount: "100", mode: "cash", invoiceId: invoice.id });
    const stats = await dispatchPending(db, provider);
    expect(stats.pushFailures).toBe(1);
    expect(stats.pushes).toBe(1); // the healthy device still got it
    const remaining = await getControlDb().select().from(pushDevices).where(eq(pushDevices.userId, world.ramesh.id));
    expect(remaining).toHaveLength(1);
  });
});

// ── Quotas ──────────────────────────────────────────────────────────────────

describe("quotas", () => {
  afterEach(() => {
    delete process.env.PUSH_QUOTA_USER_HOUR;
  });

  it("per-user cap: overflow stays in the inbox", async () => {
    process.env.PUSH_QUOTA_USER_HOUR = "0";
    const invoice = await sentInvoice(world.ramesh.id);
    await seller().payment.create({ partyId: world.party1.id, amount: "100", mode: "cash", invoiceId: invoice.id });
    await dispatchPending(db, provider);
    expect(await inboxOf(world.ramesh.id)).toHaveLength(1);
    expect(provider.sent).toHaveLength(0);
  });
});

// ── Collections sweep ───────────────────────────────────────────────────────

describe("collections sweep", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("emits due-today and overdue reminders once, only near a bucket boundary", async () => {
    const dueToday = await sentInvoice(world.suresh.id, { dueDate: new Date() });
    const overdue7 = await sentInvoice(world.suresh.id, { dueDate: new Date(Date.now() - 7 * DAY) });
    const ancient = await sentInvoice(world.suresh.id, { dueDate: new Date(Date.now() - 400 * DAY) });
    const paid = await sentInvoice(world.suresh.id, { dueDate: new Date(), status: "paid", amountPaid: "10000.00" });

    expect(await sweepCollections(db, world.tenant1.id)).toBe(2);
    expect(await sweepCollections(db, world.tenant1.id)).toBe(0); // deduped

    const outbox = await db.select().from(notificationOutbox).where(eq(notificationOutbox.tenantId, world.tenant1.id));
    const keys = outbox.map((r) => r.dedupeKey);
    expect(keys.some((k) => k.startsWith(`invoice.due_today:${dueToday.id}`))).toBe(true);
    expect(keys).toContain(`invoice.overdue:${overdue7.id}:7`);
    expect(keys.some((k) => k.includes(ancient.id) || k.includes(paid.id))).toBe(false);

    await dispatchPending(db, provider);
    // Seller managers would get all; the seller gets their own; owner gets all.
    expect(await inboxOf(world.suresh.id)).toHaveLength(2);
    expect(await inboxOf(world.ramesh.id)).toHaveLength(2);
    const [reminder] = (await inboxOf(world.ramesh.id)).filter((r) => r.eventType === "invoice.overdue");
    expect(reminder.body).toBe(`Invoice ${overdue7.invoiceNumber} is 7 days overdue.`);
  });

  it("emits at most the cap of NEW events per business per run; later runs pick up the rest", async () => {
    // A business of its own, so invoices left behind by the test above do not count.
    const biz = await createBusiness(world.tenantDb, world.ramesh.id, { name: "Cap Test Traders", gstin: "24AABCT0000R1ZM" });
    const party = await createParty(world.tenantDb, biz.id, { name: "Backlog Customer" });
    for (let i = 0; i < 5; i++) {
      await createInvoiceWithItems(
        world.tenantDb, biz.id, party.id,
        [{ itemName: "Cotton", quantity: "1", unitPrice: "1000" }],
        { status: "sent", createdByUserId: world.suresh.id, dueDate: new Date() },
      );
    }
    const countFor = async () =>
      (await db.select().from(notificationOutbox).where(eq(notificationOutbox.businessId, biz.id))).length;

    // 5 invoices, cap 2: runs emit 2, 2, 1, then nothing (rows already emitted dedupe and do not count).
    expect(await sweepCollections(db, world.tenant1.id, 2)).toBe(2);
    expect(await countFor()).toBe(2);
    expect(await sweepCollections(db, world.tenant1.id, 2)).toBe(2);
    expect(await sweepCollections(db, world.tenant1.id, 2)).toBe(1);
    expect(await sweepCollections(db, world.tenant1.id, 2)).toBe(0);
    expect(await countFor()).toBe(5);
  });
});

// ── Hindi ───────────────────────────────────────────────────────────────────

describe("locale", () => {
  afterEach(async () => {
    await owner().notification.updateSettings({ locale: "en" });
  });

  it("renders in the recipient's language", async () => {
    await owner().notification.updateSettings({ locale: "hi" });
    const invoice = await sentInvoice(world.ramesh.id);
    await seller().payment.create({ partyId: world.party1.id, amount: "100", mode: "cash", invoiceId: invoice.id });
    await dispatchPending(db, provider);
    const [row] = await inboxOf(world.ramesh.id);
    expect(row.locale).toBe("hi");
    expect(row.title).toBe("Priya Textiles Pvt Ltd से ₹100 प्राप्त हुए");
  });
});

describe("settings", () => {
  it("promotions consent records when and where it was given, and can be withdrawn", async () => {
    await owner().notification.updateSettings({ promotionsOptIn: true, promotionsOptInSource: "settings/notifications" });
    let s = await owner().notification.getSettings();
    expect(s.promotionsOptIn).toBe(true);
    const [row] = await getControlDb().select().from(userNotificationSettings).where(eq(userNotificationSettings.userId, world.ramesh.id));
    expect(row.promotionsOptInSource).toBe("settings/notifications");

    await owner().notification.updateSettings({ promotionsOptIn: false });
    s = await owner().notification.getSettings();
    expect(s.promotionsOptIn).toBe(false);
  });

  it("transports reports no mobile push when none is configured", async () => {
    expect(await owner().notification.transports()).toMatchObject({ inbox: true, mobilePush: false, pushProvider: "none" });
  });
});
