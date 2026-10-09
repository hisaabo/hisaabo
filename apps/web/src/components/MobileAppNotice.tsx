import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "@/components/ui/Logo";
import { isDesktop } from "@/lib/isDesktop";
import { parseUserAgent } from "@/lib/parse-user-agent";

export const ANDROID_APK_URL = "https://github.com/hisaabo/hisaabo/releases/latest";
export const MOBILE_NOTICE_DISMISSED_KEY = "hisaabo:mobile-notice-dismissed";

const PHONE_QUERY = "(max-width: 640px)";
const COARSE_QUERY = "(pointer: coarse)";

// Routes that are opened from emails / the native app and are intentionally
// usable on a phone: auth links (verify, complete-profile, native handoff)
// and invitation acceptance. Blocking them would break sign-up on mobile.
const EXEMPT_PREFIXES = ["/auth", "/invite"];

function isPhone(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  if (!window.matchMedia(PHONE_QUERY).matches) return false;
  const { deviceType } = parseUserAgent(window.navigator.userAgent);
  if (deviceType === "tablet") return false;
  // Narrow window + touch device or mobile UA. A narrow desktop browser
  // window (fine pointer, desktop UA) is not a phone.
  return window.matchMedia(COARSE_QUERY).matches || deviceType === "mobile";
}

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(MOBILE_NOTICE_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Full-screen interstitial shown on phones. The web dashboard is built for
 * tablet/desktop widths; phones should use the native Hisaabo app. Children
 * (the app) are rendered instead whenever the notice is not applicable.
 */
export function MobileAppNotice({
  pathname = "",
  children,
}: {
  pathname?: string;
  children: ReactNode;
}) {
  const [phone, setPhone] = useState<boolean>(() => !isDesktop() && isPhone());
  // Session-only fallback so "Continue" still works if storage is blocked.
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed());

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(!isDesktop() && isPhone());
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  const exempt = EXEMPT_PREFIXES.some((p) => pathname.startsWith(p));
  if (!phone || dismissed || exempt) return <>{children}</>;

  const dismiss = () => {
    try {
      window.localStorage.setItem(MOBILE_NOTICE_DISMISSED_KEY, "1");
    } catch {
      /* storage unavailable: dismissal lasts for this page session only */
    }
    setDismissed(true);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-app-notice-title"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-y-auto bg-surface-0 px-6 py-10 text-center"
    >
      <Logo className="h-16 w-16 shadow-md rounded-xl" />
      <h1
        id="mobile-app-notice-title"
        className="mt-6 text-xl font-semibold text-text-primary"
      >
        Use the Hisaabo mobile app
      </h1>
      <p className="mt-2 max-w-xs text-sm text-text-secondary">
        The web dashboard is designed for larger screens. For the best
        experience on your phone, get the Hisaabo app.
      </p>

      <a
        href={ANDROID_APK_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-8 inline-flex w-full max-w-xs items-center justify-center rounded-lg bg-brand-600 px-4 py-3 text-sm font-medium text-white hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      >
        Download Android app (APK)
      </a>
      <p className="mt-3 text-xs text-text-tertiary">
        Play Store and F-Droid listings coming soon.
      </p>

      <button
        type="button"
        onClick={dismiss}
        className="mt-8 text-sm font-medium text-text-secondary underline underline-offset-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
      >
        Continue to web anyway
      </button>
    </div>
  );
}
