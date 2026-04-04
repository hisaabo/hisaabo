import { useEffect, useState, useRef, useCallback } from "react";
import {
  useColorScheme,
  View,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
  AppState,
  Alert,
} from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { TRPCProvider } from "../src/providers/TRPCProvider";
import { useAuthStore } from "../src/stores/auth";
import { useBusinessStore } from "../src/stores/business";
import { useBiometricStore } from "../src/stores/biometric";
import { LockScreen } from "../src/components/LockScreen";
import { vanillaTRPC } from "../src/lib/trpc";

// Keep the native splash screen visible while we hydrate stores
SplashScreen.preventAutoHideAsync();

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

/* --- Brand Colors -------------------------------------------------------- */
const C = {
  bg: "#0f0f1a",
  brand: "#5b5bd6",
  brandLight: "rgba(91, 91, 214, 0.15)",
  brandBorder: "rgba(91, 91, 214, 0.25)",
  amber: "#fbbf24",
  textPrimary: "#ffffff",
  textMuted: "#6b7280",
} as const;

/* --- Animated Background Mesh -------------------------------------------- */
function SplashBackgroundMesh({
  blob1Anim,
  blob2Anim,
}: {
  blob1Anim: Animated.Value;
  blob2Anim: Animated.Value;
}) {
  const blob1Translate = blob1Anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -25],
  });

  const blob2Translate = blob2Anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 20],
  });

  const blob1Scale = blob1Anim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 1.05, 1],
  });

  const blob2Scale = blob2Anim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 1.08, 1],
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Indigo blob - upper right */}
      <Animated.View
        style={[
          splashStyles.meshBlob1,
          {
            transform: [
              { translateY: blob1Translate },
              { scale: blob1Scale },
            ],
          },
        ]}
      />
      {/* Amber blob - lower left */}
      <Animated.View
        style={[
          splashStyles.meshBlob2,
          {
            transform: [
              { translateY: blob2Translate },
              { scale: blob2Scale },
            ],
          },
        ]}
      />
    </View>
  );
}

/* --- Splash Logo Icon (4-square brand pattern) --------------------------- */
function SplashLogoIcon({ size = 72 }: { size?: number }) {
  const squareSize = (size - 16) / 2 - 2;
  const radius = squareSize * 0.22;

  return (
    <View
      style={[
        splashStyles.logoContainer,
        {
          width: size,
          height: size,
          borderRadius: size * 0.27,
        },
      ]}
    >
      <View
        style={[
          splashStyles.logoGrid,
          {
            width: squareSize * 2 + 4,
            height: squareSize * 2 + 4,
          },
        ]}
      >
        {/* Top-left: white 0.9 */}
        <View
          style={{
            width: squareSize,
            height: squareSize,
            borderRadius: radius,
            backgroundColor: "rgba(255, 255, 255, 0.9)",
          }}
        />
        {/* Top-right: white 0.7 */}
        <View
          style={{
            width: squareSize,
            height: squareSize,
            borderRadius: radius,
            backgroundColor: "rgba(255, 255, 255, 0.7)",
          }}
        />
        {/* Bottom-left: white 0.6 */}
        <View
          style={{
            width: squareSize,
            height: squareSize,
            borderRadius: radius,
            backgroundColor: "rgba(255, 255, 255, 0.6)",
          }}
        />
        {/* Bottom-right: amber with glow overlay */}
        <View
          style={{
            width: squareSize,
            height: squareSize,
            borderRadius: radius,
            backgroundColor: C.amber,
            opacity: 0.9,
          }}
        />
      </View>
    </View>
  );
}

