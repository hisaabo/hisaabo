/**
 * Tests for `src/contexts/ThemeContext.tsx`
 *
 * WHY these tests matter for contributors:
 * The ThemeContext is the single source of truth for every colour rendered in
 * the mobile app — every screen, every card, every button reads `useColors()`
 * either directly or through `makeStyles`. Bugs at this layer are uniquely
 * expensive because they are global and hard to spot in one-off screen review:
 *
 *   - Wrong mode resolution  →  flash of the wrong palette on app launch
 *     (e.g. bright white flash for a dark-mode user — the exact UX regression
 *     the null-scheme fallback on line 60 was added to prevent).
 *   - Failed persistence     →  user's theme choice silently resets to
 *     "system" on every cold start, which is extremely frustrating and looks
 *     like the app forgot their preference.
 *   - Missing system fallback →  on the very first render tick before
 *     `Appearance.getColorScheme()` has reported, `useColorScheme()` can
 *     return `null`. If we defaulted to light in that window, dark-mode users
 *     would see a white-flash on every launch. We deliberately default to
 *     dark to preserve the pre-multi-theme baseline the app shipped with.
 *   - Context misuse         →  a `useTheme()` call outside the provider must
 *     throw a loud, readable error so the stack trace points contributors
 *     directly at the missing `<ThemeProvider>` wrapper instead of failing
 *     deep inside a `colors.xxx` undefined-property crash.
 *
 * Coverage checklist:
 *   - useTheme() outside provider throws a clear error
 *   - initialMode="dark" / "light" short-circuits SecureStore, hydrates sync
 *   - initialMode="system" + useColorScheme() "light"/"dark" resolves correctly
 *   - initialMode="system" + useColorScheme() null falls back to DARK (load-bearing)
 *   - Production path: SecureStore hydration of a valid stored mode
 *   - Hydration with an invalid stored value stays on "system"
 *   - Hydration when SecureStore rejects still flips isHydrated
 *   - setMode() updates colors AND writes to SecureStore under the right key
 *   - setMode() survives SecureStore write failures (still updates in-session)
 */

import React from "react";
import * as RN from "react-native";
import { Text } from "react-native";
import { act, render, renderHook, screen } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { ThemeProvider, useTheme } from "../ThemeContext";
import { darkColors, lightColors } from "../../lib/theme";

// ---------------------------------------------------------------------------
// expo-secure-store mock — the provider persists the chosen mode here on
// setMode() and reads it back on mount. We replace every exported function
// with a jest.fn() so we can control return values per test and assert the
// right key ("hisaabo_theme") is used.
// ---------------------------------------------------------------------------
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockGet = SecureStore.getItemAsync as jest.Mock;
const mockSet = SecureStore.setItemAsync as jest.Mock;

// ---------------------------------------------------------------------------
// react-native's `useColorScheme` — we patch it via jest.spyOn rather than a
// jest.mock factory because the factory path forces a `requireActual` that,
// under jest-expo, transitively loads the native DevMenu TurboModule and
// crashes before tests even run. Spying on the already-loaded module lets us
// swap out just the one export we care about while leaving the rest of the
// jest-expo setup untouched. Individual tests call
// `mockUseColorScheme.mockReturnValue(...)` to simulate the OS appearance.
// ---------------------------------------------------------------------------
const mockUseColorScheme = jest.spyOn(RN, "useColorScheme");

// ---------------------------------------------------------------------------
// Reset every mock between tests so assertions like `toHaveBeenCalledTimes(1)`
// are meaningful. Default the system appearance to "dark" so tests that don't
// care about it still get deterministic behaviour.
// ---------------------------------------------------------------------------
beforeEach(() => {
  mockGet.mockReset();
  mockSet.mockReset();
  mockUseColorScheme.mockReset();
  mockUseColorScheme.mockReturnValue("dark");
});

