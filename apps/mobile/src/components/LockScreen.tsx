import { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Dimensions,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useBiometricStore } from "../stores/biometric";
import { colors } from "../lib/theme";
import { haptic } from "../lib/haptics";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

const PIN_LENGTH = 4;

type Mode = "biometric" | "pin";

interface LockScreenProps {
  /**
   * Called after the user successfully authenticates locally (biometric or PIN).
   * The parent is responsible for verifying the server session and calling
   * biometricStore.unlock(). While this runs the lock screen shows a
   * "Verifying..." spinner.
   */
  onUnlock: () => Promise<void>;
  /** Called when the user taps "Sign out" on the lock screen. */
  onSignOut: () => void;
}

export function LockScreen({ onUnlock, onSignOut }: LockScreenProps) {
  const {
    biometricEnabled,
    pinEnabled,
    authenticate,
    verifyPin,
  } = useBiometricStore();

  const [mode, setMode] = useState<Mode>(biometricEnabled ? "biometric" : "pin");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [biometricFailCount, setBiometricFailCount] = useState(0);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  // Entrance animation
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  // Glow pulse animation
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [glowAnim]);

  /**
   * After a successful local authentication (biometric or PIN), show a
   * "Verifying..." state and delegate to the parent's onUnlock which
   * checks the server session.
   */
  const handleUnlockSuccess = useCallback(async () => {
    haptic.success();
    setVerifying(true);
    setError("");
    try {
      await onUnlock();
    } catch {
      // If the parent's onUnlock throws (e.g. session expired), it will
      // have already handled navigation. Reset the verifying state so
      // the lock screen is usable again if it's still mounted.
      setVerifying(false);
    }
  }, [onUnlock]);

  const triggerShake = useCallback(() => {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 4, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  // Auto-trigger biometric on mount / mode change
  useEffect(() => {
    if (mode === "biometric" && !verifying) {
      attemptBiometric();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const attemptBiometric = useCallback(async () => {
    if (verifying) return;
    const success = await authenticate();
    if (success) {
      handleUnlockSuccess();
    } else {
      haptic.error();
      const newCount = biometricFailCount + 1;
      setBiometricFailCount(newCount);
      if (newCount >= 3 && pinEnabled) {
        setMode("pin");
        setError("Too many attempts. Use PIN instead.");
      } else {
        setError("Authentication failed. Tap to try again.");
      }
    }
  }, [authenticate, biometricFailCount, handleUnlockSuccess, pinEnabled, verifying]);

  // Handle PIN digit entry
  const handlePinDigit = useCallback((digit: string) => {
    if (verifying) return;
    haptic.light();
    setError("");
    setPin((prev) => {
      if (prev.length >= PIN_LENGTH) return prev;
      const newPin = prev + digit;
      if (newPin.length === PIN_LENGTH) {
        // Verify after state update
        setTimeout(async () => {
          const valid = await verifyPin(newPin);
          if (valid) {
            handleUnlockSuccess();
          } else {
            haptic.error();
            triggerShake();
            setError("Incorrect PIN");
            setPin("");
          }
        }, 100);
      }
      return newPin;
    });
  }, [handleUnlockSuccess, triggerShake, verifyPin, verifying]);

  const handlePinDelete = useCallback(() => {
    if (verifying) return;
    haptic.light();
    setError("");
    setPin((prev) => prev.slice(0, -1));
  }, [verifying]);

  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.06, 0.15],
  });

  // Verifying state -- shown after successful local auth while token is checked
  if (verifying) {
    return (
      <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
        <Animated.View style={[styles.ambientGlow, { opacity: glowOpacity }]} />
        <View style={styles.content}>
          <LogoIcon size={64} />
          <Text style={styles.brandName}>Hisaabo</Text>
          <ActivityIndicator size="small" color={colors.brand} style={{ marginTop: 24 }} />
          <Text style={styles.verifyingText}>Verifying session...</Text>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      {/* Ambient glow */}
      <Animated.View style={[styles.ambientGlow, { opacity: glowOpacity }]} />

      {mode === "biometric" ? (
        <View style={styles.content}>
          {/* Logo */}
          <LogoIcon size={64} />
          <Text style={styles.brandName}>Hisaabo</Text>

          {/* Fingerprint tap area */}
          <TouchableOpacity
            style={styles.biometricButton}
            onPress={attemptBiometric}
            activeOpacity={0.7}
          >
            <Ionicons
              name={Platform.OS === "ios" ? "finger-print" : "finger-print"}
              size={48}
              color={colors.brand}
            />
          </TouchableOpacity>
          <Text style={styles.tapHint}>Tap to unlock</Text>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {/* Fallback to PIN */}
          {pinEnabled && (
            <>
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>
              <TouchableOpacity onPress={() => { setMode("pin"); setError(""); }} activeOpacity={0.7}>
                <Text style={styles.switchModeText}>Use PIN instead</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      ) : (
        <Animated.View style={[styles.content, { transform: [{ translateX: shakeAnim }] }]}>
          <Text style={styles.pinTitle}>Enter your PIN</Text>

          {/* Dot indicators */}
          <View style={styles.dotRow}>
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i < pin.length ? styles.dotFilled : styles.dotEmpty,
                ]}
              />
            ))}
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {/* Number pad */}
          <View style={styles.numPad}>
            {[
              ["1", "2", "3"],
              ["4", "5", "6"],
              ["7", "8", "9"],
              ["", "0", "del"],
            ].map((row, rowIndex) => (
              <View key={rowIndex} style={styles.numRow}>
                {row.map((key) => {
                  if (key === "") {
                    return <View key="empty" style={styles.numKeyEmpty} />;
                  }
                  if (key === "del") {
                    return (
                      <TouchableOpacity
                        key="del"
                        style={styles.numKey}
                        onPress={handlePinDelete}
                        activeOpacity={0.6}
                      >
                        <Ionicons name="backspace-outline" size={24} color={colors.textSecondary} />
                      </TouchableOpacity>
                    );
                  }
                  return (
                    <TouchableOpacity
                      key={key}
                      style={styles.numKey}
                      onPress={() => handlePinDigit(key)}
                      activeOpacity={0.6}
                    >
                      <Text style={styles.numKeyText}>{key}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>

          {/* Switch to biometric */}
          {biometricEnabled && (
            <TouchableOpacity
              style={styles.switchRow}
              onPress={() => {
                setMode("biometric");
                setError("");
                setPin("");
                setBiometricFailCount(0);
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="finger-print" size={18} color={colors.brand} />
              <Text style={styles.switchModeText}>Use fingerprint</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      )}

      {/* Sign out link — always visible at the bottom */}
      <TouchableOpacity style={styles.signOutButton} onPress={onSignOut} activeOpacity={0.7}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

/* -- Mini Logo Icon (reused from splash pattern) ------------ */

function LogoIcon({ size = 64 }: { size?: number }) {
  const squareSize = (size - 12) / 2 - 2;
  const r = squareSize * 0.22;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.27,
        backgroundColor: "rgba(99, 102, 241, 0.15)",
        borderWidth: 1,
        borderColor: "rgba(99, 102, 241, 0.25)",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          width: squareSize * 2 + 4,
          height: squareSize * 2 + 4,
          gap: 3,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View style={{ width: squareSize, height: squareSize, borderRadius: r, backgroundColor: "rgba(255,255,255,0.9)" }} />
        <View style={{ width: squareSize, height: squareSize, borderRadius: r, backgroundColor: "rgba(255,255,255,0.7)" }} />
        <View style={{ width: squareSize, height: squareSize, borderRadius: r, backgroundColor: "rgba(255,255,255,0.6)" }} />
        <View style={{ width: squareSize, height: squareSize, borderRadius: r, backgroundColor: "#fbbf24", opacity: 0.9 }} />
      </View>
    </View>
  );
}

/* -- Styles ------------------------------------------------- */

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    zIndex: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  ambientGlow: {
    position: "absolute",
    width: SCREEN_WIDTH * 0.8,
    height: SCREEN_WIDTH * 0.8,
    borderRadius: SCREEN_WIDTH * 0.4,
    backgroundColor: colors.brand,
    top: SCREEN_HEIGHT * 0.1,
  },
  content: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  brandName: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textPrimary,
    letterSpacing: -0.5,
    marginTop: 16,
    marginBottom: 40,
  },
  biometricButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.brandLight,
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.3)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  tapHint: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 8,
  },
  verifyingText: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 12,
  },
  errorText: {
    fontSize: 13,
    color: colors.danger,
    marginTop: 12,
    textAlign: "center",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 32,
    marginBottom: 16,
  },
  dividerLine: {
    width: 40,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  switchModeText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.brand,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 24,
  },

  // Sign out
  signOutButton: {
    position: "absolute",
    bottom: 48,
  },
  signOutText: {
    fontSize: 13,
    color: colors.textMuted,
  },

  // PIN mode
  pinTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 24,
  },
  dotRow: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 16,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  dotFilled: {
    backgroundColor: colors.brand,
  },
  dotEmpty: {
    backgroundColor: "transparent",
    borderWidth: 2,
    borderColor: colors.border,
  },

  // Number pad
  numPad: {
    marginTop: 24,
    gap: 12,
  },
  numRow: {
    flexDirection: "row",
    gap: 20,
    justifyContent: "center",
  },
  numKey: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  numKeyEmpty: {
    width: 64,
    height: 64,
  },
  numKeyText: {
    fontSize: 24,
    fontWeight: "600",
    color: colors.textPrimary,
  },
});
