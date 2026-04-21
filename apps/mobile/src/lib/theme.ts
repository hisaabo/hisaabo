import { Platform } from "react-native";

/**
 * Palette values are kept in sync with `apps/web/src/styles/globals.css`
 * (`:root` = light, `.dark` = dark) and `apps/web/tailwind.config.js` for
 * brand/accent scales. When updating either side, keep both in lockstep so
 * the web and mobile surfaces stay visually identical.
 *
 * - `brand` → `--brand-600` (#5b5bd6) — shared across modes
 * - Semantic (success/warning/danger/info) — we use the web light values for
 *   light mode and brighter tailwind-500 variants for dark mode, since the
 *   web darkens/shifts them via surface contrast rather than by overriding
 *   the CSS var.
 */

export type Colors = {
  bg: string;
  surface: string;
  surfaceHover: string;
  border: string;
  borderLight: string;
  brand: string;
  brandLight: string;
  brandDark: string;
  amber: string;
  amberBg: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  success: string;
  successBg: string;
  danger: string;
  dangerBg: string;
  warning: string;
  warningBg: string;
  info: string;
  infoBg: string;
};

export const lightColors: Colors = {
  bg: "#ffffff",
  surface: "#f8f9fa",
  surfaceHover: "#f1f3f5",
  border: "#dee2e6",
  borderLight: "#e9ecef",
  brand: "#5b5bd6",
  brandLight: "rgba(91, 91, 214, 0.10)",
  brandDark: "#5050c0",
  amber: "#fbbf24",
  amberBg: "rgba(251, 191, 36, 0.12)",
  textPrimary: "#1a1a2e",
  textSecondary: "#495057",
  textMuted: "#868e96",
  success: "#2b8a3e",
  successBg: "rgba(43, 138, 62, 0.12)",
  danger: "#dc2626",
  dangerBg: "rgba(220, 38, 38, 0.10)",
  warning: "#d97706",
  warningBg: "rgba(217, 119, 6, 0.12)",
  info: "#2563eb",
  infoBg: "rgba(37, 99, 235, 0.12)",
};

export const darkColors: Colors = {
  bg: "#141417",
  surface: "#1a1a1f",
  surfaceHover: "#232329",
  border: "#2c2c35",
  borderLight: "#232329",
  brand: "#5b5bd6",
  brandLight: "rgba(91, 91, 214, 0.15)",
  brandDark: "#5050c0",
  amber: "#fbbf24",
  amberBg: "rgba(251, 191, 36, 0.12)",
  textPrimary: "#e4e4e8",
  textSecondary: "#a1a1aa",
  textMuted: "#71717a",
  success: "#10b981",
  successBg: "rgba(16, 185, 129, 0.12)",
  danger: "#ef4444",
  dangerBg: "rgba(239, 68, 68, 0.10)",
  warning: "#f59e0b",
  warningBg: "rgba(245, 158, 11, 0.12)",
  info: "#3b82f6",
  infoBg: "rgba(59, 130, 246, 0.12)",
};

/**
 * Legacy default export — kept as `darkColors` so that any import path we
 * haven't migrated yet continues to render the dark palette (the only one
 * mobile shipped with before multi-theme support). Prefer `useColors()` from
 * `contexts/ThemeContext` in new and migrated code.
 */
export const colors: Colors = darkColors;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 999,
} as const;

export const fonts = {
  mono: Platform.OS === "ios" ? "Menlo" : "monospace",
} as const;
