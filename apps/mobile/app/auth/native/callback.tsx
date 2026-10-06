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
import * as WebBrowser from "expo-web-browser";
import { completeNativeLogin } from "../../../src/lib/native-login";
import { useAuthStore } from "../../../src/stores/auth";

// Reached through the verified App Link
// https://app.hisaabo.in/auth/native/callback?code=…&state=… after the user
// approves the sign-in in the system browser.
export default function NativeCallbackScreen() {
  const { code, state } = useLocalSearchParams<{ code?: string; state?: string }>();
  const [error, setError] = useState("");
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const { sessionToken, user } = await completeNativeLogin(code, state);
        await useAuthStore.getState().login(sessionToken);
        try {
          await WebBrowser.dismissBrowser();
        } catch {
          // the browser sheet may already be closed (Android)
        }
        const pendingToken = await SecureStore.getItemAsync("pendingInviteToken");
        if (pendingToken) {
          router.replace(`/invite/${pendingToken}`);
        } else if (user && !user.name) {
          router.replace("/(auth)/complete-profile");
        } else {
          router.replace("/(app)/(home)");
        }
      } catch (err) {
        try {
          await WebBrowser.dismissBrowser();
        } catch {
          // ignore
        }
        setError(err instanceof Error ? err.message : "Sign-in failed. Please try again.");
      }
    })();
  }, [code, state]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        {error ? (
          <>
            <Text style={styles.title}>Sign-in failed</Text>
            <Text style={styles.description}>{error}</Text>
            <TouchableOpacity style={styles.button} onPress={() => router.replace("/(auth)/login")}>
              <Text style={styles.buttonText}>Back to Sign In</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color="#6366f1" />
            <Text style={styles.text}>Signing you in...</Text>
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
