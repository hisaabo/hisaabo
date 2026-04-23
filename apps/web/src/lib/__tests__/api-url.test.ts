/**
 * api-url helper unit tests.
 *
 * This helper fixes a production bug: several non-tRPC fetches in the web
 * app (invoice PDF, ledger PDF) were hardcoded to relative "/api/..." URLs.
 * In single-origin deploys that works fine — Vite's dev proxy or nginx
 * forwards /api/* to the API. In split-host deploys (e.g. app.hisaabo.in
 * for the web bundle, api.hisaabo.in for the API) the relative URL hits
 * the web host's SPA fallback and returns index.html, which downloads
 * as an "HTML PDF" for the user.
 *
 * The helper mirrors the existing trpc.ts resolver so both follow the
 * same VITE_API_URL convention. These tests lock that contract in place.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { apiUrl } from "../api-url";

describe("apiUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the path unchanged when VITE_API_URL is unset (single-origin / dev)", () => {
    vi.stubEnv("VITE_API_URL", "");
    expect(apiUrl("/api/invoices/abc/pdf?format=a5")).toBe(
      "/api/invoices/abc/pdf?format=a5",
    );
  });

  it("prefixes the path with VITE_API_URL when set (split-host prod)", () => {
    vi.stubEnv("VITE_API_URL", "https://api.hisaabo.in");
    expect(apiUrl("/api/invoices/abc/pdf?format=a5")).toBe(
      "https://api.hisaabo.in/api/invoices/abc/pdf?format=a5",
    );
  });

  it("produces an absolute URL that resolves to the API origin in split-host mode", () => {
    vi.stubEnv("VITE_API_URL", "https://api.hisaabo.in");
    const result = apiUrl("/api/parties/p1/ledger.pdf?from=2024-04-01");
    expect(new URL(result).origin).toBe("https://api.hisaabo.in");
    expect(new URL(result).pathname).toBe("/api/parties/p1/ledger.pdf");
  });

  it("keeps the path same-origin when VITE_API_URL is empty (browser resolution)", () => {
    vi.stubEnv("VITE_API_URL", "");
    const baseUrl = "https://app.hisaabo.in";
    const resolved = new URL(apiUrl("/api/invoices/abc/pdf"), baseUrl).href;
    expect(resolved).toBe("https://app.hisaabo.in/api/invoices/abc/pdf");
    // The whole bug this helper guards against: in split-host prod, this
    // same-origin resolution would hit the SPA and return HTML.
    expect(new URL(resolved).origin).toBe(baseUrl);
  });

  it("preserves query strings and special characters in the path", () => {
    vi.stubEnv("VITE_API_URL", "https://api.hisaabo.in");
    expect(
      apiUrl("/api/invoices/abc/pdf?format=a5&download=true"),
    ).toBe(
      "https://api.hisaabo.in/api/invoices/abc/pdf?format=a5&download=true",
    );
  });
});
