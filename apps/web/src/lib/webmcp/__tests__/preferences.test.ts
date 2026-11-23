import { describe, it, expect, afterEach, vi } from "vitest";
import {
  LEGACY_WEBMCP_PREF_KEY,
  agentPreferenceKey,
  isAgentAccessEnabled,
  setAgentAccessEnabled,
  subscribeAgentAccess,
  type AgentPreferenceScope,
} from "../preferences";

const ASHA: AgentPreferenceScope = { userId: "user-asha", tenantId: "tenant-1" };
const RAVI: AgentPreferenceScope = { userId: "user-ravi", tenantId: "tenant-1" };

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("agent access preference", () => {
  it("defaults to off when nothing is stored", () => {
    expect(isAgentAccessEnabled(ASHA)).toBe(false);
  });

  it("is always off without a scope (not signed in)", () => {
    localStorage.setItem(agentPreferenceKey(ASHA), "on");
    expect(isAgentAccessEnabled(null)).toBe(false);
    expect(isAgentAccessEnabled(undefined)).toBe(false);
    setAgentAccessEnabled(null, true);
    expect(localStorage.length).toBe(1);
  });

  it("only an explicit 'on' under the scoped key counts", () => {
    const key = agentPreferenceKey(ASHA);
    for (const value of ["off", "garbage", "true", "1", ""]) {
      localStorage.setItem(key, value);
      expect(isAgentAccessEnabled(ASHA), value).toBe(false);
    }
    localStorage.setItem(key, "on");
    expect(isAgentAccessEnabled(ASHA)).toBe(true);
  });

  it("round-trips and notifies subscribers with the scope's own value", () => {
    const listener = vi.fn();
    const off = subscribeAgentAccess(ASHA, listener);
    setAgentAccessEnabled(ASHA, true);
    expect(isAgentAccessEnabled(ASHA)).toBe(true);
    expect(listener).toHaveBeenLastCalledWith(true);
    setAgentAccessEnabled(ASHA, false);
    expect(isAgentAccessEnabled(ASHA)).toBe(false);
    expect(listener).toHaveBeenLastCalledWith(false);
    off();
  });

  it("fails closed when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(isAgentAccessEnabled(ASHA)).toBe(false);
  });
});

describe("the preference belongs to a person in an organization", () => {
  it("is keyed by user and tenant", () => {
    expect(agentPreferenceKey(ASHA)).toBe("hisaabo-webmcp:user-asha:tenant-1");
    expect(agentPreferenceKey({ userId: "user-asha", tenantId: null })).toBe("hisaabo-webmcp:user-asha:-");
  });

  it("does not leak to the next person who signs in on the same browser", () => {
    setAgentAccessEnabled(ASHA, true);
    expect(isAgentAccessEnabled(ASHA)).toBe(true);
    // Ravi signs in on the same browser profile: he starts from off.
    expect(isAgentAccessEnabled(RAVI)).toBe(false);
    // ...and turning his on does not touch Asha's.
    setAgentAccessEnabled(RAVI, true);
    setAgentAccessEnabled(RAVI, false);
    expect(isAgentAccessEnabled(ASHA)).toBe(true);
  });

  it("does not carry over to another organization of the same person", () => {
    setAgentAccessEnabled(ASHA, true);
    expect(isAgentAccessEnabled({ userId: ASHA.userId, tenantId: "tenant-2" })).toBe(false);
    expect(isAgentAccessEnabled({ userId: ASHA.userId, tenantId: null })).toBe(false);
  });

  it("cannot be spoofed by a user id that looks like a separator", () => {
    setAgentAccessEnabled({ userId: "a", tenantId: "b:c" }, true);
    expect(isAgentAccessEnabled({ userId: "a:b", tenantId: "c" })).toBe(false);
  });
});

describe("migration from the browser-wide key", () => {
  it("does not honour the old key, whatever it says, and removes it", () => {
    for (const value of ["on", "true", "off"]) {
      localStorage.setItem(LEGACY_WEBMCP_PREF_KEY, value);
      expect(isAgentAccessEnabled(ASHA), value).toBe(false);
      expect(localStorage.getItem(LEGACY_WEBMCP_PREF_KEY), value).toBeNull();
    }
  });

  it("removes the old key when a scoped preference is written too, and leaves scoped keys alone", () => {
    setAgentAccessEnabled(ASHA, true);
    localStorage.setItem(LEGACY_WEBMCP_PREF_KEY, "on");
    setAgentAccessEnabled(RAVI, false);
    expect(localStorage.getItem(LEGACY_WEBMCP_PREF_KEY)).toBeNull();
    expect(isAgentAccessEnabled(ASHA)).toBe(true);
  });

  it("everyone who had it on under the old key is off after the upgrade", () => {
    localStorage.setItem(LEGACY_WEBMCP_PREF_KEY, "on");
    expect(isAgentAccessEnabled(ASHA)).toBe(false);
    expect(isAgentAccessEnabled(RAVI)).toBe(false);
  });
});
