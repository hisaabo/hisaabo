/**
 * Tests for `src/components/ui/Skeleton.tsx`
 *
 * WHY these tests matter for contributors:
 * Skeleton loaders are displayed while tRPC queries are fetching — on the
 * invoice list, party list, and dashboard metric tiles. They prevent the
 * "blank screen flash" that makes the app look broken on slow connections
 * (common on 2G/3G networks in Tier-2 and Tier-3 Indian cities).
 *
 * The Skeleton component uses React Native's Animated API to pulse between
 * opacity values (0.3 → 0.7 → 0.3) in an infinite loop. This animation
 * runs on the native thread (useNativeDriver: true) for 60fps performance
 * even when JS is busy loading data.
 *
 * Key constraints:
 *   - The animation loop must START on mount and STOP on unmount to prevent
 *     memory leaks (Animated loops hold references to their animatable values)
 *   - width and height props must be applied to the Animated.View
 *   - borderRadius defaults to 8 but is configurable for different use cases
 *     (e.g. circular avatar skeleton vs. rectangular text line skeleton)
 *
 * Coverage checklist:
 *   - Renders with required width and height props
 *   - Applies width and height to the animated view
 *   - Applies the default borderRadius (8) when not specified
 *   - Applies a custom borderRadius when specified
 *   - Starts the animation on mount (initial opacity set)
 *   - Stops the animation on unmount (no memory leaks)
 *   - Applies a custom style prop
 *   - Accepts string width (e.g. "100%") for full-width skeletons
 */

import React from "react";
import { Animated } from "react-native";
import { render } from "@testing-library/react-native";
import { Skeleton } from "../Skeleton";

// ---------------------------------------------------------------------------
// Mock Animated to prevent actual animation timers from running in tests.
// This avoids "act()" warnings from React when the animation loop fires
// during teardown.
// ---------------------------------------------------------------------------
jest.spyOn(Animated, "loop").mockImplementation((_animation) => ({
  start: jest.fn(),
  stop: jest.fn(),
  reset: jest.fn(),
}));

jest.spyOn(Animated, "timing").mockImplementation((_value, _config) => ({
  start: jest.fn(),
  stop: jest.fn(),
  reset: jest.fn(),
  _startNativeLoop: jest.fn(),
  _stopNativeLoop: jest.fn(),
}));

jest.spyOn(Animated, "sequence").mockImplementation((_animations) => ({
  start: jest.fn(),
  stop: jest.fn(),
  reset: jest.fn(),
}));

