import { useEffect } from "react";
import { isDesktop } from "@/lib/isDesktop";

const TOKEN_RE = /^[A-Za-z0-9_-]{16,256}$/;

// The Tauri shell validates `hisaabo://verify?token=...` deep links and emits
// the token here; navigation happens in the web app, never via injected JS.
export function useDesktopDeepLink(): void {
  useEffect(() => {
    if (!isDesktop()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<string>("hisaabo://verify-token", (event) => {
          const token = event.payload;
          if (typeof token !== "string" || !TOKEN_RE.test(token)) return;
          window.location.assign(`/auth/verify?token=${encodeURIComponent(token)}`);
        }),
      )
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
