import { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Animated,
  Easing,
  Dimensions,
  StatusBar,
} from "react-native";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { trpc } from "../../src/lib/trpc";
import { useAuthStore } from "../../src/stores/auth";

/* ─── Types ──────────────────────────────────────────────────────────────── */
type AuthMode = "magic-link" | "magic-link-sent" | "password";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

/* ─── Brand Colors ───────────────────────────────────────────────────────── */
const C = {
  bg: "#0f0f1a",
  surface: "#1a1a2e",
  border: "#2d2d44",
  brand: "#5b5bd6",
  brandLight: "rgba(91, 91, 214, 0.15)",
  amber: "#fbbf24",
  amberBg: "rgba(251, 191, 36, 0.12)",
  amberBorder: "rgba(251, 191, 36, 0.25)",
  textPrimary: "#ffffff",
  textSecondary: "#9ca3af",
  textMuted: "#6b7280",
  error: "#ef4444",
  errorBg: "rgba(239, 68, 68, 0.1)",
  errorBorder: "rgba(239, 68, 68, 0.25)",
} as const;

/* ─── Logo Icon (4-square brand pattern) ─────────────────────────────────── */
function LogoIcon({ size = 44 }: { size?: number }) {
  const squareSize = (size - 16) / 2 - 2;
  const radius = squareSize * 0.22;

  return (
    <View
      style={[
        styles.logoContainer,
        {
          width: size,
          height: size,
          borderRadius: size * 0.27,
        },
      ]}
    >
      <View style={[styles.logoGrid, { width: squareSize * 2 + 4, height: squareSize * 2 + 4 }]}>
        {/* Top-left: white 0.9 */}
        <View
          style={[
            styles.logoSquare,
            {
              width: squareSize,
              height: squareSize,
              borderRadius: radius,
              backgroundColor: "rgba(255, 255, 255, 0.9)",
            },
          ]}
        />
        {/* Top-right: white 0.7 */}
        <View
          style={[
            styles.logoSquare,
            {
              width: squareSize,
              height: squareSize,
              borderRadius: radius,
              backgroundColor: "rgba(255, 255, 255, 0.7)",
            },
          ]}
        />
        {/* Bottom-left: white 0.6 */}
        <View
          style={[
            styles.logoSquare,
            {
              width: squareSize,
              height: squareSize,
              borderRadius: radius,
              backgroundColor: "rgba(255, 255, 255, 0.6)",
            },
          ]}
        />
        {/* Bottom-right: amber */}
        <View
          style={[
            styles.logoSquare,
            {
              width: squareSize,
              height: squareSize,
              borderRadius: radius,
              backgroundColor: C.amber,
              opacity: 0.9,
            },
          ]}
        />
      </View>
    </View>
  );
}

/* ─── Trust Badge Pill ───────────────────────────────────────────────────── */
function TrustBadge({ label }: { label: string }) {
  return (
    <View style={styles.trustBadge}>
      <Text style={styles.trustBadgeCheck}>✓</Text>
      <Text style={styles.trustBadgeText}>{label}</Text>
    </View>
  );
}

/* ─── Or Divider ─────────────────────────────────────────────────────────── */
function OrDivider() {
  return (
    <View style={styles.dividerRow}>
      <View style={styles.dividerLine} />
      <Text style={styles.dividerText}>or</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

/* ─── Error Banner ───────────────────────────────────────────────────────── */
function ErrorBanner({ message }: { message: string }) {
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorBannerText}>{message}</Text>
    </View>
  );
}

/* ─── Shimmer Bar (animated progress indicator) ──────────────────────────── */
function ShimmerBar() {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [shimmerAnim]);

  const widthInterpolation = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["20%", "75%"],
  });

  const opacityInterpolation = shimmerAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 0.6, 1],
  });

  return (
    <View style={styles.shimmerTrack}>
      <Animated.View
        style={[
          styles.shimmerFill,
          {
            width: widthInterpolation,
            opacity: opacityInterpolation,
            backgroundColor: C.brand,
          },
        ]}
      />
    </View>
  );
}

