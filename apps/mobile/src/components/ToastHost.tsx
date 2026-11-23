import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { makeStyles } from "../lib/makeStyles";
import { subscribeToasts, type Toast } from "../lib/toast";

const VISIBLE_MS = 4000;

/** Renders the toasts raised through `lib/toast`. Mount once, in the root layout. */
export function ToastHost() {
  const styles = useStyles();
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(
    () =>
      subscribeToasts((t) => {
        setToasts((prev) => [...prev.slice(-2), t]);
        setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), VISIBLE_MS);
      }),
    [],
  );

  if (toasts.length === 0) return null;

  return (
    <SafeAreaView edges={["bottom"]} pointerEvents="none" style={styles.host}>
      {toasts.map((t) => (
        <View
          key={t.id}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={[styles.toast, t.kind === "error" && styles.error, t.kind === "success" && styles.success]}
        >
          <Text style={styles.title}>{t.title}</Text>
          {t.description ? <Text style={styles.description}>{t.description}</Text> : null}
        </View>
      ))}
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  host: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  toast: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  error: { borderColor: colors.danger, backgroundColor: colors.dangerBg },
  success: { borderColor: colors.success, backgroundColor: colors.successBg },
  title: { color: colors.textPrimary, fontSize: 14, fontWeight: "600" },
  description: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
}));