/* --- Animated Splash Screen ---------------------------------------------- */
function AnimatedSplash({
  ready,
  onFinish,
}: {
  ready: boolean;
  onFinish: () => void;
}) {
  // Logo entrance animations
  const logoScale = useRef(new Animated.Value(0.85)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;

  // Text entrance animations
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textTranslateY = useRef(new Animated.Value(8)).current;

  // Tagline entrance animations
  const taglineOpacity = useRef(new Animated.Value(0)).current;

  // Amber glow pulse
  const glowOpacity = useRef(new Animated.Value(0)).current;

  // Background mesh blobs
  const blob1Anim = useRef(new Animated.Value(0)).current;
  const blob2Anim = useRef(new Animated.Value(0)).current;

  // Exit animation
  const exitOpacity = useRef(new Animated.Value(1)).current;

  // Track if entrance is done so exit can proceed
  const entranceDone = useRef(false);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  // Start entrance animations on mount
  useEffect(() => {
    // 1. Logo entrance (0-500ms): scale 0.85 -> 1.0 + fade in, spring physics
    const logoEntrance = Animated.parallel([
      Animated.spring(logoScale, {
        toValue: 1,
        tension: 60,
        friction: 8,
        useNativeDriver: true,
      }),
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]);

    // 2. Text entrance (300-700ms): fade in + slide up 8px
    const textEntrance = Animated.parallel([
      Animated.timing(textOpacity, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(textTranslateY, {
        toValue: 0,
        duration: 400,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    // 3. Tagline entrance (500-900ms)
    const taglineEntrance = Animated.timing(taglineOpacity, {
      toValue: 1,
      duration: 400,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    });

    // Amber glow pulse (continuous)
    const glowPulse = Animated.loop(
      Animated.sequence([
        Animated.timing(glowOpacity, {
          toValue: 0.6,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glowOpacity, {
          toValue: 0.2,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    // Background mesh blob animations (continuous)
    const animateBlob = (anim: Animated.Value, duration: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 1,
            duration,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );

    const blobLoop1 = animateBlob(blob1Anim, 6000);
    const blobLoop2 = animateBlob(blob2Anim, 8000);

    // Sequence the entrance animations
    Animated.sequence([
      logoEntrance,
      Animated.delay(100),
      textEntrance,
      Animated.delay(100),
      taglineEntrance,
    ]).start(() => {
      entranceDone.current = true;
      // If stores were already ready before entrance finished, trigger exit now
      if (readyRef.current) {
        startExit();
      }
    });

    // Start continuous animations
    glowPulse.start();
    blobLoop1.start();
    blobLoop2.start();

    return () => {
      glowPulse.stop();
      blobLoop1.stop();
      blobLoop2.stop();
    };
  }, []);

  const startExit = useCallback(() => {
    Animated.timing(exitOpacity, {
      toValue: 0,
      duration: 400,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start(() => {
      onFinish();
    });
  }, [exitOpacity, onFinish]);

  // When ready becomes true, trigger exit (if entrance is done)
  useEffect(() => {
    if (ready && entranceDone.current) {
      startExit();
    }
  }, [ready, startExit]);

  return (
    <Animated.View
      style={[
        splashStyles.splashContainer,
        { opacity: exitOpacity },
      ]}
      pointerEvents="none"
    >
      {/* Animated background mesh */}
      <SplashBackgroundMesh blob1Anim={blob1Anim} blob2Anim={blob2Anim} />

      {/* Center content */}
      <View style={splashStyles.centerContent}>
        {/* Amber glow behind logo */}
        <Animated.View
          style={[
            splashStyles.amberGlow,
            { opacity: glowOpacity },
          ]}
        />

        {/* Logo with entrance animation */}
        <Animated.View
          style={{
            opacity: logoOpacity,
            transform: [{ scale: logoScale }],
          }}
        >
          <SplashLogoIcon size={72} />
        </Animated.View>

        {/* Brand name with delayed entrance */}
        <Animated.Text
          style={[
            splashStyles.brandText,
            {
              opacity: textOpacity,
              transform: [{ translateY: textTranslateY }],
            },
          ]}
        >
          Hisaabo
        </Animated.Text>

        {/* Tagline */}
        <Animated.Text
          style={[
            splashStyles.taglineText,
            { opacity: taglineOpacity },
          ]}
        >
          Hisaab, pakka.
        </Animated.Text>
      </View>
    </Animated.View>
  );
}

/* --- Splash Styles ------------------------------------------------------- */
const splashStyles = StyleSheet.create({
  splashContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: C.bg,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
  },
  centerContent: {
    alignItems: "center",
    justifyContent: "center",
  },
  logoContainer: {
    backgroundColor: C.brandLight,
    borderWidth: 1,
    borderColor: C.brandBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  logoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  brandText: {
    color: C.textPrimary,
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.5,
    marginTop: 20,
  },
  taglineText: {
    color: C.textMuted,
    fontSize: 11,
    fontFamily: "monospace",
    letterSpacing: 1.5,
    marginTop: 8,
    textTransform: "uppercase",
  },
  amberGlow: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(251, 191, 36, 0.08)",
    top: -34,
  },
  meshBlob1: {
    position: "absolute",
    top: SCREEN_HEIGHT * 0.15,
    right: -SCREEN_WIDTH * 0.2,
    width: SCREEN_WIDTH * 0.8,
    height: SCREEN_WIDTH * 0.8,
    borderRadius: SCREEN_WIDTH * 0.4,
    backgroundColor: "rgba(91, 91, 214, 0.08)",
  },
  meshBlob2: {
    position: "absolute",
    bottom: SCREEN_HEIGHT * 0.15,
    left: -SCREEN_WIDTH * 0.25,
    width: SCREEN_WIDTH * 0.7,
    height: SCREEN_WIDTH * 0.7,
    borderRadius: SCREEN_WIDTH * 0.35,
    backgroundColor: "rgba(251, 191, 36, 0.05)",
  },
});

/* --- Auth Gate States ---------------------------------------------------- */
/**
 * The root layout uses a state machine to gate access:
 *
 *   loading  - stores are hydrating, splash is visible
 *   locked   - user has a token AND biometric/PIN is enabled;
 *              the lock screen renders as the ONLY content (no app underneath)
 *   ready    - user is authenticated locally (and server session verified);
 *              render the full app
 *   login    - no token OR server session expired; redirect to login
 */
type AuthGateState = "loading" | "locked" | "ready" | "login";

/** How long the app must be in background before re-locking (ms) */
const RELOCK_THRESHOLD = 30_000;

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();

  // Auth store
  const hydrate = useAuthStore((s) => s.hydrate);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);

  // Business store
  const hydrateBusinessStore = useBusinessStore((s) => s.hydrate);

  // Biometric store
  const hydrateBiometric = useBiometricStore((s) => s.hydrate);
  const biometricHydrated = useBiometricStore((s) => s.isHydrated);
  const biometricEnabled = useBiometricStore((s) => s.biometricEnabled);
  const pinEnabled = useBiometricStore((s) => s.pinEnabled);
  const lockApp = useBiometricStore((s) => s.lock);
  const unlockApp = useBiometricStore((s) => s.unlock);

  // Gate state machine
  const [authGate, setAuthGate] = useState<AuthGateState>("loading");

  // Splash animation state
  const [appReady, setAppReady] = useState(false);
  const [splashDone, setSplashDone] = useState(false);

  // Track when the app went to background for re-lock logic
  const lastBackground = useRef(Date.now());

  // --- Step 1: Hydrate all stores ----------------------------------------
  useEffect(() => {
    async function prepare() {
      await Promise.all([hydrate(), hydrateBusinessStore(), hydrateBiometric()]);
      // Hide the native splash to reveal our custom animated one
      await SplashScreen.hideAsync();
      // Signal the custom splash to begin its exit animation
      setAppReady(true);
    }
    prepare();
  }, []);

  // --- Step 2: Determine gate state after hydration ----------------------
  useEffect(() => {
    if (!isHydrated || !biometricHydrated) return;
    // Only set initial gate state when still in loading
    if (authGate !== "loading") return;

    if (!token) {
      if (__DEV__) console.log("[AuthGate] No token -> login");
      setAuthGate("login");
    } else if (biometricEnabled || pinEnabled) {
      // User has a token AND local auth is enabled -- show lock screen FIRST.
      // No app content will render until the user authenticates locally AND
      // the server session is verified.
      if (__DEV__) console.log("[AuthGate] Token present, biometric/pin enabled -> locked");
      setAuthGate("locked");
    } else {
      // No local auth -- verify token silently then show app.
      // The (app)/_layout.tsx already calls auth.me, so we can go straight
      // to ready. If the token is expired, (app)/_layout.tsx will redirect
      // to login.
      if (__DEV__) console.log("[AuthGate] Token present, no local auth -> verifying");
      verifyTokenAndProceed();
    }
  }, [isHydrated, biometricHydrated]);

  // --- Token verification helper -----------------------------------------
  const verifyTokenAndProceed = useCallback(async () => {
    if (__DEV__) {
      const { getTokenSync } = require("../src/lib/auth");
      console.log("[AuthGate] verifyTokenAndProceed: tokenSync =", getTokenSync() ? "set" : "null");
    }
    try {
      const result = await vanillaTRPC.auth.me.query();
      if (__DEV__) console.log("[AuthGate] verifyTokenAndProceed: result.user =", result.user ? result.user.email : "null");
      if (result.user) {
        if (!result.user.name) {
          // Account exists but profile is incomplete -- send to complete-profile
          if (__DEV__) console.log("[AuthGate] verifyTokenAndProceed: no name, redirecting to complete-profile");
          setAuthGate("login");
          router.replace("/(auth)/complete-profile");
        } else {
          unlockApp();
          setAuthGate("ready");
        }
      } else {
        // Token exists but server says no user -- session expired
        await logout();
        setAuthGate("login");
        Alert.alert(
          "Session expired",
          "Your session has expired. Please sign in again."
        );
      }
    } catch (err) {
      if (__DEV__) console.log("[AuthGate] verifyTokenAndProceed: network error, allowing access", err);
      // Network error -- for a financial app we could require network,
      // but to avoid blocking users on bad connections, allow access.
      // The app layout's auth.me query will handle it gracefully.
      unlockApp();
      setAuthGate("ready");
    }
  }, [logout, unlockApp, router]);

  // --- Lock screen callbacks ---------------------------------------------
  /**
   * Called by LockScreen after successful biometric/PIN authentication.
   * Verifies the server session before allowing access to app content.
   */
  const handleLockScreenUnlock = useCallback(async () => {
    if (__DEV__) {
      const { getTokenSync } = require("../src/lib/auth");
      const syncToken = getTokenSync();
      console.log("[AuthGate] handleLockScreenUnlock: tokenSync =", syncToken ? "set" : "null", "storeToken =", token ? "set" : "null");
    }
    try {
      const result = await vanillaTRPC.auth.me.query();
      if (__DEV__) console.log("[AuthGate] handleLockScreenUnlock: result.user =", result.user ? result.user.email : "null");
      if (result.user) {
        unlockApp();
        setAuthGate("ready");
      } else {
        // Token expired while the app was locked
        if (__DEV__) console.log("[AuthGate] handleLockScreenUnlock: session expired, logging out");
        await logout();
        setAuthGate("login");
        Alert.alert(
          "Session expired",
          "Your session has expired. Please sign in again."
        );
      }
    } catch (err) {
      if (__DEV__) console.log("[AuthGate] handleLockScreenUnlock: network error, allowing access", err);
      // Network error -- allow access, the app will handle it gracefully
      unlockApp();
      setAuthGate("ready");
    }
  }, [logout, unlockApp, token]);

  /**
   * Called when the user taps "Sign out" on the lock screen.
   */
  const handleLockScreenSignOut = useCallback(async () => {
    await logout();
    unlockApp();
    setAuthGate("login");
  }, [logout, unlockApp]);

  // --- Re-lock when returning from background ----------------------------
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        lastBackground.current = Date.now();
      }
      if (state === "active") {
        const elapsed = Date.now() - lastBackground.current;
        if (__DEV__) console.log(`[AuthGate] AppState active: elapsed=${elapsed}ms, biometric=${biometricEnabled}, pin=${pinEnabled}, gate=${authGate}`);
        if (
          elapsed > RELOCK_THRESHOLD &&
          (biometricEnabled || pinEnabled) &&
          authGate === "ready"
        ) {
          if (__DEV__) console.log("[AuthGate] Re-locking app");
          lockApp();
          setAuthGate("locked");
        }
      }
    });
    return () => sub.remove();
  }, [lockApp, biometricEnabled, pinEnabled, authGate]);

  // --- When the user logs out from within the app, reset gate state ------
  useEffect(() => {
    if (isHydrated && !token && authGate === "ready") {
      if (__DEV__) console.log("[AuthGate] Token cleared while ready -> login");
      setAuthGate("login");
    }
  }, [token, isHydrated, authGate]);

  // --- Render: splash while loading / hydrating --------------------------
  if (authGate === "loading" || !splashDone) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <AnimatedSplash ready={appReady} onFinish={() => setSplashDone(true)} />
      </View>
    );
  }

  // --- Render: lock screen as the ONLY content (gate, not overlay) -------
  if (authGate === "locked") {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <StatusBar style="light" />
        <LockScreen
          onUnlock={handleLockScreenUnlock}
          onSignOut={handleLockScreenSignOut}
        />
      </View>
    );
  }

  // --- Render: login or ready -- both go through the router --------------
  // When authGate is "login", the Stack renders (auth) routes.
  // When authGate is "ready", the Stack renders (app) routes.
  // The (app)/_layout.tsx still has its own token check + Redirect to login
  // as a safety net, and handles business/tenant selection.
  return (
    <TRPCProvider>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <AuthGateRouter authGate={authGate} token={token} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
        <Stack.Screen name="invite/[token]" />
      </Stack>
    </TRPCProvider>
  );
}

/**
 * Handles navigation redirects based on auth gate state.
 *
 * When the Stack remounts after a lock screen unlock, Expo Router may default
 * to the (auth) group (since it's listed first). This component ensures the
 * correct group is shown by issuing a `router.replace` when a mismatch is
 * detected between the current segment and the desired gate state.
 */
function AuthGateRouter({
  authGate,
  token,
}: {
  authGate: AuthGateState;
  token: string | null;
}) {
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    // Only act when the gate has settled to "ready" or "login"
    if (authGate !== "ready" && authGate !== "login") return;

    const inAuthGroup = segments[0] === "(auth)";
    const inAppGroup = segments[0] === "(app)";

    if (__DEV__) console.log(`[AuthGateRouter] gate=${authGate}, segments=${segments.join("/")}, token=${token ? "set" : "null"}`);

    if (authGate === "ready" && token && !inAppGroup) {
      // User is authenticated but Expo Router defaulted to (auth) or
      // hasn't navigated yet — push to the app group.
      if (__DEV__) console.log("[AuthGateRouter] Redirecting to /(app)");
      router.replace("/(app)");
    } else if (authGate === "login" && !token && !inAuthGroup) {
      // User is not authenticated but showing app — push to login.
      if (__DEV__) console.log("[AuthGateRouter] Redirecting to /(auth)/login");
      router.replace("/(auth)/login");
    }
  }, [authGate, segments, token, router]);

  return null;
}
