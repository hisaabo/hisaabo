import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MobileAppNotice, MOBILE_NOTICE_DISMISSED_KEY } from "../MobileAppNotice";

const PHONE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36";
const DESKTOP_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";

function setEnv({ narrow, coarse, ua }: { narrow: boolean; coarse: boolean; ua: string }) {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
  window.matchMedia = ((q: string) => ({
    matches: q.includes("max-width") ? narrow : q.includes("coarse") ? coarse : false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const renderIt = (pathname = "/") =>
  render(
    <MobileAppNotice pathname={pathname}>
      <div>app content</div>
    </MobileAppNotice>,
  );

describe("MobileAppNotice", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("shows on a phone viewport", () => {
    setEnv({ narrow: true, coarse: true, ua: PHONE_UA });
    renderIt();
    expect(screen.getByText("Use the Hisaabo mobile app")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Download Android app/ });
    expect(link).toHaveAttribute("href", "https://github.com/hisaabo/hisaabo/releases/latest");
    expect(screen.getByText(/Play Store and F-Droid/)).toBeInTheDocument();
    expect(screen.queryByText("app content")).not.toBeInTheDocument();
  });

  it("is hidden at desktop width", () => {
    setEnv({ narrow: false, coarse: false, ua: DESKTOP_UA });
    renderIt();
    expect(screen.getByText("app content")).toBeInTheDocument();
    expect(screen.queryByText("Use the Hisaabo mobile app")).not.toBeInTheDocument();
  });

  it("is hidden for a narrow desktop browser window", () => {
    setEnv({ narrow: true, coarse: false, ua: DESKTOP_UA });
    renderIt();
    expect(screen.getByText("app content")).toBeInTheDocument();
  });

  it("is hidden on tablets", () => {
    setEnv({ narrow: true, coarse: true, ua: IPAD_UA });
    renderIt();
    expect(screen.getByText("app content")).toBeInTheDocument();
  });

  it("is hidden inside the Tauri desktop app", () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    setEnv({ narrow: true, coarse: true, ua: PHONE_UA });
    renderIt();
    expect(screen.getByText("app content")).toBeInTheDocument();
  });

  it("is hidden on auth and invite routes", () => {
    setEnv({ narrow: true, coarse: true, ua: PHONE_UA });
    renderIt("/invite/abc");
    expect(screen.getByText("app content")).toBeInTheDocument();
  });

  it("persists dismissal", () => {
    setEnv({ narrow: true, coarse: true, ua: PHONE_UA });
    const { unmount } = renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Continue to web anyway" }));
    expect(screen.getByText("app content")).toBeInTheDocument();
    expect(localStorage.getItem(MOBILE_NOTICE_DISMISSED_KEY)).toBe("1");
    unmount();
    renderIt();
    expect(screen.getByText("app content")).toBeInTheDocument();
  });

  it("still dismisses when storage throws", () => {
    setEnv({ narrow: true, coarse: true, ua: PHONE_UA });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Continue to web anyway" }));
    expect(screen.getByText("app content")).toBeInTheDocument();
  });
});
