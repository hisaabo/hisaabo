/**
 * legacy-v09-compat.test.ts — DEPRECATED v0.9.x compatibility helpers
 * (remove in 0.11.0) and the LEGACY_V09_CLIENT_COMPAT kill switch.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  legacyV09CompatEnabled,
  isTauriDesktopRequest,
  isLegacyCaptchaExempt,
  legacyHandoffSource,
  isLegacyV09NativeClient,
} from "../lib/legacy-v09-compat";
import { isBearerClient } from "../lib/bearer-client";

const SAVED = process.env.LEGACY_V09_CLIENT_COMPAT;
afterEach(() => {
  if (SAVED === undefined) delete process.env.LEGACY_V09_CLIENT_COMPAT;
  else process.env.LEGACY_V09_CLIENT_COMPAT = SAVED;
});

function req(headers: Record<string, string>): Request {
  return new Request("https://api.example.com/api/trpc/auth.sendMagicLink", { method: "POST", headers });
}

const legacyMobile = { "x-requested-with": "hisaabo" };
const tauri = { "x-hisaabo-client": "desktop", origin: "http://tauri.localhost", "x-requested-with": "hisaabo" };

describe("legacyV09CompatEnabled", () => {
  it("is on by default and only the literal string 'false' turns it off", () => {
    delete process.env.LEGACY_V09_CLIENT_COMPAT;
    expect(legacyV09CompatEnabled()).toBe(true);
    process.env.LEGACY_V09_CLIENT_COMPAT = "true";
    expect(legacyV09CompatEnabled()).toBe(true);
    process.env.LEGACY_V09_CLIENT_COMPAT = "0";
    expect(legacyV09CompatEnabled()).toBe(true);
    process.env.LEGACY_V09_CLIENT_COMPAT = "false";
    expect(legacyV09CompatEnabled()).toBe(false);
  });
});

describe("isTauriDesktopRequest", () => {
  it("needs X-Hisaabo-Client: desktop AND a Tauri webview Origin", () => {
    for (const origin of ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"]) {
      expect(isTauriDesktopRequest(req({ "x-hisaabo-client": "desktop", origin }))).toBe(true);
    }
  });

  it("rejects the header without an Origin, with a web Origin, or with another client value", () => {
    expect(isTauriDesktopRequest(req({ "x-hisaabo-client": "desktop" }))).toBe(false);
    expect(isTauriDesktopRequest(req({ "x-hisaabo-client": "desktop", origin: "https://app.example.com" }))).toBe(false);
    expect(isTauriDesktopRequest(req({ "x-hisaabo-client": "mobile", origin: "http://tauri.localhost" }))).toBe(false);
    expect(isTauriDesktopRequest(req({ origin: "http://tauri.localhost" }))).toBe(false);
  });
});

describe("isLegacyCaptchaExempt", () => {
  it("exempts the v0.9.0 mobile shape and the Tauri desktop shape", () => {
    expect(isLegacyCaptchaExempt(req(legacyMobile))).toBe(true);
    expect(isLegacyCaptchaExempt(req(tauri))).toBe(true);
  });

  it("does not exempt a bare client header, a web Origin, or any browser-ish header", () => {
    expect(isLegacyCaptchaExempt(req({ "x-hisaabo-client": "mobile" }))).toBe(false);
    expect(isLegacyCaptchaExempt(req({ "x-hisaabo-client": "cli" }))).toBe(false);
    expect(isLegacyCaptchaExempt(req({ "x-hisaabo-client": "desktop" }))).toBe(false);
    expect(isLegacyCaptchaExempt(req({ ...legacyMobile, origin: "https://app.example.com" }))).toBe(false);
    expect(isLegacyCaptchaExempt(req({ ...legacyMobile, "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(isLegacyCaptchaExempt(req({}))).toBe(false);
  });

  it("is off when the kill switch is set", () => {
    process.env.LEGACY_V09_CLIENT_COMPAT = "false";
    expect(isLegacyCaptchaExempt(req(legacyMobile))).toBe(false);
    expect(isLegacyCaptchaExempt(req(tauri))).toBe(false);
  });
});

describe("legacyHandoffSource", () => {
  it("passes through an explicit mobile | desktop source", () => {
    expect(legacyHandoffSource(req({}), "mobile")).toBe("mobile");
    expect(legacyHandoffSource(req({}), "desktop")).toBe("desktop");
  });

  it("infers desktop for the Tauri webview when no source was sent", () => {
    expect(legacyHandoffSource(req(tauri), undefined)).toBe("desktop");
    expect(legacyHandoffSource(req(tauri), "web")).toBe("desktop");
  });

  it("is null for web and for anything else", () => {
    expect(legacyHandoffSource(req({}), "web")).toBeNull();
    expect(legacyHandoffSource(req({}), undefined)).toBeNull();
    expect(legacyHandoffSource(req({ "x-hisaabo-client": "desktop" }), "web")).toBeNull();
    expect(legacyHandoffSource(req({}), "evil")).toBeNull();
  });

  it("is always null when the kill switch is set", () => {
    process.env.LEGACY_V09_CLIENT_COMPAT = "false";
    expect(legacyHandoffSource(req({}), "mobile")).toBeNull();
    expect(legacyHandoffSource(req(tauri), "desktop")).toBeNull();
  });
});

describe("kill switch also disables the bearer-client legacy signature", () => {
  it("v0.9.0 mobile shape is a bearer client by default and not when disabled", () => {
    expect(isLegacyV09NativeClient(req(legacyMobile))).toBe(true);
    expect(isBearerClient(req(legacyMobile))).toBe(true);
    process.env.LEGACY_V09_CLIENT_COMPAT = "false";
    expect(isBearerClient(req(legacyMobile))).toBe(false);
    // The current X-Hisaabo-Client contract is unaffected by the switch.
    expect(isBearerClient(req({ "x-hisaabo-client": "mobile" }))).toBe(true);
  });
});
