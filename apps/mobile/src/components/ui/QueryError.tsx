import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles } from "../../lib/makeStyles";
import { useColors } from "../../contexts/ThemeContext";

interface Props {
  message?: string;
  onRetry?: () => void;
}

export function QueryError({ message = "Something went wrong", onRetry }: Props) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.container}>
      <Ionicons name="cloud-offline-outline" size={48} color={colors.danger} />
      <Text style={styles.title}>Oops!</Text>
      <Text style={styles.message}>{message}</Text>
      {onRetry && (
        <TouchableOpacity style={styles.retryBtn} onPress={onRetry}>
          <Text style={styles.retryText}>Try Again</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32, gap: 12 },
  title: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  message: { fontSize: 13, color: colors.textMuted, textAlign: "center", lineHeight: 20 },
  retryBtn: {
    marginTop: 8,
    backgroundColor: colors.brand,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryText: { fontSize: 14, fontWeight: "600", color: "#ffffff" },
}));