// ---------------------------------------------------------------------------
describe("Skeleton — animated loading placeholder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  it("renders without crashing with required width and height props", () => {
    // WHAT: Basic smoke test — Skeleton with minimum required props.
    // WHY: If the component crashes on mount, every loading state across
    //      invoices, parties, and dashboard tiles shows a blank screen or
    //      throws a red error box instead of the skeleton.
    expect(() => render(<Skeleton width={200} height={20} />)).not.toThrow();
  });

  // -------------------------------------------------------------------------
  it("applies the numeric width and height to the Animated.View", () => {
    // WHAT: The Animated.View must have the exact width and height specified.
    // WHY: If dimensions are wrong, skeletons misalign with the content they
    //      represent — a 200px wide skeleton behind a 100px invoice number
    //      looks broken and confuses users about the expected layout.
    const { UNSAFE_getByType } = render(
      <Skeleton width={200} height={20} />
    );

    const animatedView = UNSAFE_getByType(Animated.View);
    const style = Array.isArray(animatedView.props.style)
      ? Object.assign({}, ...animatedView.props.style.map((s: any) => s || {}))
      : animatedView.props.style;

    expect(style.width).toBe(200);
    expect(style.height).toBe(20);
  });

  // -------------------------------------------------------------------------
  it("accepts a string width (e.g. '100%') for full-width skeletons", () => {
    // WHAT: Some skeleton layouts need full-width placeholders (e.g. a full-
    //       width text line in an invoice header).
    // WHY: If string widths crash the component, contributors cannot build
    //      responsive skeleton layouts that adapt to different screen sizes.
    expect(() => render(<Skeleton width="100%" height={16} />)).not.toThrow();

    const { UNSAFE_getByType } = render(<Skeleton width="100%" height={16} />);
    const animatedView = UNSAFE_getByType(Animated.View);
    const style = Array.isArray(animatedView.props.style)
      ? Object.assign({}, ...animatedView.props.style.map((s: any) => s || {}))
      : animatedView.props.style;

    expect(style.width).toBe("100%");
  });

  // -------------------------------------------------------------------------
  it("applies the default borderRadius of 8 when borderRadius prop is omitted", () => {
    // WHAT: The default borderRadius (8) creates a softly rounded rectangular
    //       skeleton that matches most text-line skeletons.
    // WHY: If the default is 0, skeletons have sharp corners that visually
    //      jar against the rounded card/input designs elsewhere in the app.
    const { UNSAFE_getByType } = render(<Skeleton width={150} height={14} />);

    const animatedView = UNSAFE_getByType(Animated.View);
    const style = Array.isArray(animatedView.props.style)
      ? Object.assign({}, ...animatedView.props.style.map((s: any) => s || {}))
      : animatedView.props.style;

    expect(style.borderRadius).toBe(8);
  });

  // -------------------------------------------------------------------------
  it("applies a custom borderRadius when specified (e.g. 999 for circular avatar)", () => {
    // WHAT: A merchant profile avatar skeleton needs borderRadius: 999 to
    //       render as a circle. The prop must override the default.
    // WHY: Without configurable borderRadius, circular skeleton placeholders
    //      cannot be built — the party list header would show a rectangle
    //      where a circular avatar placeholder is expected.
    const { UNSAFE_getByType } = render(
      <Skeleton width={40} height={40} borderRadius={999} />
    );

    const animatedView = UNSAFE_getByType(Animated.View);
    const style = Array.isArray(animatedView.props.style)
      ? Object.assign({}, ...animatedView.props.style.map((s: any) => s || {}))
      : animatedView.props.style;

    expect(style.borderRadius).toBe(999);
  });

  // -------------------------------------------------------------------------
  it("starts an Animated loop on mount for the pulsing effect", () => {
    // WHAT: useEffect starts Animated.loop(Animated.sequence([...])) on mount.
    // WHY: If the animation does not start, skeletons are static opaque blocks
    //      with no breathing motion — they look like broken UI elements rather
    //      than intentional loading placeholders.
    render(<Skeleton width={100} height={10} />);

    expect(Animated.loop).toHaveBeenCalled();
    const mockLoop = Animated.loop as jest.Mock;
    const loopInstance = mockLoop.mock.results[0].value;
    expect(loopInstance.start).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  it("stops the Animated loop on unmount to prevent memory leaks", () => {
    // WHAT: The useEffect cleanup function calls anim.stop().
    // WHY: Animated loops hold a reference to the Animated.Value. If the loop
    //      is not stopped when the component unmounts (e.g. query data arrives
    //      and replaces the skeleton), the loop continues running in memory,
    //      accumulating leaked loops proportional to the number of list items —
    //      a serious memory issue on invoice lists with 100+ items.
    const { unmount } = render(<Skeleton width={100} height={10} />);
    const mockLoop = Animated.loop as jest.Mock;
    const loopInstance = mockLoop.mock.results[0].value;

    unmount();

    expect(loopInstance.stop).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  it("applies a custom style prop for margin/positioning overrides", () => {
    // WHAT: Callers can pass a style prop to add margin or override positioning.
    // WHY: Skeleton items in a list need marginBottom to maintain the same
    //      spacing as the actual content rows they represent. If style is
    //      ignored, the skeleton layout looks compressed compared to the loaded
    //      list — a jarring layout shift when content arrives.
    const { UNSAFE_getByType } = render(
      <Skeleton width={200} height={16} style={{ marginBottom: 8 }} />
    );

    const animatedView = UNSAFE_getByType(Animated.View);
    const styleArray = Array.isArray(animatedView.props.style)
      ? animatedView.props.style
      : [animatedView.props.style];

    const hasMargin = styleArray.some((s: any) => s && s.marginBottom === 8);
    expect(hasMargin).toBe(true);
  });

  // -------------------------------------------------------------------------
  it("uses useNativeDriver: true for 60fps animation on the native thread", () => {
    // WHAT: The Animated.timing calls must specify useNativeDriver: true.
    // WHY: Without native driver, opacity animation runs on the JS thread.
    //      When a tRPC query resolves and React re-renders the list, the JS
    //      thread is busy — causing the skeleton animation to freeze mid-pulse.
    //      Native driver keeps animations smooth at 60fps independently of
    //      JS thread load.
    render(<Skeleton width={100} height={10} />);

    const mockTiming = Animated.timing as jest.Mock;
    const timingCalls = mockTiming.mock.calls;

    // Both the fade-in and fade-out timing calls must use native driver
    timingCalls.forEach(([_value, config]: [any, any]) => {
      expect(config.useNativeDriver).toBe(true);
    });
  });
});
