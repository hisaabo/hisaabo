/**
 * Tests for `src/lib/makeStyles.ts`
 *
 * WHY these tests matter for contributors:
 * `makeStyles` is the bridge between the theme context and every component's
 * StyleSheet. Nearly every screen in the mobile app declares its styles via
 * `const useStyles = makeStyles(colors => ({ ... }))` and then calls
 * `useStyles()` inside render. If this helper gets the palette wrong, or
 * returns a stale object after a theme switch, every styled component in the
 * app renders incorrect colours.
 *
 * There are two subtle properties we rely on in production that this test
 * file locks in:
 *
 *   1. "Theme-driven, not captured at call site." The factory closes over a
 *      parameter `colors`, not the imported default palette. That parameter
 *      must be read fresh on every render so switching themes at runtime
 *      actually re-paints the screen. A regression where the factory is
 *      called once at module load time (e.g. via `useMemo(() => ..., [])`)
 *      would pin every screen to the initial palette forever.
 *
 *   2. "Stable object identity within a theme." The hook memoises the
 *      resulting StyleSheet keyed on `colors`. Stable identity matters for
 *      downstream memoisation — `React.memo` children that receive a style
 *      object as a prop would re-render on every parent tick if the style
 *      identity flipped between renders. That unnecessary churn is a
 *      common cause of janky scrolling on low-end Android devices.
 *
 * Coverage checklist:
 *   - In dark theme, factory receives darkColors and styles reflect them
 *   - In light theme, factory receives lightColors (proves it's theme-driven)
 *   - Same theme across renders → identical stylesheet object reference
 *   - Theme flip → new stylesheet object reference (memo invalidation works)
 */

import React from "react";
import * as RN from "react-native";
import { StyleSheet, Text } from "react-native";
import { act, render, renderHook, screen } from "@testing-library/react-native";
import { ThemeProvider, useTheme } from "../../contexts/ThemeContext";
import { makeStyles } from "../makeStyles";
import { darkColors, lightColors } from "../theme";

// ---------------------------------------------------------------------------
// We don't need to mock SecureStore because every test here pins the theme
// with `initialMode`, which short-circuits the hydration path in
// ThemeProvider before any SecureStore read fires.
//
// We DO pin react-native's `useColorScheme` to "dark" via jest.spyOn so the
// "system" branch — if ever reached during a theme flip — resolves
// deterministically. Using jest.spyOn instead of a jest.mock factory is
// important here: the factory's `requireActual("react-native")` triggers the
// native DevMenu TurboModule load under jest-expo and crashes the test suite
// before any test runs. Spying on the already-loaded module avoids that.
// ---------------------------------------------------------------------------
jest.spyOn(RN, "useColorScheme").mockReturnValue("dark");

// ---------------------------------------------------------------------------
// The factory under test: a small, representative stylesheet that touches
// several palette keys so we can assert multiple colours map through.
// Declared once at module scope so every test exercises the exact same
// factory — otherwise a per-test factory would accidentally test factory
// identity rather than the memoisation we care about.
// ---------------------------------------------------------------------------
const useStyles = makeStyles((colors) => ({
  container: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
  },
  text: {
    color: colors.textPrimary,
  },
}));

