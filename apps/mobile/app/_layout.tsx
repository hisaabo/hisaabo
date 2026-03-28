import { useEffect, useState, useRef, useCallback } from "react";
import {
  useColorScheme,
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
  AppState,
} from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { TRPCProvider } from "../src/providers/TRPCProvider";
import { useAuthStore } from "../src/stores/auth";
import { useBusinessStore } from "../src/stores/business";
import { useBiometricStore } from "../src/stores/biometric";
import { LockScreen } from "../src/components/LockScreen";

// Keep the native splash screen visible while we hydrate stores
SplashScreen.preventAutoHideAsync();

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

/* ─── Brand Colors ───────────────────────────────────────────────────────── */
const C = {
  bg: "#0f0f1a",
  brand: "#5b5bd6",
  brandLight: "rgba(91, 91, 214, 0.15)",
  brandBorder: "rgba(91, 91, 214, 0.25)",
  amber: "#fbbf24",
  textPrimary: "#ffffff",
  textMuted: "#6b7280",
} as const;

/* ─── Animated Background Mesh ───────────────────────────────────────────── */
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

/* ─── Splash Logo Icon (4-square brand pattern) ─────────────────────────── */
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

/* ─── Animated Splash Screen ─────────────────────────────────────────────── */
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

/* ─── Splash Styles ──────────────────────────────────────────────────────── */
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

/* ─── Root Layout ────────────────────────────────────────────────────────── */
/** How long the app must be in background before re-locking (ms) */
const RELOCK_THRESHOLD = 30_000;

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const hydrate = useAuthStore((s) => s.hydrate);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const hydrateBusinessStore = useBusinessStore((s) => s.hydrate);

  const hydrateBiometric = useBiometricStore((s) => s.hydrate);
  const biometricHydrated = useBiometricStore((s) => s.isHydrated);
  const isLocked = useBiometricStore((s) => s.isLocked);
  const biometricEnabled = useBiometricStore((s) => s.biometricEnabled);
  const pinEnabled = useBiometricStore((s) => s.pinEnabled);
  const lockApp = useBiometricStore((s) => s.lock);

  const [appReady, setAppReady] = useState(false);
  const [splashDone, setSplashDone] = useState(false);

  // Track when the app went to background for re-lock logic
  const lastBackground = useRef(Date.now());

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

  // Re-lock when app returns from background after threshold
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        lastBackground.current = Date.now();
      }
      if (state === "active") {
        const elapsed = Date.now() - lastBackground.current;
        if (elapsed > RELOCK_THRESHOLD) {
          lockApp();
        }
      }
    });
    return () => sub.remove();
  }, [lockApp]);

  // Don't render app content until auth + biometric stores have hydrated
  if (!isHydrated || !biometricHydrated) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <AnimatedSplash ready={appReady} onFinish={() => setSplashDone(true)} />
      </View>
    );
  }

  return (
    <TRPCProvider>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
      </Stack>
      {/* Lock screen overlay — renders on top when locked */}
      {isLocked && (biometricEnabled || pinEnabled) && splashDone && <LockScreen />}
      {/* Custom animated splash renders on top until animation completes */}
      {!splashDone && (
        <AnimatedSplash ready={appReady} onFinish={() => setSplashDone(true)} />
      )}
    </TRPCProvider>
  );
}
