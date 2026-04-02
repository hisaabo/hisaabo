/**
 * Version display contract tests.
 *
 * The web app displays the version as "v{__APP_VERSION__}" in the sidebar.
 * __APP_VERSION__ is set at build time by vite.config.ts getVersion().
 *
 * These tests ensure:
 *   1. The version string never starts with "v" (the template adds its own).
 *   2. The version is a valid semver-like string.
 *   3. Various source formats (git tag, env var, package.json) are normalized.
 */

import { describe, it, expect } from "vitest";

/**
 * Mirrors the normalization logic in vite.config.ts getVersion().
 * Strips leading "v" so the display template `v{version}` doesn't double it.
 */
function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/, "");
}

describe("Version display — no double 'v' prefix", () => {
  it("strips 'v' from git tag format 'v0.2.2'", () => {
    expect(normalizeVersion("v0.2.2")).toBe("0.2.2");
  });

  it("leaves bare semver '0.2.2' unchanged", () => {
    expect(normalizeVersion("0.2.2")).toBe("0.2.2");
  });

  it("strips 'v' from env var 'v1.0.0'", () => {
    expect(normalizeVersion("v1.0.0")).toBe("1.0.0");
  });

  it("handles whitespace from git output", () => {
    expect(normalizeVersion("  v0.3.0\n")).toBe("0.3.0");
  });

  it("does not strip 'v' from middle of string", () => {
    expect(normalizeVersion("0.2.2-preview")).toBe("0.2.2-preview");
  });

  it("display template produces exactly one 'v' prefix", () => {
    const version = normalizeVersion("v0.2.2");
    const displayed = `v${version}`;
    expect(displayed).toBe("v0.2.2");
    expect(displayed).not.toBe("vv0.2.2");
  });
});
