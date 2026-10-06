import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { trpc } from "../../src/lib/trpc";
import { useAuthStore } from "../../src/stores/auth";
import { startNativeLogin } from "../../src/lib/native-login";

const C = {
  bg: "#0f0f1a",
  surface: "#1a1a2e",
  border: "#2d2d44",
  brand: "#5b5bd6",
  amber: "#fbbf24",
  amberBg: "rgba(251, 191, 36, 0.12)",
  amberBorder: "rgba(251, 191, 36, 0.25)",
  textPrimary: "#ffffff",
  textSecondary: "#9ca3af",
  textMuted: "#6b7280",
  error: "#ef4444",
  errorBg: "rgba(239, 68, 68, 0.1)",
  errorBorder: "rgba(239, 68, 68, 0.25)",
} as const;

/* ─── Dev-mode Token Input (only rendered when __DEV__ is true) ──────────── */
function DevTokenInput() {
  const [devToken, setDevToken] = useState("");
  const [devError, setDevError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const login = useAuthStore((s) => s.login);

  const verifyMutation = trpc.auth.verifyMagicLink.useMutation({
    onSuccess: async (data) => {
      if (data.sessionToken) {
        setDevError("");
        await login(data.sessionToken);
        router.replace("/(app)/(home)");
      }
    },
    onError: (err) => setDevError(err.message),
  });

  const handleVerify = useCallback(() => {
    const token = devToken.trim();
    if (!token) return;
    setDevError("");
    verifyMutation.mutate({ token });
  }, [devToken, verifyMutation]);

  return (
    <View style={styles.devContainer}>
      <TouchableOpacity
        style={styles.devHeader}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.7}
      >
        <View style={styles.devBadge}>
          <Text style={styles.devBadgeText}>DEV</Text>
        </View>
        <Text style={styles.devHeaderText}>Developer Mode</Text>
        <Text style={styles.devChevron}>{expanded ? "▲" : "▼"}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.devBody}>
          <Text style={styles.devHint}>
            Paste the token from the API console output (the value after ?token= in the magic link
            URL).
          </Text>
          <TextInput
            style={styles.devInput}
            value={devToken}
            onChangeText={(t) => {
              setDevToken(t);
              setDevError("");
            }}
            placeholder="Paste token here"
            placeholderTextColor={C.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={handleVerify}
            editable={!verifyMutation.isPending}
          />
          {devError ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{devError}</Text>
            </View>
          ) : null}
          <TouchableOpacity
            style={[
              styles.devButton,
              (verifyMutation.isPending || !devToken.trim()) && styles.buttonDisabled,
            ]}
            onPress={handleVerify}
            disabled={verifyMutation.isPending || !devToken.trim()}
            activeOpacity={0.8}
          >
            {verifyMutation.isPending ? (
              <ActivityIndicator color={C.textPrimary} size="small" />
            ) : (
              <Text style={styles.devButtonText}>Verify Token</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default function LoginScreen() {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const config = trpc.system.config.useQuery(undefined, { retry: false });

  useEffect(() => {
    SecureStore.getItemAsync("sessionExpired").then((v: string | null) => {
      if (v === "1") {
        setSessionExpired(true);
        SecureStore.deleteItemAsync("sessionExpired");
      }
    });
  }, []);

  const handleContinue = useCallback(async () => {
    setError("");
    setPending(true);
    try {
      await startNativeLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start sign-in. Please try again.");
    } finally {
      setPending(false);
    }
  }, []);

  const signupOpen = config.data?.signupOpen !== false;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {sessionExpired && (
        <View style={styles.sessionExpiredBanner}>
          <Text style={styles.sessionExpiredText}>Your session was ended. Please sign in again.</Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandSection}>
          <Text style={styles.brandName}>Hisaabo</Text>
          <Text style={styles.heroTitle}>Welcome back</Text>
          <Text style={styles.heroSubtitle}>
            {signupOpen
              ? "Sign in or create your account in your browser."
              : "Sign in with your invited email in your browser."}
          </Text>
        </View>

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.primaryButton, pending && styles.buttonDisabled]}
          onPress={handleContinue}
          disabled={pending}
          activeOpacity={0.8}
          accessibilityRole="button"
        >
          {pending ? (
            <ActivityIndicator color={C.textPrimary} size="small" />
          ) : (
            <Text style={styles.primaryButtonText}>Continue in browser</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.footnote}>
          You will sign in on app.hisaabo.in and return here automatically.
        </Text>

        {__DEV__ && <DevTokenInput />}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scrollContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, paddingVertical: 32 },
  brandSection: { alignItems: "center", marginBottom: 32 },
  brandName: { fontSize: 28, fontWeight: "700", color: C.textPrimary, marginBottom: 24 },
  heroTitle: { fontSize: 26, fontWeight: "700", color: C.textPrimary, marginBottom: 8 },
  heroSubtitle: { fontSize: 15, color: C.textSecondary, textAlign: "center", lineHeight: 22 },
  primaryButton: {
    backgroundColor: C.brand,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
  },
  primaryButtonText: { fontSize: 16, fontWeight: "700", color: C.textPrimary },
  buttonDisabled: { opacity: 0.5 },
  footnote: { fontSize: 12, color: C.textMuted, textAlign: "center", marginTop: 16 },
  errorBanner: {
    backgroundColor: C.errorBg,
    borderColor: C.errorBorder,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorText: { color: C.error, fontSize: 13 },
  sessionExpiredBanner: {
    backgroundColor: C.amberBg,
    borderColor: C.amberBorder,
    borderWidth: 1,
    padding: 12,
    margin: 16,
    borderRadius: 10,
  },
  sessionExpiredText: { color: C.amber, fontSize: 13, textAlign: "center" },
  devContainer: {
    marginTop: 32,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    backgroundColor: C.surface,
  },
  devHeader: { flexDirection: "row", alignItems: "center", padding: 12 },
  devBadge: {
    backgroundColor: C.amberBg,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 8,
  },
  devBadgeText: { color: C.amber, fontSize: 10, fontWeight: "700" },
  devHeaderText: { flex: 1, color: C.textSecondary, fontSize: 13 },
  devChevron: { color: C.textMuted, fontSize: 10 },
  devBody: { padding: 12, paddingTop: 0 },
  devHint: { color: C.textMuted, fontSize: 12, marginBottom: 8, lineHeight: 18 },
  devInput: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    color: C.textPrimary,
    padding: 10,
    marginBottom: 8,
  },
  devButton: {
    backgroundColor: C.brand,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  devButtonText: { color: C.textPrimary, fontWeight: "600", fontSize: 14 },
});
