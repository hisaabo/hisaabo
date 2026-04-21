import type { ReactElement } from "react";
import { render, type RenderOptions } from "@testing-library/react-native";
import { ThemeProvider, type ThemeMode } from "./contexts/ThemeContext";

type RenderWithThemeOptions = RenderOptions & { mode?: ThemeMode };

/**
 * Wraps the tree under test in `<ThemeProvider>` so components that call
 * `useColors()` / `useTheme()` resolve correctly. Defaults to the dark palette —
 * matching the pre-migration baseline these tests were written against — and
 * skips SecureStore hydration so no async state updates fire during the test.
 */
export function renderWithTheme(ui: ReactElement, options?: RenderWithThemeOptions) {
  const { mode = "dark", ...rest } = options ?? {};
  return render(ui, {
    ...rest,
    wrapper: ({ children }) => <ThemeProvider initialMode={mode}>{children}</ThemeProvider>,
  });
}

export * from "@testing-library/react-native";
