/**
 * store-otp.test.ts — DB-backed send/verify/token flow for storefront phone OTP,
 * plus the store.getSettings / updateSettings contract.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { storeOrders, storePhoneOtps, type TenantDatabase } from "@hisaabo/db";
import { createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { truncateAllTables, closeTestDb, getTenantTestDb } from "../helpers/test-db.js";
import {
  sendStoreOtp, verifyStoreOtp, verifyOtpToken, hashOtp, OTP_MAX_ATTEMPTS, OTP_SENDS_PER_WINDOW,
} from "../../lib/store-otp.js";
import type { SmsService } from "../../lib/sms.js";

const PHONE = "9876543210";

let world: TestWorld;
let sent: Array<{ phone: string; code: string; businessName: string }>;
const sms: SmsService = {
  async sendOtp(phone, code, businessName) {
    sent.push({ phone, code, businessName });
  },
};

const db = () => getTenantTestDb() as unknown as TenantDatabase;
const bizId = () => world.business1.id;
const send = (phone = PHONE) =>
  sendStoreOtp(db(), sms, { businessId: bizId(), businessName: "Acme", phone, ip: "1.2.3.4" });
const verify = (code: string, phone = PHONE) => verifyStoreOtp(db(), { businessId: bizId(), phone, code });

beforeAll(async () => {
  world = await createTestWorld();
});

beforeEach(async () => {
  sent = [];
  await db().delete(storePhoneOtps);
  await db().delete(storeOrders);
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("send + verify", () => {
  it("stores only a hash and verifies the delivered code", async () => {
    const res = await send();
    expect(res).toEqual({ ok: true, expiresInSec: 600 });
    expect(sent).toHaveLength(1);
    const { code } = sent[0]!;
    expect(code).toMatch(/^\d{6}$/);

    const [row] = await db().select().from(storePhoneOtps);
    expect(row!.codeHash).toBe(hashOtp(bizId(), PHONE, code));
    expect(row!.codeHash).not.toContain(code);

    const out = await verify(code);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.known).toBe(false);
    expect(out.name).toBeUndefined();
    expect(verifyOtpToken(out.otpToken, bizId(), PHONE)).toBe(true);
    expect(verifyOtpToken(out.otpToken, bizId(), "9876543211")).toBe(false);
  });

  it("a code is single-use", async () => {
    await send();
    const { code } = sent[0]!;
    expect((await verify(code)).ok).toBe(true);
    expect((await verify(code)).ok).toBe(false);
  });

  it("rejects wrong codes and locks after 5 attempts, even for the right code", async () => {
    await send();
    const { code } = sent[0]!;
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) expect((await verify(wrong)).ok).toBe(false);
    expect((await verify(code)).ok).toBe(false);
  });

  it("rejects an expired code", async () => {
    await send();
    const { code } = sent[0]!;
    await db().update(storePhoneOtps).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await verify(code)).ok).toBe(false);
  });

  it("only the newest code for a phone is checked", async () => {
    await send();
    await send();
    const [first, second] = sent;
    if (first!.code !== second!.code) expect((await verify(first!.code)).ok).toBe(false);
    expect((await verify(second!.code)).ok).toBe(true);
  });

  it("does not verify a code issued for another phone", async () => {
    await send("9876543211");
    expect((await verify(sent[0]!.code)).ok).toBe(false);
  });

  it("limits sends to 3 per phone per 15 minutes", async () => {
    for (let i = 0; i < OTP_SENDS_PER_WINDOW; i++) expect((await send()).ok).toBe(true);
    const res = await send();
    expect(res).toMatchObject({ ok: false, status: 429 });
    expect(sent).toHaveLength(OTP_SENDS_PER_WINDOW);
    expect((await send("9876543299")).ok).toBe(true);
  });

  it("rolls back the row and reports 502 when the SMS gateway fails", async () => {
    const failing: SmsService = { sendOtp: async () => { throw new Error("down"); } };
    const res = await sendStoreOtp(db(), failing, { businessId: bizId(), businessName: "Acme", phone: PHONE, ip: null });
    expect(res).toMatchObject({ ok: false, status: 502 });
    expect(await db().select().from(storePhoneOtps)).toHaveLength(0);
    expect((await send()).ok).toBe(true);
  });
});

describe("returning-customer name", () => {
  it("is returned only after verification, from the latest order for that phone", async () => {
    await db().insert(storeOrders).values([
      { businessId: bizId(), orderNumber: "ORD-00001", customerName: "Old Name", customerPhone: PHONE, createdAt: new Date(Date.now() - 86_400_000) },
      { businessId: bizId(), orderNumber: "ORD-00002", customerName: "Ravi Kumar", customerPhone: PHONE },
      { businessId: bizId(), orderNumber: "ORD-00003", customerName: "Someone Else", customerPhone: "9876543211" },
    ]);
    await send();
    const out = await verify(sent[0]!.code);
    expect(out).toMatchObject({ ok: true, known: true, name: "Ravi Kumar" });
  });
});

describe("store settings", () => {
  const caller = () => createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it("reports storeRequirePhoneOtp=false and phoneOtpAvailable=false by default", async () => {
    delete process.env.SMS_PROVIDER;
    const s = await caller().store.getSettings();
    expect(s.storeRequirePhoneOtp).toBe(false);
    expect(s.phoneOtpAvailable).toBe(false);
  });

  it("refuses to enable OTP without an SMS provider", async () => {
    delete process.env.SMS_PROVIDER;
    await expect(caller().store.updateSettings({ storeRequirePhoneOtp: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("enables and disables OTP when a provider is configured", async () => {
    process.env.SMS_PROVIDER = "webhook";
    process.env.SMS_WEBHOOK_URL = "https://sms.example/send";
    process.env.SMS_WEBHOOK_SECRET = "secret";
    const on = await caller().store.updateSettings({ storeRequirePhoneOtp: true });
    expect(on!.storeRequirePhoneOtp).toBe(true);
    expect((await caller().store.getSettings()).phoneOtpAvailable).toBe(true);
    delete process.env.SMS_PROVIDER;
    const off = await caller().store.updateSettings({ storeRequirePhoneOtp: false });
    expect(off!.storeRequirePhoneOtp).toBe(false);
  });
});
