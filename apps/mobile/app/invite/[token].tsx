import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { trpc } from "../../src/lib/trpc";
import { useAuthStore } from "../../src/stores/auth";

const colors = {
  bg: "#0f0f1a",
  surface: "#1a1a2e",
  border: "#2d2d44",
  brand: "#6366f1",
  brandLight: "rgba(99,102,241,0.12)",
  textPrimary: "#ffffff",
  textSecondary: "#9ca3af",
  textMuted: "#6b7280",
  danger: "#ef4444",
} as const;

export default function InviteAcceptScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const calledRef = useRef(false);
  const [error, setError] = useState("");
  const authToken = useAuthStore((s) => s.token);

  const utils = trpc.useUtils();
  const acceptMutation = trpc.tenant.acceptInvitation.useMutation();
  const selectTenantMutation = trpc.tenant.select.useMutation();

  useEffect(() => {
    if (!token) {
      setError("No invitation token found.");
      return;
    }

    if (!authToken) {
      // Not authenticated — store token and redirect to login
      SecureStore.setItemAsync("pendingInviteToken", token).then(() => {
        router.replace("/(auth)/login");
      });
      return;
    }

    // Authenticated — accept the invitation
    if (calledRef.current) return;
    calledRef.current = true;

    acceptMutation.mutate(
      { token },
      {
        onSuccess: (data) => {
          SecureStore.deleteItemAsync("pendingInviteToken");
          selectTenantMutation.mutate(
            { tenantId: data.tenantId },
            {
              onSuccess: () => {
                utils.auth.me.invalidate();
                utils.tenant.list.invalidate();
                router.replace("/(app)/(home)");
              },
            },
          );
        },
        onError: (err) => {
          if (err.message.includes("different email")) {
            // Keep token so they can retry after re-auth with the correct email
            router.replace("/(auth)/login");
          } else if (err.message.includes("already accepted")) {
            SecureStore.deleteItemAsync("pendingInviteToken");
            router.replace("/(app)/(home)");
          } else {
            setError(err.message);
          }
        },
      },
    );
  }, [token, authToken]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        {error ? (
          <>
            <View style={styles.iconCircle}>
              <Text style={styles.iconText}>!</Text>
            </View>
            <Text style={styles.title}>Could not accept invitation</Text>
            <Text style={styles.description}>{error}</Text>
            <TouchableOpacity
              style={styles.button}
              onPress={() => router.replace("/(auth)/login")}
            >
              <Text style={styles.buttonText}>Back to Sign In</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color={colors.brand} />
            <Text style={styles.loadingText}>Accepting your invitation...</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 24 },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(239,68,68,0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  iconText: { fontSize: 36, color: colors.danger, fontWeight: "700" },
  title: { fontSize: 20, fontWeight: "700", color: colors.textPrimary, marginBottom: 8 },
  description: { fontSize: 14, color: colors.textSecondary, textAlign: "center", lineHeight: 20 },
  loadingText: { fontSize: 16, color: colors.textSecondary, marginTop: 16 },
  button: {
    backgroundColor: colors.brand,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginTop: 24,
  },
  buttonText: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
});
