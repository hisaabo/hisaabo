import { describe, it, expect } from "vitest";
import { generateWellKnown } from "../well-known";

const SHA_A = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0").toUpperCase()).join(":");
const SHA_B = Array.from({ length: 32 }, () => "AB").join(":");

describe("generateWellKnown", () => {
  it("builds both files from env", () => {
    const { assetlinks, aasa, warnings } = generateWellKnown({
      VITE_ANDROID_APP_CERT_SHA256: `${SHA_A}, ${SHA_B.toLowerCase()}`,
      VITE_APPLE_TEAM_ID: "ABCDE12345",
    });
    expect(warnings).toEqual([]);
    expect((assetlinks as any)[0].target.sha256_cert_fingerprints).toEqual([SHA_A, SHA_B]);
    const detail = (aasa as any).applinks.details[0];
    expect(detail.appID).toBe("ABCDE12345.in.hisaabo.app");
    expect(detail.paths).toEqual(["/auth/native/callback*", "/auth/verify*", "/invite/*"]);
  });

  it("falls back to placeholders with warnings when env is unset", () => {
    const { assetlinks, aasa, warnings } = generateWellKnown({});
    expect(warnings).toHaveLength(2);
    expect((assetlinks as any)[0].target.sha256_cert_fingerprints[0]).toContain("TODO");
    expect((aasa as any).applinks.details[0].appID).toBe("TEAM_ID.in.hisaabo.app");
  });

  it("rejects malformed values", () => {
    expect(() => generateWellKnown({ VITE_ANDROID_APP_CERT_SHA256: "nope" })).toThrow();
    expect(() => generateWellKnown({ VITE_APPLE_TEAM_ID: "short" })).toThrow();
  });
});
