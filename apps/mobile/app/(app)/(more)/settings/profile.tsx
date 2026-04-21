import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  Switch,
  Modal,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState, useEffect, useCallback } from "react";
import * as LocalAuthentication from "expo-local-authentication";
import { trpc } from "../../../../src/lib/trpc";
import { useBiometricStore } from "../../../../src/stores/biometric";
import { makeStyles } from "../../../../src/lib/makeStyles";
import { useColors } from "../../../../src/contexts/ThemeContext";
import { haptic } from "../../../../src/lib/haptics";
import { QueryError, Skeleton, Card } from "../../../../src/components/ui";

const PIN_LENGTH = 4;

export default function ProfileScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();

  // Biometric / security state
  const biometricEnabled = useBiometricStore((s) => s.biometricEnabled);
  const pinEnabled = useBiometricStore((s) => s.pinEnabled);
  const enableBiometric = useBiometricStore((s) => s.enableBiometric);
  const disableBiometric = useBiometricStore((s) => s.disableBiometric);
  const setStorePin = useBiometricStore((s) => s.setPin);
  const clearStorePin = useBiometricStore((s) => s.clearPin);
  const checkHardware = useBiometricStore((s) => s.checkHardware);

  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState("Fingerprint / Face ID");

  // PIN modal state
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinStep, setPinStep] = useState<"create" | "confirm">("create");
  const [newPinValue, setNewPinValue] = useState("");
  const [confirmPinValue, setConfirmPinValue] = useState("");
  const [pinError, setPinError] = useState("");

  useEffect(() => {
    checkHardware().then(({ available, types }) => {
      setBiometricAvailable(available);
      if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        setBiometricLabel("Face ID");
      } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        setBiometricLabel("Fingerprint");
      }
    });
  }, [checkHardware]);

  const handleToggleBiometric = useCallback(async (value: boolean) => {
    if (value) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Verify to enable biometric unlock",
        cancelLabel: "Cancel",
        disableDeviceFallback: true,
      });
      if (result.success) {
        await enableBiometric();
        haptic.success();
      } else {
        haptic.error();
      }
    } else {
      await disableBiometric();
      haptic.light();
    }
  }, [enableBiometric, disableBiometric]);

  const handleChangePin = useCallback(() => {
    setPinStep("create");
    setNewPinValue("");
    setConfirmPinValue("");
    setPinError("");
    setPinModalVisible(true);
  }, []);

  const handleRemovePin = useCallback(() => {
    Alert.alert(
      "Remove PIN",
      "Are you sure you want to remove your PIN lock?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await clearStorePin();
            haptic.success();
          },
        },
      ]
    );
  }, [clearStorePin]);

  const handlePinDigit = useCallback((digit: string) => {
    haptic.light();
    setPinError("");
    if (pinStep === "create") {
      setNewPinValue((prev) => {
        if (prev.length >= PIN_LENGTH) return prev;
        const next = prev + digit;
        if (next.length === PIN_LENGTH) {
          setTimeout(() => {
            setPinStep("confirm");
            setConfirmPinValue("");
          }, 200);
        }
        return next;
      });
    } else {
      setConfirmPinValue((prev) => {
        if (prev.length >= PIN_LENGTH) return prev;
        const next = prev + digit;
        if (next.length === PIN_LENGTH) {
          setTimeout(async () => {
            if (next === newPinValue) {
              await setStorePin(next);
              haptic.success();
              setPinModalVisible(false);
            } else {
              haptic.error();
              setPinError("PINs do not match. Try again.");
              setConfirmPinValue("");
              setPinStep("create");
              setNewPinValue("");
            }
          }, 200);
        }
        return next;
      });
    }
  }, [pinStep, newPinValue, setStorePin]);

  const handlePinDelete = useCallback(() => {
    haptic.light();
    setPinError("");
    if (pinStep === "create") {
      setNewPinValue((prev) => prev.slice(0, -1));
    } else {
      setConfirmPinValue((prev) => prev.slice(0, -1));
    }
  }, [pinStep]);

  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState("");
  const [editingEmail, setEditingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState("");

  const utils = trpc.useUtils();

  const { data: meData, isLoading, isError, refetch } = trpc.auth.me.useQuery(undefined);

  useEffect(() => {
    if (meData?.user?.name) {
      setName(meData.user.name);
    }
  }, [meData?.user?.name]);

  const updateNameMutation = trpc.auth.updateName.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      setEditingName(false);
      Alert.alert("Saved", "Your name has been updated.");
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to update name.");
    },
  });

  const requestEmailChangeMutation = trpc.auth.requestEmailChange.useMutation({
    onSuccess: () => {
      setEditingEmail(false);
      setNewEmail("");
      Alert.alert(
        "Email change requested",
        "Check your new email address for a confirmation link."
      );
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to request email change.");
    },
  });

  const handleSaveName = () => {
    if (!name.trim() || name.trim().length < 2) {
      Alert.alert("Validation", "Name must be at least 2 characters.");
      return;
    }
    updateNameMutation.mutate({ name: name.trim() });
  };

  const handleRequestEmailChange = () => {
    if (!newEmail.trim()) {
      Alert.alert("Validation", "New email is required.");
      return;
    }
    requestEmailChangeMutation.mutate({ newEmail: newEmail.trim().toLowerCase() });
  };

  const user = meData?.user;

  if (isError) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Profile</Text>
          <View style={{ width: 40 }} />
        </View>
        <QueryError message="Failed to load profile" onRetry={refetch} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {isLoading ? (
          <Skeleton width="100%" height={100} borderRadius={16} style={{ marginBottom: 24 }} />
        ) : (
          // Avatar + basic info
          <View style={styles.profileCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(user?.name ?? user?.email ?? "?").charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{user?.name ?? "No name set"}</Text>
              <Text style={styles.profileEmail}>{user?.email ?? ""}</Text>
              {meData?.role && (
                <View style={styles.roleBadge}>
                  <Text style={styles.roleBadgeText}>
                    {meData.role.charAt(0).toUpperCase() + meData.role.slice(1)}
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Edit Name */}
        <Text style={styles.sectionLabel}>Edit Name</Text>
        <Card style={styles.editCard}>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Your full name"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="words"
            onFocus={() => setEditingName(true)}
          />
          {editingName && (
            <TouchableOpacity
              style={[styles.actionBtn, updateNameMutation.isPending && { opacity: 0.6 }]}
              onPress={handleSaveName}
              disabled={updateNameMutation.isPending}
              activeOpacity={0.8}
            >
              {updateNameMutation.isPending ? (
                <ActivityIndicator color={colors.textPrimary} size="small" />
              ) : (
                <Text style={styles.actionBtnText}>Update Name</Text>
              )}
            </TouchableOpacity>
          )}
        </Card>

        {/* Change Email */}
        <Text style={styles.sectionLabel}>Change Email</Text>
        <Card style={styles.editCard}>
          {!editingEmail ? (
            <TouchableOpacity
              style={styles.changeEmailTrigger}
              onPress={() => setEditingEmail(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.changeEmailTriggerText}>
                Request email change
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ) : (
            <>
              <Text style={styles.changeEmailNote}>
                Current: {user?.email ?? ""}
              </Text>
              <TextInput
                style={styles.input}
                value={newEmail}
                onChangeText={setNewEmail}
                placeholder="new@email.com"
                placeholderTextColor={colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={styles.row}>
                <TouchableOpacity
                  style={[styles.actionBtnSecondary]}
                  onPress={() => {
                    setEditingEmail(false);
                    setNewEmail("");
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.actionBtnSecondaryText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, { flex: 2 }, requestEmailChangeMutation.isPending && { opacity: 0.6 }]}
                  onPress={handleRequestEmailChange}
                  disabled={requestEmailChangeMutation.isPending}
                  activeOpacity={0.8}
                >
                  {requestEmailChangeMutation.isPending ? (
                    <ActivityIndicator color={colors.textPrimary} size="small" />
                  ) : (
                    <Text style={styles.actionBtnText}>Send Verification</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </Card>

        {/* Security */}
        <Text style={styles.sectionLabel}>Security</Text>
        <View style={styles.securityList}>
          {/* Biometric toggle */}
          {biometricAvailable && (
            <>
              <View style={styles.securityRow}>
                <View style={styles.securityIconWrap}>
                  <Ionicons name="finger-print" size={20} color={colors.brand} />
                </View>
                <View style={styles.securityText}>
                  <Text style={styles.securityLabel}>{biometricLabel}</Text>
                  <Text style={styles.securityDesc}>Unlock with biometrics</Text>
                </View>
                <Switch
                  value={biometricEnabled}
                  onValueChange={handleToggleBiometric}
                  trackColor={{ false: colors.border, true: "rgba(99,102,241,0.5)" }}
                  thumbColor={biometricEnabled ? colors.brand : colors.textMuted}
                />
              </View>
              <View style={styles.securityDivider} />
            </>
          )}

          {/* Change / Set PIN */}
          <TouchableOpacity
            style={styles.securityRow}
            onPress={handleChangePin}
            activeOpacity={0.7}
          >
            <View style={styles.securityIconWrap}>
              <Ionicons name="keypad-outline" size={20} color={colors.brand} />
            </View>
            <View style={styles.securityText}>
              <Text style={styles.securityLabel}>{pinEnabled ? "Change PIN" : "Set up PIN"}</Text>
              <Text style={styles.securityDesc}>
                {pinEnabled ? "Update your 4-digit PIN" : "Add a 4-digit PIN lock"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>

          {/* Remove PIN (only shown if PIN is set) */}
          {pinEnabled && (
            <>
              <View style={styles.securityDivider} />
              <TouchableOpacity
                style={styles.securityRow}
                onPress={handleRemovePin}
                activeOpacity={0.7}
              >
                <View style={[styles.securityIconWrap, { backgroundColor: colors.dangerBg }]}>
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                </View>
                <View style={styles.securityText}>
                  <Text style={[styles.securityLabel, { color: colors.danger }]}>Remove PIN</Text>
                  <Text style={styles.securityDesc}>Remove PIN lock from app</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.danger} />
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* PIN Creation Modal */}
        <Modal visible={pinModalVisible} transparent animationType="slide" statusBarTranslucent>
          <View style={styles.pinModalOverlay}>
            <View style={styles.pinModalSheet}>
              <View style={styles.pinModalHandle} />
              <Text style={styles.pinModalTitle}>
                {pinStep === "create" ? "Create a 4-digit PIN" : "Confirm your PIN"}
              </Text>

              <View style={styles.pinDotRow}>
                {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.pinDot,
                      i < (pinStep === "create" ? newPinValue : confirmPinValue).length
                        ? styles.pinDotFilled
                        : styles.pinDotEmpty,
                    ]}
                  />
                ))}
              </View>

              {pinError ? <Text style={styles.pinErrorText}>{pinError}</Text> : null}

              <View style={styles.pinNumPad}>
                {[
                  ["1", "2", "3"],
                  ["4", "5", "6"],
                  ["7", "8", "9"],
                  ["", "0", "del"],
                ].map((row, rowIndex) => (
                  <View key={rowIndex} style={styles.pinNumRow}>
                    {row.map((key) => {
                      if (key === "") {
                        return <View key="empty" style={styles.pinNumKeyEmpty} />;
                      }
                      if (key === "del") {
                        return (
                          <TouchableOpacity
                            key="del"
                            style={styles.pinNumKey}
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
                          style={styles.pinNumKey}
                          onPress={() => handlePinDigit(key)}
                          activeOpacity={0.6}
                        >
                          <Text style={styles.pinNumKeyText}>{key}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
              </View>

              <TouchableOpacity
                style={styles.pinCancelBtn}
                onPress={() => setPinModalVisible(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.pinCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
  content: { padding: 16, paddingBottom: 48 },

  // Profile card
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    marginBottom: 24,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(99,102,241,0.4)",
  },
  avatarText: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.brand,
  },
  profileInfo: { flex: 1 },
  profileName: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 4,
  },
  profileEmail: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 6,
  },
  roleBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.brandLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(99,102,241,0.3)",
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.brand,
  },

  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 4,
  },
  editCard: {
    marginBottom: 20,
    gap: 12,
  },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 14,
  },
  row: { flexDirection: "row", gap: 10 },
  actionBtn: {
    backgroundColor: colors.brand,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    flex: 1,
  },
  actionBtnText: {
    color: colors.textPrimary,
    fontWeight: "700",
    fontSize: 14,
  },
  actionBtnSecondary: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  actionBtnSecondaryText: {
    color: colors.textSecondary,
    fontWeight: "600",
    fontSize: 14,
  },
  changeEmailTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  changeEmailTriggerText: {
    fontSize: 14,
    color: colors.brand,
    fontWeight: "600",
  },
  changeEmailNote: {
    fontSize: 12,
    color: colors.textMuted,
  },

  // Security section
  securityList: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    marginBottom: 20,
  },
  securityRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 16,
    gap: 14,
  },
  securityDivider: {
    height: 1,
    backgroundColor: colors.border,
  },
  securityIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  securityText: { flex: 1 },
  securityLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  securityDesc: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },

  // PIN modal
  pinModalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  pinModalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
    paddingTop: 12,
    alignItems: "center",
  },
  pinModalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 24,
  },
  pinModalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 20,
  },
  pinDotRow: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 8,
  },
  pinDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  pinDotFilled: {
    backgroundColor: colors.brand,
  },
  pinDotEmpty: {
    backgroundColor: "transparent",
    borderWidth: 2,
    borderColor: colors.border,
  },
  pinErrorText: {
    fontSize: 13,
    color: colors.danger,
    marginTop: 8,
    textAlign: "center",
  },
  pinNumPad: {
    marginTop: 16,
    gap: 10,
  },
  pinNumRow: {
    flexDirection: "row",
    gap: 18,
    justifyContent: "center",
  },
  pinNumKey: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  pinNumKeyEmpty: {
    width: 60,
    height: 60,
  },
  pinNumKeyText: {
    fontSize: 22,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  pinCancelBtn: {
    paddingVertical: 12,
    marginTop: 8,
  },
  pinCancelText: {
    fontSize: 14,
    color: colors.textMuted,
    fontWeight: "500",
  },

}));
