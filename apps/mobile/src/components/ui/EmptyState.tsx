import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles } from "../../lib/makeStyles";
import { useColors } from "../../contexts/ThemeContext";

interface Props {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
}

export function EmptyState({ icon, title, description }: Props) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.container}>
      <Ionicons name={icon} size={48} color={colors.textMuted} />
      <Text style={styles.title}>{title}</Text>
      {description && <Text style={styles.description}>{description}</Text>}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32, gap: 12 },
  title: { fontSize: 16, fontWeight: "600", color: colors.textSecondary, textAlign: "center" },
  description: { fontSize: 13, color: colors.textMuted, textAlign: "center", lineHeight: 20 },
}));
