import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Easing,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useBiometricStore } from "../stores/biometric";
import { colors } from "../lib/theme";
import { haptic } from "../lib/haptics";
import * as LocalAuthentication from "expo-local-authentication";

const PIN_LENGTH = 4;

type Step = "prompt" | "create-pin" | "confirm-pin" | "done";

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

export function BiometricSetupPrompt({ visible, onDismiss }: Props) {
  const {
    enableBiometric,
    setPin,
    markSetupPrompted,
    checkHardware,
  } = useBiometricStore();

  const [step, setStep] = useState<Step>("prompt");
  const [hardwareAvailable, setHardwareAvailable] = useState(false);
  const [biometricType, setBiometricType] = useState<string>("Fingerprint");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [slideAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (visible) {
      checkHardware().then(({ available, types }) => {
        setHardwareAvailable(available);
        const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
        const hasFingerprint = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
        if (hasFace) {
          setBiometricType(Platform.OS === "ios" ? "Face ID" : "Face Unlock");
        } else if (hasFingerprint) {
          setBiometricType(Platform.OS === "ios" ? "Touch ID" : "Fingerprint");
        } else {
          setBiometricType("Biometric");
        }
      });
      Animated.spring(slideAnim, {
        toValue: 1,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, checkHardware, slideAnim]);

  const handleDismiss = useCallback(async () => {
    await markSetupPrompted();
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start(() => {
      onDismiss();
    });
  }, [markSetupPrompted, onDismiss, slideAnim]);

  const handleEnableBiometric = useCallback(async () => {
    haptic.light();
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Verify to enable biometric unlock",
        cancelLabel: "Cancel",
        disableDeviceFallback: true,
      });

      if (result.success) {
        await enableBiometric();
        haptic.success();
        // Ask if they also want a PIN backup
        Alert.alert(
          "Backup PIN",
          "Set a 4-digit PIN as backup in case biometric fails?",
          [
            {
              text: "Skip",
              style: "cancel",
              onPress: () => handleDismiss(),
            },
            {
              text: "Set PIN",
              onPress: () => setStep("create-pin"),
            },
          ]
        );
      } else {
        haptic.error();
        setError("Biometric verification failed. Try again.");
      }
    } catch {
      haptic.error();
      setError("Biometric verification failed.");
    }
  }, [enableBiometric, handleDismiss]);

  const handleSetupPin = useCallback(() => {
    haptic.light();
    setStep("create-pin");
    setNewPin("");
    setConfirmPin("");
    setError("");
  }, []);

  const handlePinDigit = useCallback((digit: string) => {
    haptic.light();
    setError("");
    if (step === "create-pin") {
      setNewPin((prev) => {
        if (prev.length >= PIN_LENGTH) return prev;
        const next = prev + digit;
        if (next.length === PIN_LENGTH) {
          setTimeout(() => setStep("confirm-pin"), 200);
        }
        return next;
      });
    } else if (step === "confirm-pin") {
      setConfirmPin((prev) => {
        if (prev.length >= PIN_LENGTH) return prev;
        const next = prev + digit;
        if (next.length === PIN_LENGTH) {
          // Verify match
          setTimeout(async () => {
            if (next === newPin) {
              await setPin(next);
              haptic.success();
              handleDismiss();
            } else {
              haptic.error();
              setError("PINs do not match. Try again.");
              setConfirmPin("");
              setStep("create-pin");
              setNewPin("");
            }
          }, 200);
        }
        return next;
      });
    }
  }, [step, newPin, setPin, handleDismiss]);

  const handlePinDelete = useCallback(() => {
    haptic.light();
    setError("");
    if (step === "create-pin") {
      setNewPin((prev) => prev.slice(0, -1));
    } else if (step === "confirm-pin") {
      setConfirmPin((prev) => prev.slice(0, -1));
    }
  }, [step]);

  const currentPin = step === "create-pin" ? newPin : confirmPin;
  const pinLabel = step === "create-pin" ? "Create a 4-digit PIN" : "Confirm your PIN";

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [400, 0],
  });

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="none" statusBarTranslucent>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleDismiss} />
        <Animated.View
          style={[
            styles.sheet,
            { transform: [{ translateY }] },
          ]}
        >
          {step === "prompt" ? (
            <>
              <View style={styles.handle} />
              <View style={styles.iconRow}>
                <View style={styles.lockIcon}>
                  <Ionicons name="lock-closed" size={28} color={colors.brand} />
                </View>
              </View>
              <Text style={styles.sheetTitle}>Secure your app</Text>
              <Text style={styles.sheetDesc}>
                {hardwareAvailable
                  ? `Would you like to use ${biometricType.toLowerCase()} to quickly unlock Hisaabo?`
                  : "Set up a PIN to quickly unlock Hisaabo."}
              </Text>

              {hardwareAvailable && (
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={handleEnableBiometric}
                  activeOpacity={0.8}
                >
                  <Ionicons name="finger-print" size={20} color={colors.textPrimary} />
                  <Text style={styles.primaryBtnText}>Enable {biometricType}</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={hardwareAvailable ? styles.secondaryBtn : styles.primaryBtn}
                onPress={handleSetupPin}
                activeOpacity={0.7}
              >
                <Ionicons name="keypad-outline" size={18} color={hardwareAvailable ? colors.brand : colors.textPrimary} />
                <Text style={hardwareAvailable ? styles.secondaryBtnText : styles.primaryBtnText}>
                  {hardwareAvailable ? "Set up PIN instead" : "Set up PIN"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.skipBtn}
                onPress={handleDismiss}
                activeOpacity={0.7}
              >
                <Text style={styles.skipBtnText}>Skip for now</Text>
              </TouchableOpacity>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </>
          ) : (
            <>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>{pinLabel}</Text>

              {/* Dot indicators */}
              <View style={styles.dotRow}>
                {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.dot,
                      i < currentPin.length ? styles.dotFilled : styles.dotEmpty,
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
                            <Ionicons name="backspace-outline" size={22} color={colors.textSecondary} />
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

              <TouchableOpacity
                style={styles.skipBtn}
                onPress={handleDismiss}
                activeOpacity={0.7}
              >
                <Text style={styles.skipBtnText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
    paddingTop: 12,
    alignItems: "center",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 24,
  },
  iconRow: {
    marginBottom: 16,
  },
  lockIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
    textAlign: "center",
    marginBottom: 8,
  },
  sheetDesc: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
    paddingHorizontal: 16,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: colors.brand,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 24,
    width: "100%",
    marginBottom: 12,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: colors.brandLight,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.3)",
    paddingVertical: 14,
    paddingHorizontal: 24,
    width: "100%",
    marginBottom: 12,
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.brand,
  },
  skipBtn: {
    paddingVertical: 12,
    marginTop: 4,
  },
  skipBtnText: {
    fontSize: 14,
    color: colors.textMuted,
    fontWeight: "500",
  },
  errorText: {
    fontSize: 13,
    color: colors.danger,
    marginTop: 8,
    textAlign: "center",
  },

  // PIN entry in sheet
  dotRow: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 8,
    marginTop: 8,
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
  numPad: {
    marginTop: 16,
    gap: 10,
  },
  numRow: {
    flexDirection: "row",
    gap: 18,
    justifyContent: "center",
  },
  numKey: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  numKeyEmpty: {
    width: 60,
    height: 60,
  },
  numKeyText: {
    fontSize: 22,
    fontWeight: "600",
    color: colors.textPrimary,
  },
});