/* ─── Animated Envelope Icon ─────────────────────────────────────────────── */
function AnimatedEnvelope() {
  const riseAnim = useRef(new Animated.Value(0)).current;
  const ringAnim = useRef(new Animated.Value(0)).current;
  const floatAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Entrance animations
    Animated.parallel([
      Animated.spring(riseAnim, {
        toValue: 1,
        damping: 12,
        stiffness: 100,
        useNativeDriver: true,
      }),
      Animated.timing(ringAnim, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    // Continuous gentle float
    const float = Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    float.start();
    return () => float.stop();
  }, [riseAnim, ringAnim, floatAnim]);

  const envelopeTranslateY = riseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 0],
  });

  const envelopeScale = riseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.85, 1],
  });

  const ringScale = ringAnim.interpolate({
    inputRange: [0, 0.6, 1],
    outputRange: [0.7, 1.15, 1],
  });

  const floatY = floatAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -6],
  });

  return (
    <View style={styles.envelopeWrapper}>
      {/* Outer ring */}
      <Animated.View
        style={[
          styles.envelopeRing,
          {
            opacity: ringAnim,
            transform: [{ scale: ringScale }],
          },
        ]}
      />
      {/* Inner circle with envelope */}
      <Animated.View
        style={[
          styles.envelopeInner,
          {
            opacity: riseAnim,
            transform: [
              { translateY: Animated.add(envelopeTranslateY, floatY) },
              { scale: envelopeScale },
            ],
          },
        ]}
      >
        <Text style={styles.envelopeEmoji}>✉️</Text>
      </Animated.View>
    </View>
  );
}

/* ─── Background Gradient Mesh ───────────────────────────────────────────── */
function BackgroundMesh() {
  const blob1Anim = useRef(new Animated.Value(0)).current;
  const blob2Anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (anim: Animated.Value, duration: number) =>
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

    const l1 = animate(blob1Anim, 8000);
    const l2 = animate(blob2Anim, 10000);
    l1.start();
    l2.start();
    return () => {
      l1.stop();
      l2.stop();
    };
  }, [blob1Anim, blob2Anim]);

  const blob1Y = blob1Anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -20],
  });

  const blob2Y = blob2Anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 15],
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View
        style={[
          styles.meshBlob1,
          { transform: [{ translateY: blob1Y }] },
        ]}
      />
      <Animated.View
        style={[
          styles.meshBlob2,
          { transform: [{ translateY: blob2Y }] },
        ]}
      />
    </View>
  );
}

