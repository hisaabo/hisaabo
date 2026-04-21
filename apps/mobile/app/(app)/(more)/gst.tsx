import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles } from "../../../src/lib/makeStyles";
import { useColors } from "../../../src/contexts/ThemeContext";

export default function GSTReportsScreen() {
  const styles = useStyles();
  const colors = useColors();
  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <View style={styles.body}>
        <View style={styles.iconWrapper}>
          <Ionicons name="pie-chart-outline" size={56} color={colors.brand} />
        </View>
        <Text style={styles.heading}>GST Returns</Text>
        <Text style={styles.subtext}>Generate GSTR-1, GSTR-3B, and other GST return data for filing.</Text>
        <View style={styles.comingSoon}>
          <Text style={styles.comingSoonText}>Coming soon</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  iconWrapper: {
    width: 96,
    height: 96,
    borderRadius: 24,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  heading: { fontSize: 22, fontWeight: "700", color: colors.textPrimary, marginBottom: 8 },
  subtext: { fontSize: 14, color: colors.textMuted, textAlign: "center", lineHeight: 20 },
  comingSoon: {
    marginTop: 20,
    backgroundColor: colors.brandLight,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  comingSoonText: { fontSize: 13, fontWeight: "600", color: colors.brand },
}));
