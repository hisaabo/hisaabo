import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { businesses, storeOrders, storePhoneOtps } from "@hisaabo/db";
import type { TenantDatabase as TenantDb } from "@hisaabo/db";
import { deriveKey } from "./derive-key.js";
import type { SmsService } from "./sms.js";

export const OTP_TTL_MS = 10 * 60_000;
export const OTP_TOKEN_TTL_MS = 30 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_SENDS_PER_WINDOW = 3;
export const OTP_SEND_WINDOW_MS = 15 * 60_000;

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function otpKey(): Buffer {
  return deriveKey("store-otp-code");
}

export function hashOtp(businessId: string, phone: string, code: string): string {
  return createHmac("sha256", otpKey()).update(`${businessId}:${phone}:${code}`).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

export function verifyOtpHash(businessId: string, phone: string, code: string, stored: string): boolean {
  return safeEqualHex(hashOtp(businessId, phone, code), stored);
}

function tokenKey(): Buffer {
  return deriveKey("store-otp");
}

export function signOtpToken(businessId: string, phone: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ businessId, phone, exp: now + OTP_TOKEN_TTL_MS }),
  ).toString("base64url");
  const sig = createHmac("sha256", tokenKey()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyOtpToken(
  token: unknown,
  businessId: string,
  phone: string,
  now = Date.now(),
): boolean {
  if (typeof token !== "string" || token.length > 1024) return false;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return false;
  const expected = createHmac("sha256", tokenKey()).update(payload).digest("base64url");
  if (!safeEqualHex(sig, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      businessId?: unknown;
      phone?: unknown;
      exp?: unknown;
    };
    return (
      data.businessId === businessId &&
      data.phone === phone &&
      typeof data.exp === "number" &&
      data.exp > now
    );
  } catch {
    return false;
  }
}

export type SendOtpResult =
  | { ok: true; expiresInSec: number }
  | { ok: false; status: 429 | 502; error: string };

/** Creates and sends a fresh code; at most 3 sends per phone per 15 minutes. */
export async function sendStoreOtp(
  db: TenantDb,
  sms: SmsService,
  args: { businessId: string; businessName: string; phone: string; ip: string | null },
): Promise<SendOtpResult> {
  const { businessId, businessName, phone, ip } = args;
  const since = new Date(Date.now() - OTP_SEND_WINDOW_MS);
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(storePhoneOtps)
    .where(
      and(
        eq(storePhoneOtps.businessId, businessId),
        eq(storePhoneOtps.phone, phone),
        gt(storePhoneOtps.createdAt, since),
      ),
    );
  if ((recent?.n ?? 0) >= OTP_SENDS_PER_WINDOW) {
    return { ok: false, status: 429, error: "Too many codes requested. Please try again later." };
  }

  const code = generateOtpCode();
  const [row] = await db
    .insert(storePhoneOtps)
    .values({
      businessId,
      phone,
      codeHash: hashOtp(businessId, phone, code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      ipAddress: ip,
    })
    .returning({ id: storePhoneOtps.id });

  try {
    await sms.sendOtp(phone, code, businessName);
  } catch {
    await db.delete(storePhoneOtps).where(eq(storePhoneOtps.id, row.id));
    return { ok: false, status: 502, error: "Could not send the code. Please try again." };
  }
  return { ok: true, expiresInSec: OTP_TTL_MS / 1000 };
}

export type VerifyOtpResult =
  | { ok: true; otpToken: string; known: boolean; name?: string }
  | { ok: false; status: 400; error: string };

const INVALID_CODE = "Invalid or expired code";

/** Checks the newest live code for the phone; every wrong guess burns an attempt. */
export async function verifyStoreOtp(
  db: TenantDb,
  args: { businessId: string; phone: string; code: string },
): Promise<VerifyOtpResult> {
  const { businessId, phone, code } = args;
  const [row] = await db
    .select()
    .from(storePhoneOtps)
    .where(
      and(
        eq(storePhoneOtps.businessId, businessId),
        eq(storePhoneOtps.phone, phone),
        isNull(storePhoneOtps.verifiedAt),
        gt(storePhoneOtps.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(storePhoneOtps.createdAt))
    .limit(1);
  if (!row || row.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, status: 400, error: INVALID_CODE };
  }

  // Count the attempt first (atomically) so concurrent guesses cannot exceed the cap.
  const [claimed] = await db
    .update(storePhoneOtps)
    .set({ attempts: sql`${storePhoneOtps.attempts} + 1` })
    .where(and(eq(storePhoneOtps.id, row.id), sql`${storePhoneOtps.attempts} < ${OTP_MAX_ATTEMPTS}`))
    .returning({ id: storePhoneOtps.id });
  if (!claimed || !verifyOtpHash(businessId, phone, code, row.codeHash)) {
    return { ok: false, status: 400, error: INVALID_CODE };
  }

  const [used] = await db
    .update(storePhoneOtps)
    .set({ verifiedAt: new Date() })
    .where(and(eq(storePhoneOtps.id, row.id), isNull(storePhoneOtps.verifiedAt)))
    .returning({ id: storePhoneOtps.id });
  if (!used) return { ok: false, status: 400, error: INVALID_CODE };

  const [last] = await db
    .select({ name: storeOrders.customerName })
    .from(storeOrders)
    .where(and(eq(storeOrders.businessId, businessId), eq(storeOrders.customerPhone, phone)))
    .orderBy(desc(storeOrders.createdAt))
    .limit(1);

  return {
    ok: true,
    otpToken: signOtpToken(businessId, phone),
    known: !!last,
    ...(last ? { name: last.name } : {}),
  };
}

export async function storeRequiresOtp(db: TenantDb, businessId: string): Promise<boolean> {
  const [biz] = await db
    .select({ v: businesses.storeRequirePhoneOtp })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  return !!biz?.v;
}