/* ─── Dev-mode Token Input (only rendered when __DEV__ is true) ──────────── */
function DevTokenInput() {
  const [devToken, setDevToken] = useState("");
  const [devError, setDevError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const login = useAuthStore((s) => s.login);

  const verifyMutation = trpc.auth.verifyMagicLink.useMutation({
    onSuccess: async (data) => {
      if (data.sessionToken) {
        setDevError("");
        await login(data.sessionToken);
        router.replace("/(app)/(home)");
      }
    },
    onError: (err) => {
      setDevError(err.message);
    },
  });

  const handleVerify = useCallback(() => {
    const token = devToken.trim();
    if (!token) return;
    setDevError("");
    verifyMutation.mutate({ token });
  }, [devToken, verifyMutation]);

  return (
    <View style={styles.devContainer}>
      <TouchableOpacity
        style={styles.devHeader}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.7}
      >
        <View style={styles.devBadge}>
          <Text style={styles.devBadgeText}>DEV</Text>
        </View>
        <Text style={styles.devHeaderText}>Developer Mode</Text>
        <Text style={styles.devChevron}>{expanded ? "\u25B2" : "\u25BC"}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.devBody}>
          <Text style={styles.devHint}>
            Paste the token from the API console output (the value after
            ?token= in the magic link URL).
          </Text>

          <TextInput
            style={styles.devInput}
            value={devToken}
            onChangeText={(t) => {
              setDevToken(t);
              setDevError("");
            }}
            placeholder="Paste token here"
            placeholderTextColor={C.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={handleVerify}
            editable={!verifyMutation.isPending}
          />

          {devError ? (
            <View style={styles.devErrorBanner}>
              <Text style={styles.devErrorText}>{devError}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[
              styles.devButton,
              (verifyMutation.isPending || !devToken.trim()) &&
                styles.buttonDisabled,
            ]}
            onPress={handleVerify}
            disabled={verifyMutation.isPending || !devToken.trim()}
            activeOpacity={0.8}
          >
            {verifyMutation.isPending ? (
              <ActivityIndicator color={C.textPrimary} size="small" />
            ) : (
              <Text style={styles.devButtonText}>Verify Token</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ─── Main Login Screen ──────────────────────────────────────────────────── */
/* ═══════════════════════════════════════════════════════════════════════════ */
export default function LoginScreen() {
  /* ── State ─────────────────────────────────────────────────────── */
  const [mode, setMode] = useState<AuthMode>("magic-link");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const passwordRef = useRef<TextInput>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync("sessionExpired").then((v: string | null) => {
      if (v === "1") {
        setSessionExpired(true);
        SecureStore.deleteItemAsync("sessionExpired");
      }
    });
  }, []);

  /* ── Animations ────────────────────────────────────────────────── */
  const logoAnim = useRef(new Animated.Value(0)).current;
  const formAnim = useRef(new Animated.Value(0)).current;
  const fadeTransition = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Logo entrance: fade + scale 0.8 -> 1.0
    Animated.timing(logoAnim, {
      toValue: 1,
      duration: 300,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();

    // Form entrance: slide up 20px + fade, delayed 200ms
    setTimeout(() => {
      Animated.timing(formAnim, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    }, 200);
  }, [logoAnim, formAnim]);

  /* ── Cooldown timer for resend ─────────────────────────────────── */
  useEffect(() => {
    if (cooldown <= 0) {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
      return;
    }
    cooldownRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          clearInterval(cooldownRef.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, [cooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Mutations ─────────────────────────────────────────────────── */
  const sendMagicLink = trpc.auth.sendMagicLink.useMutation({
    onSuccess: () => {
      setError("");
      setCooldown(60);
      switchMode("magic-link-sent");
    },
    onError: (err) => setError(err.message),
  });

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async (data) => {
      setError("");
      await useAuthStore.getState().login(data.sessionToken);
      router.replace("/(app)/(home)");
    },
    onError: (err) => setError(err.message),
  });

  const isPending = sendMagicLink.isPending || loginMutation.isPending;

  /* ── Handlers ──────────────────────────────────────────────────── */
  const switchMode = useCallback(
    (next: AuthMode) => {
      // Cross-fade transition
      Animated.timing(fadeTransition, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start(() => {
        setMode(next);
        setError("");
        Animated.timing(fadeTransition, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }).start();
      });
    },
    [fadeTransition]
  );

  const handleSendMagicLink = useCallback(() => {
    if (!email.includes("@")) return;
    setError("");
    sendMagicLink.mutate({ email, source: "mobile" });
  }, [email, sendMagicLink]);

  const handlePasswordLogin = useCallback(() => {
    if (!email.includes("@") || !password) return;
    setError("");
    loginMutation.mutate({ email, password });
  }, [email, password, loginMutation]);

  const handleResend = useCallback(() => {
    if (cooldown > 0 || sendMagicLink.isPending) return;
    sendMagicLink.mutate({ email, source: "mobile" });
    setCooldown(60);
  }, [cooldown, email, sendMagicLink]);

  /* ── Animated style values ─────────────────────────────────────── */
  const logoScale = logoAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.8, 1],
  });

  const formTranslateY = formAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [20, 0],
  });

  /* ═════════════════════════════════════════════════════════════════ */
  /* ─── Render ───────────────────────────────────────────────────── */
  /* ═════════════════════════════════════════════════════════════════ */
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <BackgroundMesh />

      {sessionExpired && (
        <View style={styles.sessionExpiredBanner}>
          <Text style={styles.sessionExpiredText}>
            Your session was ended. Please sign in again.
          </Text>
        </View>
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex1}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
          keyboardDismissMode="on-drag"
        >
          {/* ── Brand Header ─────────────────────────────────────── */}
          <Animated.View
            style={[
              styles.brandSection,
              {
                opacity: logoAnim,
                transform: [{ scale: logoScale }],
              },
            ]}
          >
            <LogoIcon size={44} />
            <Text style={styles.brandName}>Hisaabo</Text>
          </Animated.View>

          {/* ── Content Area (cross-faded) ────────────────────────── */}
          <Animated.View
            style={[
              styles.contentArea,
              {
                opacity: Animated.multiply(formAnim, fadeTransition),
                transform: [{ translateY: formTranslateY }],
              },
            ]}
          >
            {/* ── Mode: Magic Link ────────────────────────────────── */}
            {mode === "magic-link" && (
              <>
                {/* Hero copy */}
                <View style={styles.heroSection}>
                  <Text style={styles.heroText}>
                    Your business,{"\n"}your books.{"\n"}
                    <Text style={styles.heroAmber}>Always clear.</Text>
                  </Text>
                </View>

                {/* Email input */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Email address</Text>
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={(t) => {
                      setEmail(t);
                      setError("");
                    }}
                    placeholder="you@example.com"
                    placeholderTextColor={C.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus
                    returnKeyType="go"
                    onSubmitEditing={handleSendMagicLink}
                    editable={!isPending}
                  />
                </View>

                {error ? <ErrorBanner message={error} /> : null}

                {/* Continue button */}
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    (isPending || !email.includes("@")) &&
                      styles.buttonDisabled,
                  ]}
                  onPress={handleSendMagicLink}
                  disabled={isPending || !email.includes("@")}
                  activeOpacity={0.8}
                >
                  {sendMagicLink.isPending ? (
                    <ActivityIndicator color={C.textPrimary} size="small" />
                  ) : (
                    <Text style={styles.primaryButtonText}>
                      Continue with Email
                    </Text>
                  )}
                </TouchableOpacity>

                <Text style={styles.helperText}>
                  No password needed — we'll send you a secure link
                </Text>

                {/* Or divider */}
                <OrDivider />

                {/* Password fallback */}
                <TouchableOpacity
                  style={styles.ghostButton}
                  onPress={() => switchMode("password")}
                  activeOpacity={0.7}
                >
                  <Text style={styles.ghostButtonText}>
                    Use password instead
                  </Text>
                </TouchableOpacity>

                {/* Trust badges */}
                <View style={styles.trustRow}>
                  <TrustBadge label="GST Ready" />
                  <TrustBadge label="100% Free" />
                  <TrustBadge label="Open Source" />
                </View>

                {/* Tagline */}
                <Text style={styles.tagline}>Hisaab, pakka.</Text>
              </>
            )}

            {/* ── Mode: Magic Link Sent ───────────────────────────── */}
            {mode === "magic-link-sent" && (
              <View style={styles.sentContainer}>
                <AnimatedEnvelope />

                <Text style={styles.sentTitle}>Check your email</Text>

                <Text style={styles.sentDescription}>
                  We sent a magic sign-in link to
                </Text>
                <Text style={styles.sentEmail}>{email}</Text>

                <ShimmerBar />

                <Text style={styles.sentHint}>
                  The link expires in 15 minutes.{"\n"}Check your spam folder
                  if you don't see it.
                </Text>

                {/* Action buttons */}
                <View style={styles.sentActions}>
                  <TouchableOpacity
                    style={[
                      styles.primaryButton,
                      (cooldown > 0 || sendMagicLink.isPending) &&
                        styles.buttonDisabled,
                    ]}
                    onPress={handleResend}
                    disabled={cooldown > 0 || sendMagicLink.isPending}
                    activeOpacity={0.8}
                  >
                    {sendMagicLink.isPending ? (
                      <ActivityIndicator color={C.textPrimary} size="small" />
                    ) : cooldown > 0 ? (
                      <Text style={styles.primaryButtonText}>
                        Resend in {cooldown}s
                      </Text>
                    ) : (
                      <Text style={styles.primaryButtonText}>
                        Didn't receive it? Send again
                      </Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.ghostButton}
                    onPress={() => switchMode("magic-link")}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.ghostButtonText}>
                      Use a different email
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Dev-mode token input */}
                {__DEV__ && (
                  <DevTokenInput />
                )}
              </View>
            )}

            {/* ── Mode: Password Login ────────────────────────────── */}
            {mode === "password" && (
              <>
                <View style={styles.heroSection}>
                  <Text style={styles.passwordTitle}>Welcome back</Text>
                  <Text style={styles.passwordSubtitle}>
                    Sign in with your email and password.
                  </Text>
                </View>

                {/* Email input */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Email address</Text>
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={(t) => {
                      setEmail(t);
                      setError("");
                    }}
                    placeholder="you@example.com"
                    placeholderTextColor={C.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus
                    returnKeyType="next"
                    onSubmitEditing={() => passwordRef.current?.focus()}
                    editable={!isPending}
                  />
                </View>

                {/* Password input */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Password</Text>
                  <TextInput
                    ref={passwordRef}
                    style={styles.input}
                    value={password}
                    onChangeText={(t) => {
                      setPassword(t);
                      setError("");
                    }}
                    placeholder="Enter your password"
                    placeholderTextColor={C.textMuted}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="go"
                    onSubmitEditing={handlePasswordLogin}
                    editable={!isPending}
                  />
                </View>

                {error ? <ErrorBanner message={error} /> : null}

                {/* Sign in button */}
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    (isPending || !email.includes("@") || !password) &&
                      styles.buttonDisabled,
                  ]}
                  onPress={handlePasswordLogin}
                  disabled={isPending || !email.includes("@") || !password}
                  activeOpacity={0.8}
                >
                  {loginMutation.isPending ? (
                    <ActivityIndicator color={C.textPrimary} size="small" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Sign In</Text>
                  )}
                </TouchableOpacity>

                {/* Or divider */}
                <OrDivider />

                {/* Switch to magic link */}
                <TouchableOpacity
                  style={styles.ghostButton}
                  onPress={() => switchMode("magic-link")}
                  activeOpacity={0.7}
                >
                  <Text style={styles.ghostButtonText}>
                    Use magic link instead
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ─── Styles ─────────────────────────────────────────────────────────────── */
/* ═══════════════════════════════════════════════════════════════════════════ */
const styles = StyleSheet.create({
  /* ── Layout ───────────────────────────────────────────────────── */
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  flex1: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingVertical: 40,
  },
  sessionExpiredBanner: {
    backgroundColor: C.amberBg,
    borderWidth: 1,
    borderColor: C.amberBorder,
    marginHorizontal: 28,
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    zIndex: 10,
  },
  sessionExpiredText: {
    color: C.amber,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },

  /* ── Background mesh ──────────────────────────────────────────── */
  meshBlob1: {
    position: "absolute",
    top: -80,
    right: -60,
    width: SCREEN_WIDTH * 0.8,
    height: SCREEN_WIDTH * 0.8,
    borderRadius: SCREEN_WIDTH * 0.4,
    backgroundColor: "rgba(91, 91, 214, 0.1)",
  },
  meshBlob2: {
    position: "absolute",
    bottom: -40,
    left: -80,
    width: SCREEN_WIDTH * 0.7,
    height: SCREEN_WIDTH * 0.7,
    borderRadius: SCREEN_WIDTH * 0.35,
    backgroundColor: "rgba(251, 191, 36, 0.06)",
  },

  /* ── Brand header ─────────────────────────────────────────────── */
  brandSection: {
    alignItems: "center",
    marginBottom: 32,
  },
  brandName: {
    fontSize: 26,
    fontWeight: "800",
    color: C.textPrimary,
    letterSpacing: -0.8,
    marginTop: 12,
  },

  /* ── Logo icon ────────────────────────────────────────────────── */
  logoContainer: {
    backgroundColor: C.brandLight,
    borderWidth: 1,
    borderColor: "rgba(91, 91, 214, 0.25)",
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
  logoSquare: {},

  /* ── Content area ─────────────────────────────────────────────── */
  contentArea: {
    width: "100%",
  },

  /* ── Hero copy ────────────────────────────────────────────────── */
  heroSection: {
    alignItems: "center",
    marginBottom: 28,
  },
  heroText: {
    fontSize: 28,
    fontWeight: "800",
    color: C.textPrimary,
    textAlign: "center",
    lineHeight: 36,
    letterSpacing: -0.8,
  },
  heroAmber: {
    color: C.amber,
  },

  /* ── Form inputs ──────────────────────────────────────────────── */
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#d1d5db",
    marginBottom: 6,
    letterSpacing: 0.1,
  },
  input: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: C.textPrimary,
  },

  /* ── Error banner ─────────────────────────────────────────────── */
  errorBanner: {
    backgroundColor: C.errorBg,
    borderWidth: 1,
    borderColor: C.errorBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
  },
  errorBannerText: {
    fontSize: 13,
    color: C.error,
    textAlign: "center",
    lineHeight: 18,
  },

  /* ── Primary button ───────────────────────────────────────────── */
  primaryButton: {
    backgroundColor: C.brand,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    minHeight: 52,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: C.textPrimary,
    letterSpacing: -0.1,
  },

  /* ── Helper text ──────────────────────────────────────────────── */
  helperText: {
    fontSize: 12,
    color: C.textMuted,
    textAlign: "center",
    marginTop: 12,
    lineHeight: 18,
  },

  /* ── Or divider ───────────────────────────────────────────────── */
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 20,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.border,
  },
  dividerText: {
    fontSize: 12,
    color: C.textMuted,
    letterSpacing: 0.3,
  },

  /* ── Ghost button ─────────────────────────────────────────────── */
  ghostButton: {
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: "rgba(26, 26, 46, 0.5)",
  },
  ghostButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: C.brand,
  },

  /* ── Trust badges ─────────────────────────────────────────────── */
  trustRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginTop: 28,
  },
  trustBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: C.amberBg,
    borderWidth: 1,
    borderColor: C.amberBorder,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  trustBadgeCheck: {
    fontSize: 10,
    color: C.amber,
    fontWeight: "700",
  },
  trustBadgeText: {
    fontSize: 11,
    color: C.amber,
    fontWeight: "600",
    letterSpacing: 0.1,
  },

  /* ── Tagline ──────────────────────────────────────────────────── */
  tagline: {
    fontSize: 11,
    color: "rgba(255, 255, 255, 0.4)",
    textAlign: "center",
    letterSpacing: 3,
    textTransform: "uppercase",
    marginTop: 20,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },

  /* ── Magic link sent state ────────────────────────────────────── */
  sentContainer: {
    alignItems: "center",
    gap: 12,
  },
  sentActions: {
    width: "100%",
    gap: 12,
    marginTop: 8,
  },
  sentTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: C.textPrimary,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  sentDescription: {
    fontSize: 14,
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  sentEmail: {
    fontSize: 14,
    fontWeight: "700",
    color: C.textPrimary,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginTop: 4,
    marginBottom: 20,
    letterSpacing: -0.3,
  },
  sentHint: {
    fontSize: 12,
    color: C.textMuted,
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 24,
  },

  /* ── Shimmer bar ──────────────────────────────────────────────── */
  shimmerTrack: {
    height: 3,
    backgroundColor: "rgba(45, 45, 68, 0.8)",
    borderRadius: 2,
    overflow: "hidden",
    width: 200,
    alignSelf: "center",
    marginBottom: 20,
  },
  shimmerFill: {
    height: "100%",
    borderRadius: 2,
    overflow: "hidden",
  },

  /* ── Animated envelope ────────────────────────────────────────── */
  envelopeWrapper: {
    width: 80,
    height: 80,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  envelopeRing: {
    position: "absolute",
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: C.brand,
    opacity: 0.2,
  },
  envelopeInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(91, 91, 214, 0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  envelopeEmoji: {
    fontSize: 28,
  },

  /* ── Password mode ────────────────────────────────────────────── */
  passwordTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: C.textPrimary,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  passwordSubtitle: {
    fontSize: 14,
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },

  /* ── Dev-mode token input ──────────────────────────────────────── */
  devContainer: {
    marginTop: 24,
    borderWidth: 1,
    borderColor: C.amberBorder,
    borderStyle: "dashed",
    borderRadius: 12,
    overflow: "hidden",
  },
  devHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  devBadge: {
    backgroundColor: C.amber,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  devBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#0f0f1a",
    letterSpacing: 0.5,
  },
  devHeaderText: {
    fontSize: 13,
    fontWeight: "600",
    color: C.amber,
    flex: 1,
  },
  devChevron: {
    fontSize: 10,
    color: C.amber,
  },
  devBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  devHint: {
    fontSize: 11,
    color: C.textMuted,
    lineHeight: 16,
    marginBottom: 10,
  },
  devInput: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.amberBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 13,
    color: C.textPrimary,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginBottom: 10,
  },
  devErrorBanner: {
    backgroundColor: C.errorBg,
    borderWidth: 1,
    borderColor: C.errorBorder,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  devErrorText: {
    fontSize: 12,
    color: C.error,
    textAlign: "center",
    lineHeight: 16,
  },
  devButton: {
    backgroundColor: C.amber,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  devButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0f0f1a",
    letterSpacing: -0.1,
  },
});