// ---------------------------------------------------------------------------
describe("makeStyles — theme-aware StyleSheet hook", () => {
  // -------------------------------------------------------------------------
  it("resolves factory against darkColors when the active theme is dark", () => {
    // WHAT: Under <ThemeProvider initialMode="dark"> the factory must be
    //       called with darkColors, and the resulting stylesheet must reflect
    //       those values (e.g. backgroundColor === darkColors.bg).
    // WHY: `StyleSheet.create` in jest-expo returns numeric IDs rather than
    //      the raw style objects, so we use `StyleSheet.flatten` to resolve
    //      them back before asserting. If this test fails in dark mode, every
    //      screen in the app is rendering with the wrong palette — the most
    //      visible class of theming bug.
    const { result } = renderHook(() => useStyles(), {
      wrapper: ({ children }) => (
        <ThemeProvider initialMode="dark">{children}</ThemeProvider>
      ),
    });

    const container = StyleSheet.flatten(result.current.container);
    const text = StyleSheet.flatten(result.current.text);

    expect(container.backgroundColor).toBe(darkColors.bg);
    expect(container.borderColor).toBe(darkColors.border);
    expect(text.color).toBe(darkColors.textPrimary);
  });

  // -------------------------------------------------------------------------
  it("resolves factory against lightColors when the active theme is light (theme-driven, not captured)", () => {
    // WHAT: Swap to light mode and the SAME factory (imported from module
    //       scope) must now produce light-palette values. This proves the
    //       factory is re-invoked per theme — it does NOT close over a
    //       palette captured at `makeStyles()` call time.
    // WHY: If `makeStyles` accidentally captured `darkColors` at module load
    //      (e.g. via a top-level import aliased at the wrong level), every
    //      user would be stuck in whichever palette loaded first. This
    //      assertion is the canonical guard against that class of bug.
    const { result } = renderHook(() => useStyles(), {
      wrapper: ({ children }) => (
        <ThemeProvider initialMode="light">{children}</ThemeProvider>
      ),
    });

    const container = StyleSheet.flatten(result.current.container);
    const text = StyleSheet.flatten(result.current.text);

    expect(container.backgroundColor).toBe(lightColors.bg);
    expect(container.borderColor).toBe(lightColors.border);
    expect(text.color).toBe(lightColors.textPrimary);
  });

  // -------------------------------------------------------------------------
  it("returns the same stylesheet object reference across renders when theme is unchanged", () => {
    // WHAT: `renderHook().rerender()` without changing the wrapper should
    //       return the same object reference both times (thanks to the
    //       useMemo keyed on colors identity).
    // WHY: Stable identity is critical for downstream performance. A FlatList
    //      row wrapped in React.memo receives `style={styles.row}` as a prop;
    //      if that reference changed on every parent render, every row in a
    //      1000-row list would re-render on every tick, tanking scroll
    //      performance. This test is the regression gate on that contract.
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeProvider initialMode="dark">{children}</ThemeProvider>
    );

    const { result, rerender } = renderHook(() => useStyles(), { wrapper });

    const first = result.current;
    // rerender() requires an argument for the hook's props; our hook takes
    // none, so pass undefined to satisfy the types while still forcing a
    // re-render of the same tree.
    rerender(undefined);
    const second = result.current;

    // Strict object-identity equality — NOT .toEqual (deep). We specifically
    // care about reference stability, not structural equality.
    expect(second).toBe(first);
  });

  // -------------------------------------------------------------------------
  it("returns a new stylesheet object reference when the theme flips at runtime", async () => {
    // WHAT: Switching modes at runtime (the real Settings-screen flow) must
    //       invalidate the memo and hand back a fresh stylesheet object
    //       whose values reflect the new palette.
    // WHY: If the memo key were something stable across themes (e.g. []),
    //      the stylesheet would never update, and toggling the theme in
    //      Settings would not repaint any screen. We drive the switch from
    //      INSIDE the provider via its own setMode action — this mirrors the
    //      production flow exactly (Settings screen calls useTheme().setMode)
    //      and therefore also serves as an integration smoke test of the
    //      theme context + makeStyles pair.

    // `Capture` reads the current stylesheet and stashes it in a module
    // closure each render. That lets the test compare identity across the
    // theme flip without threading refs through the provider.
    const captured: Array<ReturnType<typeof useStyles>> = [];
    function Capture() {
      const styles = useStyles();
      captured.push(styles);
      return null;
    }

    // `Flipper` lives inside the provider so it can call setMode on the
    // same context instance Capture is reading from — no remount required,
    // which is exactly how the real Settings screen toggles the theme.
    function Flipper() {
      const { setMode } = useTheme();
      return (
        <Text
          testID="flip"
          onPress={() => {
            setMode("light");
          }}
        >
          flip
        </Text>
      );
    }

    render(
      <ThemeProvider initialMode="dark">
        <Capture />
        <Flipper />
      </ThemeProvider>,
    );

    // First render captured the dark-theme stylesheet.
    expect(captured.length).toBeGreaterThanOrEqual(1);
    const beforeFlip = captured[captured.length - 1];
    expect(
      StyleSheet.flatten(beforeFlip.container).backgroundColor,
    ).toBe(darkColors.bg);

    // Flip to light — the onPress handler calls setMode on the live
    // provider, which re-renders Capture with the new palette.
    await act(async () => {
      screen.getByTestId("flip").props.onPress();
    });

    const afterFlip = captured[captured.length - 1];

    // New object identity (memo invalidated) AND new values (light palette).
    expect(afterFlip).not.toBe(beforeFlip);
    expect(
      StyleSheet.flatten(afterFlip.container).backgroundColor,
    ).toBe(lightColors.bg);
  });
});
