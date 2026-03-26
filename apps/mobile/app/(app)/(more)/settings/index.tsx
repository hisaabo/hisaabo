import {
  View,
  Text,
  SafeAreaView,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";
import { useAuthStore } from "../../../../src/stores/auth";

interface SettingItem {
  label: string;
  icon: string;
  description: string;
  danger?: boolean;
}

const SETTINGS: SettingItem[] = [
  { label: "Business Details", icon: "business-outline", description: "Name, GST, address" },
  { label: "Team", icon: "people-outline", description: "Members and roles" },
  { label: "Online Store", icon: "storefront-outline", description: "Store settings" },
  { label: "Profile", icon: "person-outline", description: "Name, email, password" },
  { label: "Sign Out", icon: "log-out-outline", description: "End your session", danger: true },
];

export default function SettingsScreen() {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);

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
    Alert.alert(item.label, "This setting is coming soon");
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* App Info */}
        <View style={styles.appInfoCard}>
          <View style={styles.appIconWrapper}>
            <Ionicons name="calculator-outline" size={32} color="#6366f1" />
          </View>
          <View>
            <Text style={styles.appName}>Hisaabo</Text>
            <Text style={styles.appVersion}>Business Management</Text>
          </View>
        </View>

        {/* Settings List */}
        <View style={styles.settingsList}>
          {SETTINGS.map((item, index) => {
            const isLast = index === SETTINGS.length - 1;
            const isSignOut = item.danger;
            return (
              <TouchableOpacity
                key={item.label}
                style={[
                  styles.settingRow,
                  !isLast && styles.settingRowBorder,
                  isSignOut && styles.settingRowDanger,
                ]}
                onPress={() => handleItemPress(item)}
                activeOpacity={0.7}
                disabled={logoutMutation.isPending && isSignOut}
              >
                <View style={[
                  styles.settingIconWrapper,
                  { backgroundColor: isSignOut ? "rgba(239,68,68,0.12)" : "rgba(99,102,241,0.12)" },
                ]}>
                  <Ionicons
                    name={item.icon as any}
                    size={20}
                    color={isSignOut ? "#ef4444" : "#6366f1"}
                  />
                </View>
                <View style={styles.settingText}>
                  <Text style={[styles.settingLabel, isSignOut && styles.settingLabelDanger]}>
                    {item.label}
                  </Text>
                  <Text style={styles.settingDescription}>{item.description}</Text>
                </View>
                {logoutMutation.isPending && isSignOut ? (
                  <ActivityIndicator color="#ef4444" size="small" />
                ) : (
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={isSignOut ? "#ef4444" : "#6b7280"}
                  />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Footer */}
        <Text style={styles.footer}>Hisaabo v0.1.0 — Self-hosted invoicing</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f1a" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#2d2d44",
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "700", color: "#ffffff" },
  content: { padding: 16, paddingBottom: 48 },

  // App Info Card
  appInfoCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#2d2d44",
    padding: 20,
    marginBottom: 24,
  },
  appIconWrapper: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: "rgba(99,102,241,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  appName: { fontSize: 20, fontWeight: "700", color: "#ffffff" },
  appVersion: { fontSize: 13, color: "#6b7280", marginTop: 2 },

  // Settings List
  settingsList: {
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#2d2d44",
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
    borderBottomColor: "#2d2d44",
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
  settingLabel: { fontSize: 15, fontWeight: "600", color: "#ffffff" },
  settingLabelDanger: { color: "#ef4444" },
  settingDescription: { fontSize: 12, color: "#6b7280", marginTop: 2 },

  footer: {
    textAlign: "center",
    color: "#6b7280",
    fontSize: 12,
    marginTop: 32,
  },
});
