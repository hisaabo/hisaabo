/**
 * Unit tests for push payload encryption and the Gorush transport. No DB.
 */

import { describe, it, expect } from "vitest";
import { createECDH, randomBytes } from "node:crypto";
import {
  b64urlDecode,
  decryptOnDevice,
  encryptForDevice,
  isValidDeviceKeys,
} from "../lib/notifications/push-crypto.js";
import {
  GorushPushProvider,
  NoopPushProvider,
  createPushProviderFromEnv,
  isDeadTokenError,
  type PushMessage,
} from "../lib/notifications/push-provider.js";
import { quotaConfigFromEnv } from "../lib/notifications/quota.js";
import { overdueBucket } from "../lib/notifications/collections-sweep.js";
import { renderNotificationEmailHtml } from "../lib/email.js";

describe("push-crypto (RFC 8291 / RFC 8188 aes128gcm)", () => {
  it("matches the RFC 8291 Appendix A test vector", () => {
    const body = encryptForDevice(
      "When I grow up, I want to be a watermelon",
      "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
      "BTBZMqHH6r4Tts7J_aSIgg",
      {
        salt: b64urlDecode("DGv6ra1nlYgDCS1FRnbzlw"),
        serverPrivateKey: b64urlDecode("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
      },
    );
    expect(body.toString("base64url")).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
    const plain = decryptOnDevice(body, b64urlDecode("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"), "BTBZMqHH6r4Tts7J_aSIgg");
    expect(plain.toString()).toBe("When I grow up, I want to be a watermelon");
  });

  it("round-trips unicode payloads with fresh keys and fails with the wrong key", () => {
    const device = createECDH("prime256v1");
    device.generateKeys();
    const auth = randomBytes(16).toString("base64url");
    const body = encryptForDevice('{"t":"₹1,20,000 प्राप्त हुए"}', device.getPublicKey().toString("base64url"), auth);
    expect(decryptOnDevice(body, device.getPrivateKey(), auth).toString()).toBe('{"t":"₹1,20,000 प्राप्त हुए"}');

    const other = createECDH("prime256v1");
    other.generateKeys();
    expect(() => decryptOnDevice(body, other.getPrivateKey(), auth)).toThrow();
  });

  it("validates device keys", () => {
    const device = createECDH("prime256v1");
    device.generateKeys();
    const pub = device.getPublicKey().toString("base64url");
    expect(isValidDeviceKeys(pub, randomBytes(16).toString("base64url"))).toBe(true);
    expect(isValidDeviceKeys(pub, randomBytes(8).toString("base64url"))).toBe(false);
    expect(isValidDeviceKeys(Buffer.alloc(65, 4).toString("base64url"), randomBytes(16).toString("base64url"))).toBe(false);
  });

  it("refuses payloads that do not fit one record", () => {
    const device = createECDH("prime256v1");
    device.generateKeys();
    expect(() => encryptForDevice("x".repeat(5000), device.getPublicKey().toString("base64url"), randomBytes(16).toString("base64url")))
      .toThrow(/too large/);
  });
});

const message: PushMessage = {
  fallbackTitle: "Payment received",
  fallbackBody: "Hisaabo",
  encrypted: "ciphertext",
  notificationId: "n1",
  channel: "money_in",
  urgent: false,
  highPriority: true,
  iosInterruptionLevel: "active",
  collapseKey: "money_in:payment.received:p1",
};

function fakeFetch(response: unknown, status = 200) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(response), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("GorushPushProvider", () => {
  it("sends Android as a data-only message and iOS as a mutable alert", async () => {
    const { impl, calls } = fakeFetch({ counts: 1, logs: [], success: "ok" });
    const p = new GorushPushProvider("http://gorush:8088/", "in.hisaabo.app", impl);
    expect(await p.send({ id: "d1", platform: "android", token: "tok-a" }, message)).toEqual({ ok: true });
    expect(await p.send({ id: "d2", platform: "ios", token: "tok-i" }, message)).toEqual({ ok: true });

    expect(calls[0].url).toBe("http://gorush:8088/api/push");
    const android = (calls[0].body as { notifications: Array<Record<string, unknown>> }).notifications[0];
    expect(android).toMatchObject({ platform: 2, tokens: ["tok-a"], data: { e: "ciphertext", nid: "n1", ch: "money_in" } });
    expect(android).not.toHaveProperty("title");
    expect(android.priority).toBe("high");

    const ios = (calls[1].body as { notifications: Array<Record<string, unknown>> }).notifications[0];
    expect(ios).toMatchObject({
      platform: 1, topic: "in.hisaabo.app", mutable_content: true, title: "Payment received",
      interruption_level: "active", data: { e: "ciphertext" },
    });
  });

  it("classifies dead tokens as permanent and transport errors as transient", async () => {
    const dead = new GorushPushProvider("http://g", "t", fakeFetch({ logs: [{ type: "failed-push", error: "NotRegistered" }] }).impl);
    expect(await dead.send({ id: "d", platform: "android", token: "x" }, message)).toEqual({ ok: false, permanent: true, error: "NotRegistered" });

    const down = new GorushPushProvider("http://g", "t", fakeFetch({}, 503).impl);
    expect(await down.send({ id: "d", platform: "ios", token: "x" }, message)).toMatchObject({ ok: false, permanent: false });

    expect(isDeadTokenError("Requested entity was not found.")).toBe(true);
    expect(isDeadTokenError("context deadline exceeded")).toBe(false);
  });

  it("is only enabled when configured", () => {
    expect(createPushProviderFromEnv({})).toBeInstanceOf(NoopPushProvider);
    expect(createPushProviderFromEnv({ PUSH_PROVIDER: "gorush" })).toBeInstanceOf(NoopPushProvider);
    expect(createPushProviderFromEnv({ PUSH_PROVIDER: "gorush", GORUSH_URL: "http://gorush:8088" }).name).toBe("gorush");
    expect(new NoopPushProvider().supports()).toBe(false);
  });
});

describe("quota config", () => {
  it("cloud has instance limits; self-hosted is unlimited unless configured", () => {
    expect(quotaConfigFromEnv({ MULTI_TENANT: "true" })).toMatchObject({ instancePerDay: 2_000_000, instancePerMinute: 2_000, tenantLimitsEnabled: true });
    const selfHosted = quotaConfigFromEnv({});
    expect(selfHosted.instancePerDay).toBe(Infinity);
    expect(selfHosted.tenantLimitsEnabled).toBe(false);
    expect(selfHosted.userPerHour).toBe(60);
    expect(quotaConfigFromEnv({ PUSH_QUOTA_INSTANCE_DAY: "10" }).instancePerDay).toBe(10);
  });
});

describe("collections buckets", () => {
  it("fires only within three days of crossing a bucket", () => {
    expect(overdueBucket(6)).toBeNull();
    expect(overdueBucket(7)).toBe(7);
    expect(overdueBucket(9)).toBe(7);
    expect(overdueBucket(10)).toBeNull();
    expect(overdueBucket(30)).toBe(30);
    expect(overdueBucket(62)).toBe(60);
    expect(overdueBucket(400)).toBeNull();
  });
});

describe("notification email", () => {
  it("escapes user-controlled text", () => {
    const html = renderNotificationEmailHtml({
      title: "<script>alert(1)</script> paid",
      body: "Party \"X\" & co",
      url: "https://app.hisaabo.in/payments?id=1",
      locale: "en",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; co");
  });
});
