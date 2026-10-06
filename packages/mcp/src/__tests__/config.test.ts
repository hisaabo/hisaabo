import { describe, it, expect } from "vitest";
import { validateApiUrl, validateToken } from "../lib/config.js";

describe("validateApiUrl", () => {
  it("accepts https and loopback http", () => {
    expect(validateApiUrl("https://api.hisaabo.in/x", {})).toBe("https://api.hisaabo.in");
    expect(validateApiUrl("http://localhost:3000", {})).toBe("http://localhost:3000");
    expect(validateApiUrl("http://127.0.0.1:3000", {})).toBe("http://127.0.0.1:3000");
    expect(validateApiUrl("http://[::1]:3000", {})).toBe("http://[::1]:3000");
  });

  it("rejects non-loopback http unless HISAABO_ALLOW_INSECURE=1", () => {
    expect(() => validateApiUrl("http://api.example.com", {})).toThrow(/plain http/);
    expect(validateApiUrl("http://api.example.com", { HISAABO_ALLOW_INSECURE: "1" })).toBe("http://api.example.com");
  });

  it("rejects userinfo, bad protocols and garbage", () => {
    expect(() => validateApiUrl("https://user:pw@api.example.com", {})).toThrow(/credentials/);
    expect(() => validateApiUrl("https://user@api.example.com", {})).toThrow(/credentials/);
    expect(() => validateApiUrl("ftp://x", {})).toThrow(/http/);
    expect(() => validateApiUrl("nope", {})).toThrow(/valid URL/);
  });
});

describe("validateToken", () => {
  it("requires the API key prefix unless session tokens are allowed", () => {
    expect(validateToken("hisaabo_key_abc", {})).toBe("hisaabo_key_abc");
    expect(() => validateToken("some-session-id", {})).toThrow(/API key/);
    expect(validateToken("some-session-id", { HISAABO_ALLOW_SESSION_TOKEN: "1" })).toBe("some-session-id");
  });
});
