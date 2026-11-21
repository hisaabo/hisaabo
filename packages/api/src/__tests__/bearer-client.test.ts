/**
 * bearer-client.test.ts — which sign-in requests receive `sessionToken` in the
 * response body (bearer clients) versus only an HttpOnly cookie (browsers).
 *
 * Includes the DEPRECATED v0.9.0 compatibility signature (remove in 0.11.0):
 * the v0.9.0 mobile app sends only `X-Requested-With: hisaabo` and reads
 * `data.sessionToken`, so it must keep receiving the token.
 */

import { describe, it, expect } from "vitest";
import { isBearerClient, isLegacyV09NativeClient } from "../lib/bearer-client";

const URL_ = "https://api.example.com/api/trpc/auth.verifyMagicLink";

function req(headers: Record<string, string>): Request {
  return new Request(URL_, { method: "POST", headers });
}

describe("isBearerClient — current clients (X-Hisaabo-Client)", () => {
  for (const client of ["desktop", "mobile", "cli"]) {
    it(`treats X-Hisaabo-Client: ${client} as a bearer client`, () => {
      expect(isBearerClient(req({ "x-hisaabo-client": client }))).toBe(true);
    });
  }

  it("is still true for the new header even if browser-ish headers are present (Tauri webview sends Origin)", () => {
    expect(
      isBearerClient(req({ "x-hisaabo-client": "desktop", origin: "http://tauri.localhost", "x-requested-with": "hisaabo" })),
    ).toBe(true);
  });

  it("ignores unknown X-Hisaabo-Client values", () => {
    expect(isBearerClient(req({ "x-hisaabo-client": "web" }))).toBe(false);
    expect(isBearerClient(req({ "x-hisaabo-client": "Mobile" }))).toBe(false);
  });
});

describe("isBearerClient — browsers never get the token in the body", () => {
  it("a plain browser POST (Origin + Sec-Fetch-* + X-Requested-With) is NOT a bearer client", () => {
    expect(
      isBearerClient(
        req({
          origin: "https://app.example.com",
          "sec-fetch-site": "same-site",
          "sec-fetch-mode": "cors",
          "sec-fetch-dest": "empty",
          "x-requested-with": "hisaabo",
        }),
      ),
    ).toBe(false);
  });

  it("Origin alone defeats the legacy signature (older browsers without Sec-Fetch-*)", () => {
    expect(isBearerClient(req({ origin: "https://app.example.com", "x-requested-with": "hisaabo" }))).toBe(false);
  });

  it("Origin: null (no-referrer same-origin POST, sandboxed iframe) defeats the legacy signature", () => {
    expect(isBearerClient(req({ origin: "null", "x-requested-with": "hisaabo" }))).toBe(false);
  });

  it("Sec-Fetch-* alone defeats the legacy signature (even if a proxy dropped Origin)", () => {
    expect(isBearerClient(req({ "sec-fetch-site": "same-origin", "x-requested-with": "hisaabo" }))).toBe(false);
    expect(isBearerClient(req({ "sec-fetch-mode": "cors", "x-requested-with": "hisaabo" }))).toBe(false);
    expect(isBearerClient(req({ "sec-fetch-dest": "empty", "x-requested-with": "hisaabo" }))).toBe(false);
    expect(isBearerClient(req({ "sec-fetch-user": "?1", "x-requested-with": "hisaabo" }))).toBe(false);
  });

  it("a request with no distinguishing headers at all is not a bearer client", () => {
    expect(isBearerClient(req({}))).toBe(false);
  });
});

describe("isBearerClient — DEPRECATED v0.9.0 native signature", () => {
  it("v0.9.0 mobile (X-Requested-With only, no Origin / Sec-Fetch) is a bearer client", () => {
    expect(isBearerClient(req({ "x-requested-with": "hisaabo", "content-type": "application/json" }))).toBe(true);
    expect(isLegacyV09NativeClient(req({ "x-requested-with": "hisaabo" }))).toBe(true);
  });

  it("v0.9.0 mobile once signed in also sends Authorization + x-business-id; still matches", () => {
    expect(
      isBearerClient(
        req({ "x-requested-with": "hisaabo", authorization: "Bearer abc", "x-business-id": "b1", "user-agent": "okhttp/4.12.0" }),
      ),
    ).toBe(true);
  });

  it("requires X-Requested-With: hisaabo exactly", () => {
    expect(isBearerClient(req({ "x-requested-with": "XMLHttpRequest" }))).toBe(false);
    expect(isBearerClient(req({ "x-requested-with": "Hisaabo" }))).toBe(false);
  });

  it("the legacy predicate itself rejects every browser-only header", () => {
    for (const name of ["origin", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest", "sec-fetch-user"]) {
      expect(isLegacyV09NativeClient(req({ "x-requested-with": "hisaabo", [name]: "x" }))).toBe(false);
    }
  });

  it("a v0.9.0 CLI request (x-client-type only, no X-Requested-With) is not matched", () => {
    // v0.9.0 CLI sign-in was already unusable (it read `result.sessionId`, which
    // the API never returned); API keys are unaffected. Deliberately not widened.
    expect(isBearerClient(req({ "x-client-type": "cli" }))).toBe(false);
  });
});
