import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";
import { darkColors, lightColors, type Colors } from "../lib/theme";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedScheme = "light" | "dark";

type ThemeContextValue = {
  mode: ThemeMode;
  scheme: ResolvedScheme;
  colors: Colors;
  isHydrated: boolean;
  setMode: (mode: ThemeMode) => void;
};

const THEME_KEY = "hisaabo_theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

export function ThemeProvider({
  children,
  initialMode,
}: {
  children: React.ReactNode;
  /** Skip SecureStore hydration and pin the mode to this value. Intended for tests. */
  initialMode?: ThemeMode;
}) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>(initialMode ?? "system");
  const [isHydrated, setIsHydrated] = useState(Boolean(initialMode));

  useEffect(() => {
    if (initialMode) return;
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(THEME_KEY);
        if (isThemeMode(stored)) setModeState(stored);
      } catch {
        // non-fatal; fall back to "system"
      } finally {
        setIsHydrated(true);
      }
    })();
  }, [initialMode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    SecureStore.setItemAsync(THEME_KEY, next).catch(() => {
      // non-fatal; state change still takes effect for the session
    });
  }, []);

  // Default to dark when the system scheme is unavailable (null/unspecified
  // can happen on the first render tick) to preserve the historical mobile
  // look until the system reports.
  const resolvedSystem: ResolvedScheme = systemScheme === "light" ? "light" : "dark";
  const scheme: ResolvedScheme = mode === "system" ? resolvedSystem : mode;
  const colors = scheme === "dark" ? darkColors : lightColors;

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, scheme, colors, isHydrated, setMode }),
    [mode, scheme, colors, isHydrated, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return ctx;
}

export function useColors(): Colors {
  return useTheme().colors;
}
