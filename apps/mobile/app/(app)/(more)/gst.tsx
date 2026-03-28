import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../../src/lib/theme";

export default function GSTReportsScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>GST Reports</Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={styles.body}>
        <View style={styles.iconWrapper}>
          <Ionicons name="pie-chart-outline" size={56} color={colors.brand} />
        </View>
        <Text style={styles.heading}>GST Reports</Text>
        <Text style={styles.subtext}>Generate GSTR-1, GSTR-3B, and other GST compliance reports.</Text>
        <View style={styles.comingSoon}>
          <Text style={styles.comingSoonText}>Coming soon</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
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
});
