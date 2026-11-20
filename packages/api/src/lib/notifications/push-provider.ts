/**
 * Push transports (docs/architecture/notifications.md §5, §8, §10).
 *
 * PUSH_PROVIDER selects how mobile push leaves this server:
 *   - "gorush": Hisaabo Cloud (or a self-hoster with their own app build and
 *               credentials). POSTs to a Gorush sidecar on the private network.
 *   - "none":   the default. Inbox, email and (later) web push still work.
 *
 * Gorush's /api/push is unauthenticated, so GORUSH_URL must point at a private
 * address (the compose service name). Gorush runs in sync mode so each call
 * returns the delivery result; tokens are masked in its response, so we send
 * one device per request and attribute failures by request.
 */

import { logger } from "../logger.js";

export type DevicePlatform = "ios" | "android" | "web" | "unifiedpush";

export interface PushDevice {
  id: string;
  platform: DevicePlatform;
  token: string; // decrypted device token / endpoint
}

export interface PushMessage {
  /** Placeholder text shown if the device cannot decrypt (never sensitive). */
  fallbackTitle: string;
  fallbackBody: string;
  /** base64url RFC 8188 ciphertext, or null when the device registered no keys. */
  encrypted: string | null;
  notificationId: string;
  channel: string;
  /** Security / locked events. */
  urgent: boolean;
  /** Android FCM priority: high only for channels whose importance is high. */
  highPriority: boolean;
  iosInterruptionLevel: "active" | "passive" | "time-sensitive";
  /** Collapses repeated notifications about the same thing. */
  collapseKey: string;
}

export type PushResult =
  | { ok: true }
  | { ok: false; permanent: boolean; error: string };

export interface PushProvider {
  readonly name: string;
  /** Which device platforms this provider can deliver to. */
  supports(platform: DevicePlatform): boolean;
  send(device: PushDevice, message: PushMessage): Promise<PushResult>;
}

export class NoopPushProvider implements PushProvider {
  readonly name = "none";
  supports(): boolean {
    return false;
  }
  async send(): Promise<PushResult> {
    return { ok: false, permanent: false, error: "push disabled" };
  }
}

// Errors meaning the token will never work again → delete the registration.
const DEAD_TOKEN_PATTERNS = [
  /InvalidRegistration/i,
  /NotRegistered/i,
  /Unregistered/i,
  /BadDeviceToken/i,
  /DeviceTokenNotForTopic/i,
  /registration-token-not-registered/i,
  /Requested entity was not found/i,
  /invalid registration token/i,
];

export function isDeadTokenError(error: string): boolean {
  return DEAD_TOKEN_PATTERNS.some((re) => re.test(error));
}

interface GorushResponse {
  counts?: number;
  success?: string;
  logs?: Array<{ type?: string; error?: string }>;
}

export class GorushPushProvider implements PushProvider {
  readonly name = "gorush";

  constructor(
    private readonly baseUrl: string,
    private readonly apnsTopic: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  supports(platform: DevicePlatform): boolean {
    return platform === "ios" || platform === "android";
  }

  /** Build the Gorush notification object for one device. Exported for tests. */
  buildNotification(device: PushDevice, message: PushMessage): Record<string, unknown> {
    const data: Record<string, string> = {
      v: "1",
      nid: message.notificationId,
      ch: message.channel,
    };
    if (message.encrypted) data.e = message.encrypted;

    if (device.platform === "ios") {
      return {
        tokens: [device.token],
        platform: 1,
        topic: this.apnsTopic,
        title: message.fallbackTitle,
        message: message.fallbackBody,
        // The Notification Service Extension decrypts `e` and replaces the text.
        mutable_content: true,
        interruption_level: message.iosInterruptionLevel,
        thread_id: message.channel,
        collapse_id: message.collapseKey.slice(0, 64),
        push_type: "alert",
        data,
      };
    }
    // Android: data-only message. The app's messaging service decrypts and
    // posts the notification itself on the matching notification channel.
    return {
      tokens: [device.token],
      platform: 2,
      priority: message.urgent || message.highPriority ? "high" : "normal",
      collapse_key: message.collapseKey,
      data,
    };
  }

  async send(device: PushDevice, message: PushMessage): Promise<PushResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/api/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifications: [this.buildNotification(device, message)] }),
        signal: controller.signal,
      });
      if (!res.ok) {
        return { ok: false, permanent: false, error: `gorush HTTP ${res.status}` };
      }
      const json = (await res.json().catch(() => ({}))) as GorushResponse;
      const failure = json.logs?.find((l) => l.type === "failed-push");
      if (failure) {
        const error = failure.error ?? "unknown push failure";
        return { ok: false, permanent: isDeadTokenError(error), error };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, permanent: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }
}

let provider: PushProvider | null = null;

export function createPushProviderFromEnv(env: NodeJS.ProcessEnv = process.env): PushProvider {
  const kind = (env.PUSH_PROVIDER ?? "none").toLowerCase();
  if (kind === "gorush") {
    const url = env.GORUSH_URL;
    const topic = env.APNS_TOPIC ?? "in.hisaabo.app";
    if (!url) {
      logger.warn("[notifications] PUSH_PROVIDER=gorush but GORUSH_URL is not set — push disabled");
      return new NoopPushProvider();
    }
    return new GorushPushProvider(url, topic);
  }
  if (kind !== "none") {
    logger.warn({ kind }, "[notifications] unknown PUSH_PROVIDER — push disabled");
  }
  return new NoopPushProvider();
}

export function getPushProvider(): PushProvider {
  if (!provider) provider = createPushProviderFromEnv();
  return provider;
}

/** Test hook. */
export function setPushProvider(next: PushProvider | null): void {
  provider = next;
}
