import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { trpc } from "../../../../src/lib/trpc";
import { useAuthStore } from "../../../../src/stores/auth";
import { makeStyles } from "../../../../src/lib/makeStyles";
import { useColors } from "../../../../src/contexts/ThemeContext";
import { PressableRow } from "../../../../src/components/ui";
import { OrgSwitcherSheet } from "../../../../src/components/OrgSwitcherSheet";
import { queryClient } from "../../../../src/lib/query-client";

interface SettingItem {
  label: string;
  icon: string;
  description: string;
  danger?: boolean;
  route?: string;
}

const SETTINGS: SettingItem[] = [
  { label: "Business Details", icon: "business-outline", description: "Name, GST, address", route: "/(more)/settings/business" },
  { label: "Documents", icon: "document-text-outline", description: "Prefixes and sequence numbers", route: "/(more)/settings/documents" },
  { label: "Team", icon: "people-outline", description: "Members and roles", route: "/(more)/settings/team" },
  { label: "Online Store", icon: "storefront-outline", description: "Store settings and items", route: "/(more)/settings/store" },
  { label: "Appearance", icon: "color-palette-outline", description: "Light, dark, or system", route: "/(more)/settings/appearance" },
  { label: "Profile", icon: "person-outline", description: "Name, email, password", route: "/(more)/settings/profile" },
  { label: "Account", icon: "shield-checkmark-outline", description: "Sessions and activity log", route: "/(more)/settings/account" },
  { label: "API Keys", icon: "key-outline", description: "Programmatic access tokens", route: "/(more)/settings/api-keys" },
  { label: "Sign Out", icon: "log-out-outline", description: "End your session", danger: true },
];

export default function SettingsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const utils = trpc.useUtils();
  const [showOrgSwitcher, setShowOrgSwitcher] = useState(false);

  const { data: session } = trpc.auth.me.useQuery();
  const { data: tenantList } = trpc.tenant.list.useQuery(undefined, { enabled: !!session?.user });
  const { data: canCreateOrg } = trpc.tenant.canCreateOrg.useQuery(undefined, { enabled: !!session?.user });

  const selectTenantMutation = trpc.tenant.select.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      queryClient.invalidateQueries();
      setShowOrgSwitcher(false);
    },
  });

  const createOrgMutation = trpc.tenant.create.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      utils.tenant.list.invalidate();
      queryClient.invalidateQueries();
      setShowOrgSwitcher(false);
    },
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await logout();
      router.replace("/(auth)/login");
    },
    onError: async () => {
      // Even if API logout fails, clear local state
      await logout();
      router.replace("/(auth)/login");
    },
  });

  const handleItemPress = (item: SettingItem) => {
    if (item.danger) {
      Alert.alert(
        "Sign Out",
        "Are you sure you want to sign out?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Sign Out",
            style: "destructive",
            onPress: () => logoutMutation.mutate(),
          },
        ]
      );
      return;
    }
    if (item.route) {
      router.push(item.route as any);
      return;
    }
    Alert.alert(item.label, "This setting is coming soon");
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Organization */}
        {tenantList && tenantList.length > 0 && (
          <TouchableOpacity
            style={styles.orgCard}
            onPress={() => setShowOrgSwitcher(true)}
            activeOpacity={0.7}
          >
            <View style={styles.orgAvatar}>
              <Text style={styles.orgAvatarText}>
                {(session?.tenantName ?? "O").charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.orgName} numberOfLines={1}>{session?.tenantName ?? "Organization"}</Text>
              <Text style={styles.orgLabel}>Organization</Text>
            </View>
            <Ionicons name="chevron-expand-outline" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}

        {/* Settings List */}
        <View style={styles.settingsList}>
          {SETTINGS.map((item, index) => {
            const isLast = index === SETTINGS.length - 1;
            const isSignOut = item.danger;
            return (
              <PressableRow
                key={item.label}
                style={[
                  styles.settingRow,
                  !isLast && styles.settingRowBorder,
                ]}
                onPress={() => handleItemPress(item)}
                disabled={logoutMutation.isPending && isSignOut}
              >
                <View style={[
                  styles.settingIconWrapper,
                  { backgroundColor: isSignOut ? "rgba(239,68,68,0.12)" : colors.brandLight },
                ]}>
                  <Ionicons
                    name={item.icon as any}
                    size={20}
                    color={isSignOut ? colors.danger : colors.brand}
                  />
                </View>
                <View style={styles.settingText}>
                  <Text style={[styles.settingLabel, isSignOut && styles.settingLabelDanger]}>
                    {item.label}
                  </Text>
                  <Text style={styles.settingDescription}>{item.description}</Text>
                </View>
                {logoutMutation.isPending && isSignOut ? (
                  <ActivityIndicator color={colors.danger} size="small" />
                ) : (
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={isSignOut ? colors.danger : colors.textMuted}
                  />
                )}
              </PressableRow>
            );
          })}
        </View>

        {/* Footer */}
        <Text style={styles.footer}>Hisaabo v{Constants.expoConfig?.version ?? "0.4.0"}</Text>
      </ScrollView>

      {/* Org Switcher Sheet */}
      <OrgSwitcherSheet
        visible={showOrgSwitcher}
        onClose={() => setShowOrgSwitcher(false)}
        orgs={tenantList ?? []}
        activeTenantId={session?.tenantId ?? null}
        onSwitch={(tenantId) => selectTenantMutation.mutate({ tenantId })}
        canCreateOrg={canCreateOrg ?? false}
        onCreateNew={() => createOrgMutation.mutate()}
        isCreating={createOrgMutation.isPending}
      />
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

  // Settings List
  settingsList: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 16,
    gap: 14,
  },
  settingRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  settingRowDanger: {},
  settingIconWrapper: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  settingText: { flex: 1 },
  settingLabel: { fontSize: 15, fontWeight: "600", color: colors.textPrimary },
  settingLabelDanger: { color: colors.danger },
  settingDescription: { fontSize: 12, color: colors.textMuted, marginTop: 2 },

  // Org card
  orgCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
  },
  orgAvatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  orgAvatarText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
  orgName: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  orgLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },

  footer: {
    textAlign: "center",
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 32,
  },
}));
