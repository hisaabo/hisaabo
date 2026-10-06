import { describe, it, expect } from "vitest";
import { base64UrlEncode, codeChallengeS256, generateCodeVerifier, generateState } from "../pkce";

describe("pkce", () => {
  it("matches the RFC 7636 Appendix B test vector", async () => {
    const octets = new Uint8Array([
      116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77,
      105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
    ]);
    const verifier = base64UrlEncode(octets);
    expect(verifier).toBe("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    expect(await codeChallengeS256(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("generates URL-safe verifiers of the contract length and unique values", () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("generates state values accepted by the API pattern", () => {
    expect(generateState()).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  });

  it("produces 43-character challenges", async () => {
    expect(await codeChallengeS256(generateCodeVerifier())).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
