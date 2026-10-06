import { describe, it, expect, beforeEach } from "vitest";
import {
  clearNativeRequest,
  isSafeNativeRedirect,
  nativeRequestFromUrl,
  peekNativeRequest,
  stashNativeRequest,
} from "../native-login";

const ID = "0b7e1f4a-6c1d-4f6e-9a55-3f0c2f6b9a11";

describe("native-login handoff", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("stashes, peeks and clears a request id", () => {
    expect(peekNativeRequest()).toBeNull();
    stashNativeRequest(ID);
    expect(sessionStorage.getItem("nativeAuthRequest")).toBe(ID);
    expect(peekNativeRequest()).toBe(ID);
    clearNativeRequest();
    expect(peekNativeRequest()).toBeNull();
  });

  it("resumes from the localStorage mirror when sessionStorage is empty (magic link in a new tab)", () => {
    stashNativeRequest(ID);
    sessionStorage.clear();
    expect(peekNativeRequest()).toBe(ID);
  });

  it("ignores an expired mirror and invalid ids", () => {
    localStorage.setItem("nativeAuthRequest", JSON.stringify({ id: ID, at: Date.now() - 11 * 60 * 1000 }));
    expect(peekNativeRequest()).toBeNull();
    stashNativeRequest("<script>");
    expect(peekNativeRequest()).toBeNull();
  });

  it("reads only well-formed ids from the URL", () => {
    expect(nativeRequestFromUrl(`?request=${ID}`)).toBe(ID);
    expect(nativeRequestFromUrl("?request=../../x")).toBeNull();
    expect(nativeRequestFromUrl("")).toBeNull();
  });

  it("only follows loopback or https redirects", () => {
    expect(isSafeNativeRedirect("http://127.0.0.1:53211/callback?code=a&state=b")).toBe(true);
    expect(isSafeNativeRedirect("https://app.hisaabo.in/auth/native/callback?code=a&state=b")).toBe(true);
    expect(isSafeNativeRedirect("javascript:alert(1)")).toBe(false);
    expect(isSafeNativeRedirect("http://evil.com/callback")).toBe(false);
    expect(isSafeNativeRedirect("hisaabo://verify")).toBe(false);
  });
});
