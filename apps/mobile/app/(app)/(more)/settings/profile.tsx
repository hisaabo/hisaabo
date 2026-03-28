import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState, useEffect } from "react";
import { trpc } from "../../../../src/lib/trpc";
import { useAuthStore } from "../../../../src/stores/auth";
import { useBusinessStore } from "../../../../src/stores/business";
import { colors } from "../../../../src/lib/theme";
import { QueryError, Skeleton, Card } from "../../../../src/components/ui";

export default function ProfileScreen() {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const clearBusiness = useBusinessStore((s) => s.clearBusiness);

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

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await logout();
      clearBusiness();
      router.replace("/(auth)/login");
    },
    onError: async () => {
      await logout();
      clearBusiness();
      router.replace("/(auth)/login");
    },
  });

  const logoutAllMutation = trpc.auth.logoutAll.useMutation({
    onSuccess: async () => {
      await logout();
      clearBusiness();
      router.replace("/(auth)/login");
    },
    onError: async () => {
      await logout();
      clearBusiness();
      router.replace("/(auth)/login");
    },
  });

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: () => logoutMutation.mutate(),
      },
    ]);
  };

  const handleLogoutAll = () => {
    Alert.alert(
      "Sign Out All Devices",
      "This will sign you out from all devices. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign Out All",
          style: "destructive",
          onPress: () => logoutAllMutation.mutate(),
        },
      ]
    );
  };

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

  const isBusy = logoutMutation.isPending || logoutAllMutation.isPending;

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

        {/* Danger Zone */}
        <Text style={styles.sectionLabel}>Session</Text>
        <View style={styles.dangerList}>
          <TouchableOpacity
            style={styles.dangerRow}
            onPress={handleLogout}
            disabled={isBusy}
            activeOpacity={0.7}
          >
            <View style={styles.dangerIconWrap}>
              <Ionicons name="log-out-outline" size={20} color={colors.danger} />
            </View>
            <View style={styles.dangerText}>
              <Text style={styles.dangerLabel}>Sign Out</Text>
              <Text style={styles.dangerDesc}>End your current session</Text>
            </View>
            {logoutMutation.isPending ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <Ionicons name="chevron-forward" size={16} color={colors.danger} />
            )}
          </TouchableOpacity>
          <View style={styles.dangerDivider} />
          <TouchableOpacity
            style={styles.dangerRow}
            onPress={handleLogoutAll}
            disabled={isBusy}
            activeOpacity={0.7}
          >
            <View style={styles.dangerIconWrap}>
              <Ionicons name="phone-portrait-outline" size={20} color={colors.danger} />
            </View>
            <View style={styles.dangerText}>
              <Text style={styles.dangerLabel}>Sign Out All Devices</Text>
              <Text style={styles.dangerDesc}>End sessions on all devices</Text>
            </View>
            {logoutAllMutation.isPending ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <Ionicons name="chevron-forward" size={16} color={colors.danger} />
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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

  // Danger zone
  dangerList: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    marginBottom: 24,
  },
  dangerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 16,
    gap: 14,
  },
  dangerDivider: {
    height: 1,
    backgroundColor: colors.border,
  },
  dangerIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.dangerBg,
    alignItems: "center",
    justifyContent: "center",
  },
  dangerText: { flex: 1 },
  dangerLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.danger,
  },
  dangerDesc: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
});
