import { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../src/lib/trpc";

const colors = {
  bg: "#0f0f1a",
  surface: "#1a1a2e",
  border: "#2d2d44",
  brand: "#6366f1",
  brandLight: "rgba(99,102,241,0.12)",
  textPrimary: "#ffffff",
  textSecondary: "#9ca3af",
  textMuted: "#6b7280",
  success: "#10b981",
  danger: "#ef4444",
} as const;

export default function CompleteProfileScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const nameRef = useRef<TextInput>(null);

  const completeMutation = trpc.auth.completeProfile.useMutation({
    onSuccess: () => {
      router.replace("/(app)");
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to save your name. Please try again.");
    },
  });

  const handleContinue = () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      Alert.alert("Validation", "Please enter at least 2 characters for your name.");
      return;
    }
    completeMutation.mutate({ name: trimmed });
  };

  const isDisabled = completeMutation.isPending || name.trim().length < 2;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.content}>
          {/* Icon */}
          <View style={styles.iconContainer}>
            <Ionicons name="person-circle-outline" size={64} color={colors.brand} />
          </View>

          {/* Heading */}
          <Text style={styles.heading}>Welcome!</Text>
          <Text style={styles.subheading}>What's your name?</Text>
          <Text style={styles.description}>
            This helps personalize your Hisaabo experience and appears on your documents.
          </Text>

          {/* Input */}
          <View style={styles.inputWrapper}>
            <Text style={styles.label}>Full Name</Text>
            <TextInput
              ref={nameRef}
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Enter your name"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleContinue}
              autoFocus
            />
          </View>

          {/* Continue button */}
          <TouchableOpacity
            style={[styles.continueBtn, isDisabled && styles.continueBtnDisabled]}
            onPress={handleContinue}
            disabled={isDisabled}
            activeOpacity={0.8}
          >
            {completeMutation.isPending ? (
              <ActivityIndicator size="small" color={colors.textPrimary} />
            ) : (
              <View style={styles.continueBtnInner}>
                <Text style={styles.continueBtnText}>Continue</Text>
                <Ionicons name="arrow-forward" size={18} color={colors.textPrimary} />
              </View>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  inner: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 60,
    paddingBottom: 32,
  },
  iconContainer: {
    alignItems: "center",
    marginBottom: 24,
  },
  heading: {
    fontSize: 32,
    fontWeight: "700",
    color: colors.textPrimary,
    textAlign: "center",
    letterSpacing: -0.5,
  },
  subheading: {
    fontSize: 20,
    fontWeight: "600",
    color: colors.textSecondary,
    textAlign: "center",
    marginTop: 8,
  },
  description: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: 12,
    marginBottom: 40,
    lineHeight: 20,
  },
  inputWrapper: {
    marginBottom: 24,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.textPrimary,
    fontSize: 16,
  },
  continueBtn: {
    backgroundColor: colors.brand,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  continueBtnDisabled: {
    opacity: 0.45,
  },
  continueBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  continueBtnText: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
});
