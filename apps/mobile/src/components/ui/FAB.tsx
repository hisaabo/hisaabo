import { TouchableOpacity, ViewStyle, StyleProp } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles } from "../../lib/makeStyles";
import { haptic } from "../../lib/haptics";

interface Props {
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
}

export function FAB({ onPress, icon = "add", style }: Props) {
  const insets = useSafeAreaInsets();
  const styles = useStyles();

  return (
    <TouchableOpacity
      style={[styles.fab, { bottom: 24 + insets.bottom }, style]}
      onPress={() => { haptic.medium(); onPress(); }}
      activeOpacity={0.8}
    >
      <Ionicons name={icon} size={28} color="#ffffff" />
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((colors) => ({
  fab: {
    position: "absolute",
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
}));
