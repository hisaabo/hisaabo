import { Platform } from "react-native";

export const colors = {
  bg: "#0f0f1a",
  surface: "#1a1a2e",
  surfaceHover: "#252540",
  border: "#2d2d44",
  borderLight: "#23233a",
  brand: "#6366f1",
  brandLight: "rgba(99, 102, 241, 0.12)",
  brandDark: "#5050c0",
  amber: "#fbbf24",
  amberBg: "rgba(251, 191, 36, 0.12)",
  textPrimary: "#ffffff",
  textSecondary: "#9ca3af",
  textMuted: "#6b7280",
  success: "#10b981",
  successBg: "rgba(16, 185, 129, 0.12)",
  danger: "#ef4444",
  dangerBg: "rgba(239, 68, 68, 0.1)",
  warning: "#f59e0b",
  warningBg: "rgba(245, 158, 11, 0.12)",
  info: "#3b82f6",
  infoBg: "rgba(59, 130, 246, 0.12)",
} as const;

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
