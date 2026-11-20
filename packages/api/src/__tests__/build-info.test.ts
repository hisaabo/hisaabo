/**
 * build-info.test.ts — the single source of truth for "which build is this?".
 *
 * Release images bake HISAABO_VERSION / HISAABO_COMMIT (see Dockerfile and
 * release.yml). The module must normalise them so the startup log, admin TUI,
 * `auth.me` and the export manifest can never disagree, and must degrade to
 * the package.json version / "unknown" rather than guess when a build recorded
 * nothing. Pure: no database needed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildInfo,
  normalizeCommit,
  normalizeVersion,
  readPackageVersion,
  resolveBuildInfo,
  shortCommit,
  UNKNOWN_COMMIT,
} from "../lib/build-info.js";
import { APP_VERSION } from "../lib/exportManifest.js";

const SHA = "26c61bb0f3a1d2e4c5b6a79881726354abcdef01";

describe("normalizeVersion", () => {
  it("strips a leading v so `v0.9.0` and `0.9.0` agree", () => {
    expect(normalizeVersion("v0.9.0")).toBe("0.9.0");
    expect(normalizeVersion("0.9.0")).toBe("0.9.0");
    expect(normalizeVersion(" v0.10.0-rc.1\n")).toBe("0.10.0-rc.1");
  });

  it("treats empty and the Dockerfile placeholder `dev` as unset", () => {
    expect(normalizeVersion(undefined)).toBeNull();
    expect(normalizeVersion("")).toBeNull();
    expect(normalizeVersion("dev")).toBeNull();
    expect(normalizeVersion("vdev")).toBeNull();
  });
});

describe("normalizeCommit", () => {
  it("accepts a hex SHA and lowercases it", () => {
    expect(normalizeCommit(SHA)).toBe(SHA);
    expect(normalizeCommit(` ${SHA.toUpperCase()} `)).toBe(SHA);
  });

  it("falls back to 'unknown' for anything that is not a SHA", () => {
    expect(normalizeCommit(undefined)).toBe(UNKNOWN_COMMIT);
    expect(normalizeCommit("")).toBe(UNKNOWN_COMMIT);
    expect(normalizeCommit("unknown")).toBe(UNKNOWN_COMMIT);
    expect(normalizeCommit("not-a-sha")).toBe(UNKNOWN_COMMIT);
    expect(normalizeCommit("abc12")).toBe(UNKNOWN_COMMIT); // too short to identify a commit
  });
});

describe("shortCommit", () => {
  it("returns the first 12 characters (the sha-<12> image tag)", () => {
    expect(shortCommit(SHA)).toBe("26c61bb0f3a1");
    expect(shortCommit(SHA, 7)).toBe("26c61bb");
  });

  it("leaves 'unknown' alone", () => {
    expect(shortCommit(UNKNOWN_COMMIT)).toBe("unknown");
  });
});

describe("resolveBuildInfo", () => {
  it("uses the baked env, normalised", () => {
    expect(resolveBuildInfo({ HISAABO_VERSION: "v0.10.0", HISAABO_COMMIT: SHA }, () => "9.9.9")).toEqual({
      version: "0.10.0",
      commit: SHA,
    });
  });

  it("falls back to the package.json version and 'unknown' when nothing was baked in", () => {
    expect(resolveBuildInfo({}, () => "9.9.9")).toEqual({ version: "9.9.9", commit: UNKNOWN_COMMIT });
    expect(resolveBuildInfo({ HISAABO_VERSION: "dev", HISAABO_COMMIT: "unknown" }, () => "9.9.9")).toEqual({
      version: "9.9.9",
      commit: UNKNOWN_COMMIT,
    });
  });
});

describe("readPackageVersion", () => {
  it("reads this package's package.json", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8")) as { version: string };
    expect(readPackageVersion()).toBe(pkg.version);
  });
});

describe("process-level build info", () => {
  it("never carries a leading v and matches the export manifest's APP_VERSION", () => {
    expect(buildInfo.version).not.toMatch(/^v/);
    expect(APP_VERSION).toBe(buildInfo.version);
  });

  it("is frozen so no caller can drift from the others", () => {
    expect(Object.isFrozen(buildInfo)).toBe(true);
  });
});
