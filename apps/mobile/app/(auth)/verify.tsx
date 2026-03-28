import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { trpc } from "../../src/lib/trpc";
import { useAuthStore } from "../../src/stores/auth";

export default function VerifyScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(true);
  const login = useAuthStore((s) => s.login);

  const verifyMutation = trpc.auth.verifyMagicLink.useMutation({
    onSuccess: async (data) => {
      if (data.sessionToken) {
        await login(data.sessionToken);
        router.replace("/(app)/(home)");
      }
    },
    onError: (err) => {
      setError(err.message);
      setVerifying(false);
    },
  });

  useEffect(() => {
    if (token) {
      verifyMutation.mutate({ token });
    } else {
      setError("No verification token found. Please request a new sign-in link.");
      setVerifying(false);
    }
  }, [token]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        {verifying ? (
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
  buttonText: { fontSize: 15, fontWeight: "700", color: "#ffffff" },
});
