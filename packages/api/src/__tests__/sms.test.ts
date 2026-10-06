import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { createSmsService, isSmsConfigured, ConsoleSmsService, WebhookSmsService, signSmsBody } from "../lib/sms.js";

afterEach(() => vi.unstubAllGlobals());

describe("createSmsService", () => {
  it("is unconfigured by default", () => {
    expect(createSmsService({} as NodeJS.ProcessEnv)).toBeNull();
    expect(isSmsConfigured({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("allows console only outside production", () => {
    expect(createSmsService({ SMS_PROVIDER: "console", NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBeInstanceOf(ConsoleSmsService);
    expect(createSmsService({ SMS_PROVIDER: "console", NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBeNull();
    expect(isSmsConfigured({ SMS_PROVIDER: "console", NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("ConsoleSmsService refuses to be constructed in production", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => new ConsoleSmsService()).toThrow();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it("webhook needs a valid url and secret", () => {
    const base = { SMS_PROVIDER: "webhook", NODE_ENV: "production" };
    expect(createSmsService({ ...base } as NodeJS.ProcessEnv)).toBeNull();
    expect(createSmsService({ ...base, SMS_WEBHOOK_URL: "https://sms.example/send" } as NodeJS.ProcessEnv)).toBeNull();
    expect(createSmsService({ ...base, SMS_WEBHOOK_URL: "ftp://x", SMS_WEBHOOK_SECRET: "s" } as NodeJS.ProcessEnv)).toBeNull();
    expect(createSmsService({ ...base, SMS_WEBHOOK_URL: "https://sms.example/send", SMS_WEBHOOK_SECRET: "s" } as NodeJS.ProcessEnv)).toBeInstanceOf(WebhookSmsService);
  });
});

describe("WebhookSmsService", () => {
  it("posts a signed JSON body with a +91 number", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    await new WebhookSmsService("https://sms.example/send", "topsecret").sendOtp("9876543210", "123456", "Acme");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sms.example/send");
    const body = init.body as string;
    const parsed = JSON.parse(body);
    expect(parsed.to).toBe("+919876543210");
    expect(parsed.message).toContain("123456");
    expect(parsed.message).toContain("Acme");
    expect(init.headers["X-Hisaabo-Signature"]).toBe(createHmac("sha256", "topsecret").update(body).digest("hex"));
    expect(signSmsBody("topsecret", body)).toBe(init.headers["X-Hisaabo-Signature"]);
  });

  it("throws when the gateway rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(new WebhookSmsService("https://sms.example/send", "s").sendOtp("9876543210", "1", "A")).rejects.toThrow();
  });
});
