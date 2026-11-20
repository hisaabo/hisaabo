/**
 * Build identity label shown in the sidebar footer: `v0.9.0 · abc1234`.
 *
 * vite.config.ts feeds VITE_APP_COMMIT (the full CI `github.sha`) through
 * `shortCommit`; the UI renders `appVersionLabel()`. The commit is omitted
 * entirely when absent or not a plausible SHA, so local builds look unchanged.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { appVersionLabel, COMMIT_DISPLAY_LENGTH, shortCommit, versionLabel } from "../app-version";

const SHA = "26c61bb0f3a1d2e4c5b6a79881726354abcdef01";

describe("shortCommit", () => {
  it("shortens a full SHA to 7 characters", () => {
    expect(COMMIT_DISPLAY_LENGTH).toBe(7);
    expect(shortCommit(SHA)).toBe("26c61bb");
  });

  it("accepts an already-short SHA, trims and lowercases", () => {
    expect(shortCommit("26c61bb")).toBe("26c61bb");
    expect(shortCommit(`  ${SHA.toUpperCase()}\n`)).toBe("26c61bb");
  });

  it("returns an empty string for absent or non-SHA input", () => {
    expect(shortCommit(undefined)).toBe("");
    expect(shortCommit(null)).toBe("");
    expect(shortCommit("")).toBe("");
    expect(shortCommit("unknown")).toBe("");
    expect(shortCommit("abc12")).toBe(""); // too short to identify a commit
    expect(shortCommit("main")).toBe("");
  });
});

describe("versionLabel", () => {
  it("joins version and short commit", () => {
    expect(versionLabel("0.9.0", SHA)).toBe("v0.9.0 · 26c61bb");
  });

  it("omits the commit when there is none", () => {
    expect(versionLabel("0.9.0", undefined)).toBe("v0.9.0");
    expect(versionLabel("0.9.0", "")).toBe("v0.9.0");
    expect(versionLabel("0.9.0", "unknown")).toBe("v0.9.0");
  });
});

describe("appVersionLabel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the build-time defines", () => {
    vi.stubGlobal("__APP_VERSION__", "0.10.0");
    vi.stubGlobal("__APP_COMMIT__", "26c61bb");
    expect(appVersionLabel()).toBe("v0.10.0 · 26c61bb");
  });

  it("omits the commit when the define is empty", () => {
    vi.stubGlobal("__APP_VERSION__", "0.10.0");
    vi.stubGlobal("__APP_COMMIT__", "");
    expect(appVersionLabel()).toBe("v0.10.0");
  });

  it("does not throw when __APP_COMMIT__ is not defined at all (tests, tools)", () => {
    vi.stubGlobal("__APP_VERSION__", "0.10.0");
    expect(appVersionLabel()).toBe("v0.10.0");
  });
});
