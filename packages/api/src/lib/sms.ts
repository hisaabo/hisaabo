import { createHmac } from "node:crypto";
import { logger } from "./logger.js";

export interface SmsService {
  sendOtp(phone: string, code: string, businessName: string): Promise<void>;
}

export function otpMessage(code: string, businessName: string): string {
  return `${code} is your verification code for ${businessName}. It is valid for 10 minutes. Do not share it with anyone.`;
}

/** Development-only provider: logs the message instead of sending it. */
export class ConsoleSmsService implements SmsService {
  constructor() {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SMS_PROVIDER=console is not allowed in production");
    }
  }

  async sendOtp(phone: string, code: string, businessName: string): Promise<void> {
    logger.info({ to: `+91${phone}`, message: otpMessage(code, businessName) }, "[sms:console] OTP");
  }
}

export function signSmsBody(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/** POSTs `{to, message}` as JSON to a gateway, signed with `X-Hisaabo-Signature`. */
export class WebhookSmsService implements SmsService {
  constructor(
    private readonly url: string,
    private readonly secret: string,
  ) {}

  async sendOtp(phone: string, code: string, businessName: string): Promise<void> {
    const body = JSON.stringify({ to: `+91${phone}`, message: otpMessage(code, businessName) });
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hisaabo-Signature": signSmsBody(this.secret, body),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`SMS webhook responded with ${res.status}`);
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Returns the configured provider, or null when SMS is not (validly) configured. */
export function createSmsService(env: NodeJS.ProcessEnv = process.env): SmsService | null {
  const provider = env.SMS_PROVIDER?.trim().toLowerCase();
  if (provider === "console") {
    return env.NODE_ENV === "production" ? null : new ConsoleSmsService();
  }
  if (provider === "webhook") {
    const url = env.SMS_WEBHOOK_URL?.trim();
    const secret = env.SMS_WEBHOOK_SECRET;
    if (!url || !secret || !isHttpUrl(url)) return null;
    return new WebhookSmsService(url, secret);
  }
  return null;
}

export function isSmsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return createSmsService(env) !== null;
}
