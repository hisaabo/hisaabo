import { useEffect } from "react";
import { isDesktop } from "@/lib/isDesktop";
import { handleNativeCallback } from "@/lib/desktop-native-login";
import { nativeRequestFromUrl, stashNativeRequest } from "@/lib/native-login";

const TOKEN_RE = /^[A-Za-z0-9_-]{16,256}$/;
const CALLBACK_PART_RE = /^[A-Za-z0-9_-]{16,128}$/;

// The Tauri shell validates `hisaabo://verify?token=...` deep links and the
// loopback browser sign-in callback, and emits only the validated values here;
// navigation and token exchange happen in the web app, never via injected JS.
//
// It also remembers a `/auth/native?request=` id on every platform, because
// the root route redirects signed-out visitors to /login before that page
// mounts.
export function useDesktopDeepLink(): void {
  useEffect(() => {
    if (window.location.pathname.startsWith("/auth/native")) {
      const requestId = nativeRequestFromUrl(window.location.search);
      if (requestId) stashNativeRequest(requestId);
    }
  }, []);

  useEffect(() => {
    if (!isDesktop()) return;
    const unlisteners: Array<() => void> = [];
    let cancelled = false;
    const track = (fn: () => void) => {
      if (cancelled) fn();
      else unlisteners.push(fn);
    };
    import("@tauri-apps/api/event")
      .then(async ({ listen }) => {
        track(
          await listen<string>("hisaabo://verify-token", (event) => {
            const token = event.payload;
            if (typeof token !== "string" || !TOKEN_RE.test(token)) return;
            window.location.assign(`/auth/verify?token=${encodeURIComponent(token)}`);
          }),
        );
        track(
          await listen<{ code: string; state: string }>("hisaabo://native-callback", (event) => {
            const { code, state } = event.payload ?? ({} as { code?: unknown; state?: unknown });
            if (typeof code !== "string" || typeof state !== "string") return;
            if (!CALLBACK_PART_RE.test(code) || !CALLBACK_PART_RE.test(state)) return;
            void handleNativeCallback({ code, state });
          }),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, []);
}
