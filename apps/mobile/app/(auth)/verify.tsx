import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { trpc } from "../../src/lib/trpc";
import { useAuthStore } from "../../src/stores/auth";

export default function VerifyScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(true);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const login = useAuthStore((s) => s.login);
  const hydrated = useAuthStore((s) => s.isHydrated);
  const startedRef = useRef(false);

  // A magic-link token must never silently replace an existing session
  // (login CSRF / session fixation): ask first when already signed in.
  function startVerification() {
    if (startedRef.current || !token) return;
    startedRef.current = true;
    setNeedsConfirm(false);
    setVerifying(true);
    verifyMutation.mutate({ token });
  }

  const verifyMutation = trpc.auth.verifyMagicLink.useMutation({
    onSuccess: async (data) => {
      if (data.sessionToken) {
        await login(data.sessionToken);
        const pendingToken = await SecureStore.getItemAsync("pendingInviteToken");
        if (pendingToken) {
          // Redirect to invite accept screen to handle the pending invitation
          router.replace(`/invite/${pendingToken}`);
        } else {
          router.replace("/(app)/(home)");
        }
      }
    },
    onError: (err) => {
      setError(err.message);
      setVerifying(false);
    },
  });

  useEffect(() => {
    if (!hydrated) return;
    if (!token) {
      setError("No verification token found. Please request a new sign-in link.");
      setVerifying(false);
      return;
    }
    if (useAuthStore.getState().token) {
      setNeedsConfirm(true);
      setVerifying(false);
      return;
    }
    startVerification();
  }, [token, hydrated]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        {needsConfirm ? (
          <>
            <Text style={styles.title}>You are already signed in</Text>
            <Text style={styles.description}>
              Signing in with this link will replace your current session. Switch account?
            </Text>
            <TouchableOpacity style={styles.button} onPress={startVerification}>
              <Text style={styles.buttonText}>Switch account</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => router.replace("/(app)/(home)")}
            >
              <Text style={styles.secondaryButtonText}>Stay signed in</Text>
            </TouchableOpacity>
          </>
        ) : verifying ? (
          <>
            <ActivityIndicator size="large" color="#6366f1" />
            <Text style={styles.text}>Signing you in...</Text>
          </>
        ) : (
          <>
            <View style={styles.iconCircle}>
              <Text style={styles.iconText}>⚠️</Text>
            </View>
            <Text style={styles.title}>Link expired or invalid</Text>
            <Text style={styles.description}>{error}</Text>
            <TouchableOpacity
              style={styles.button}
              onPress={() => router.replace("/(auth)/login")}
            >
              <Text style={styles.buttonText}>Back to Sign In</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f1a" },
  inner: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 24 },
  text: { fontSize: 16, color: "#9ca3af", marginTop: 16 },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#1a1a2e",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  iconText: { fontSize: 36 },
  title: { fontSize: 20, fontWeight: "700", color: "#ffffff", marginBottom: 8 },
  description: { fontSize: 14, color: "#9ca3af", textAlign: "center", lineHeight: 20 },
  button: {
    backgroundColor: "#6366f1",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginTop: 24,
  },
  secondaryButton: { paddingVertical: 14, paddingHorizontal: 32, marginTop: 8 },
  secondaryButtonText: { fontSize: 15, fontWeight: "600", color: "#9ca3af" },
  buttonText: { fontSize: 15, fontWeight: "700", color: "#ffffff" },
});