// ---------------------------------------------------------------------------
describe("ThemeContext — mode, palette, and persistence", () => {
  // -------------------------------------------------------------------------
  it("useTheme() throws a clear error when used outside <ThemeProvider>", () => {
    // WHAT: Calling useTheme() without a surrounding provider must raise a
    //       readable error that names the provider the caller forgot.
    // WHY: Without a provider, `useContext` returns null and the hook would
    //      otherwise crash with "cannot read property 'colors' of null" deep
    //      inside a screen — a confusing stack trace. The explicit throw
    //      turns that into an immediately actionable message, saving
    //      contributors debugging time on their first integration attempt.
    // We silence React's expected console.error noise so the test output
    // stays readable; the error is still asserted below.
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useTheme())).toThrow(
        "useTheme must be used inside <ThemeProvider>",
      );
    } finally {
      spy.mockRestore();
    }
  });

  // -------------------------------------------------------------------------
  it("initialMode=\"dark\" exposes darkColors and scheme=\"dark\" synchronously with isHydrated=true", () => {
    // WHAT: The `initialMode` prop is the test/storybook shortcut that
    //       bypasses SecureStore hydration. Passing "dark" should yield a
    //       fully-hydrated context on the very first render.
    // WHY: If initialMode didn't short-circuit hydration, every test that
    //      renders a themed component would have to wait on a SecureStore
    //      microtask and wrap in act(), making the test suite an order of
    //      magnitude slower and more flake-prone. The synchronous path is
    //      load-bearing for the entire existing renderWithTheme helper.
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => (
        <ThemeProvider initialMode="dark">{children}</ThemeProvider>
      ),
    });

    expect(result.current.mode).toBe("dark");
    expect(result.current.scheme).toBe("dark");
    expect(result.current.colors).toBe(darkColors);
    expect(result.current.isHydrated).toBe(true);
    // SecureStore must not be touched when initialMode is pinned.
    expect(mockGet).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  it("initialMode=\"light\" exposes lightColors and scheme=\"light\" synchronously", () => {
    // WHAT: Mirror of the dark case — proves the provider is symmetric and
    //       there is no hidden preference for one palette.
    // WHY: Asymmetry here would mean one palette has a different code path
    //      than the other — a common source of "it works in dark but not
    //      light" bugs that are painful to chase on device.
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => (
        <ThemeProvider initialMode="light">{children}</ThemeProvider>
      ),
    });

    expect(result.current.mode).toBe("light");
    expect(result.current.scheme).toBe("light");
    expect(result.current.colors).toBe(lightColors);
    expect(result.current.isHydrated).toBe(true);
  });

  // -------------------------------------------------------------------------
  it("initialMode=\"system\" with useColorScheme()=\"light\" resolves to lightColors", () => {
    // WHAT: When the user has chosen "follow system", the palette must track
    //       the OS-reported appearance — here the OS says light.
    // WHY: Respecting the system setting is the default on install (mode
    //      starts as "system") and is what most Android 10+/iOS 13+ users
    //      expect. A broken "system" branch means the user's OS-level dark
    //      mode choice is silently ignored by Hisaabo.
    mockUseColorScheme.mockReturnValue("light");

    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => (
        <ThemeProvider initialMode="system">{children}</ThemeProvider>
      ),
    });

    expect(result.current.mode).toBe("system");
    expect(result.current.scheme).toBe("light");
    expect(result.current.colors).toBe(lightColors);
  });

  // -------------------------------------------------------------------------
  it("initialMode=\"system\" with useColorScheme()=\"dark\" resolves to darkColors", () => {
    // WHAT: Same as above but for the dark OS appearance.
    // WHY: Dark mode is the historical default for Hisaabo mobile. If the
    //      system branch fails here, OS-level dark mode feels broken on
    //      devices where the light-mode branch works — a confusing bug class.
    mockUseColorScheme.mockReturnValue("dark");

    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => (
        <ThemeProvider initialMode="system">{children}</ThemeProvider>
      ),
    });

    expect(result.current.mode).toBe("system");
    expect(result.current.scheme).toBe("dark");
    expect(result.current.colors).toBe(darkColors);
  });

  // -------------------------------------------------------------------------
  it("initialMode=\"system\" with useColorScheme()=null falls back to DARK (historical baseline)", () => {
    // WHAT: On the very first render tick before the Appearance API has
    //       reported, `useColorScheme()` can return `null`. ThemeContext.tsx
    //       line 60 deliberately maps that to dark, not light.
    // WHY: THIS IS LOAD-BEARING. The mobile app shipped dark-only for its
    //      first year, so dark is the visually-expected baseline. Defaulting
    //      to light here would cause a bright white flash on every cold
    //      start for dark-mode users — the exact regression this fallback
    //      prevents. If you change this, you MUST also update the
    //      comment-block at the top of ThemeContext.tsx and coordinate a
    //      visual QA pass.
    mockUseColorScheme.mockReturnValue(null);

    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => (
        <ThemeProvider initialMode="system">{children}</ThemeProvider>
      ),
    });

    expect(result.current.mode).toBe("system");
    expect(result.current.scheme).toBe("dark");
    expect(result.current.colors).toBe(darkColors);
  });

  // -------------------------------------------------------------------------
  it("without initialMode, hydrates the stored mode from SecureStore under key \"hisaabo_theme\"", async () => {
    // WHAT: The production path — no initialMode prop — must read
    //       SecureStore.getItemAsync("hisaabo_theme") and apply the returned
    //       mode. Here the user previously chose "light".
    // WHY: This is the core persistence contract. If SecureStore is not read,
    //      every cold start resets the user's theme to "system", which is a
    //      highly visible regression. The key name is hard-coded in the
    //      assertion so any rename breaks this test loudly.
    mockGet.mockResolvedValue("light");

    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    });

    // Before the promise resolves, the provider is still unhydrated and on
    // the default "system" mode.
    expect(result.current.isHydrated).toBe(false);

    // Flush the microtask queue so the useEffect's async IIFE resolves.
    await act(async () => {});

    expect(mockGet).toHaveBeenCalledWith("hisaabo_theme");
    expect(result.current.isHydrated).toBe(true);
    expect(result.current.mode).toBe("light");
    expect(result.current.colors).toBe(lightColors);
  });

  // -------------------------------------------------------------------------
  it("hydration ignores an invalid stored value and stays on \"system\"", async () => {
    // WHAT: If SecureStore somehow contains a corrupted value like "purple"
    //       (e.g. from a prior beta build, or a manual edit), the provider
    //       must reject it and stay on the safe default "system".
    // WHY: Without the isThemeMode guard, a bad value would become the
    //      active mode and break the narrowed `scheme` union downstream,
    //      causing TypeScript-safe-but-runtime-wrong palette lookups and
    //      possibly an `undefined` colors object. The guard is the
    //      only thing preventing that whole class of bug.
    mockGet.mockResolvedValue("purple");
    mockUseColorScheme.mockReturnValue("dark");

    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    });

    await act(async () => {});

    expect(result.current.isHydrated).toBe(true);
    // Mode stays on the default "system" — the invalid value is rejected.
    expect(result.current.mode).toBe("system");
    // scheme is derived from useColorScheme (mocked to "dark" above).
    expect(result.current.scheme).toBe("dark");
    expect(result.current.colors).toBe(darkColors);
  });

  // -------------------------------------------------------------------------
  it("hydration is resilient when SecureStore.getItemAsync rejects", async () => {
    // WHAT: On some Android devices the keystore can throw (failed biometric
    //       enrolment, factory reset protection, etc.). The provider must
    //       still flip isHydrated to true and fall back to "system" without
    //       an unhandled promise rejection.
    // WHY: An unhandled rejection here would either crash the JS bridge or
    //      leave isHydrated permanently false, so every component that
    //      renders a skeleton until hydrated would show that skeleton
    //      forever — the app looks permanently stuck loading.
    mockGet.mockRejectedValue(new Error("KeyStore unavailable"));
    mockUseColorScheme.mockReturnValue("light");

    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    });

    await act(async () => {});

    // Must recover: hydrated, on the safe default, no crash.
    expect(result.current.isHydrated).toBe(true);
    expect(result.current.mode).toBe("system");
    expect(result.current.scheme).toBe("light");
  });

  // -------------------------------------------------------------------------
  it("setMode(\"dark\") updates the palette synchronously AND persists via SecureStore under \"hisaabo_theme\"", () => {
    // WHAT: Calling setMode from a consumer must flip the scheme/colors
    //       immediately (for a smooth in-session swap) AND call
    //       SecureStore.setItemAsync once with the correct key + value.
    // WHY: Users changing the theme in the Settings screen expect the new
    //      palette to apply instantly (no loading spinner). They also expect
    //      their choice to survive a restart — if setItemAsync is not called,
    //      the choice is lost. The key must match the read key exactly
    //      ("hisaabo_theme") or the reader will never find it.
    mockSet.mockResolvedValue(undefined);

    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => (
        <ThemeProvider initialMode="light">{children}</ThemeProvider>
      ),
    });

    // Starts on light — sanity check the setup.
    expect(result.current.colors).toBe(lightColors);

    act(() => {
      result.current.setMode("dark");
    });

    // In-session palette flipped.
    expect(result.current.mode).toBe("dark");
    expect(result.current.scheme).toBe("dark");
    expect(result.current.colors).toBe(darkColors);

    // Persisted to SecureStore — exactly once, with the right key/value.
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith("hisaabo_theme", "dark");
  });

  // -------------------------------------------------------------------------
  it("setMode still applies the palette in-session when SecureStore.setItemAsync rejects", async () => {
    // WHAT: The setMode callback swallows SecureStore errors (fire-and-forget
    //       with .catch). Even if the write fails, the user's choice must
    //       take effect for the current session.
    // WHY: Refusing to apply the theme because persistence failed would mean
    //      a single bad write leaves the user stuck on the wrong palette
    //      until they restart the app — much worse UX than silently losing
    //      persistence on that one device. The UI-first behaviour is
    //      deliberate; this test enforces it.
    //
    // We also guard against an unhandled-rejection warning by awaiting a
    // microtask flush after the setMode call — the catch handler runs
    // asynchronously once the promise settles.
    mockSet.mockRejectedValue(new Error("keystore write failed"));

    // We render a tiny probe component so we can observe the visible scheme
    // via testID (demonstrating the pattern called out in the task notes).
    function Probe() {
      const { scheme, setMode } = useTheme();
      return (
        <>
          <Text testID="scheme">{scheme}</Text>
          <Text
            testID="toggle"
            onPress={() => {
              setMode("dark");
            }}
          >
            toggle
          </Text>
        </>
      );
    }

    render(
      <ThemeProvider initialMode="light">
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("scheme").props.children).toBe("light");

    await act(async () => {
      screen.getByTestId("toggle").props.onPress();
      // Let the swallowed rejection settle inside act so no "unhandled
      // promise rejection" warning leaks into the test output.
      await Promise.resolve();
    });

    // Palette flipped despite the write failure.
    expect(screen.getByTestId("scheme").props.children).toBe("dark");
    expect(mockSet).toHaveBeenCalledWith("hisaabo_theme", "dark");
  });
});
