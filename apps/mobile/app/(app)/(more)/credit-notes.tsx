import { View, Text, SafeAreaView, StyleSheet, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export default function CreditNotesScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.title}>Credit Notes</Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={styles.body}>
        <View style={styles.iconWrapper}>
          <Ionicons name="return-down-back-outline" size={56} color="#6366f1" />
        </View>
        <Text style={styles.heading}>Credit Notes</Text>
        <Text style={styles.subtext}>Issue credit notes for returns, adjustments, and corrections.</Text>
        <View style={styles.comingSoon}>
          <Text style={styles.comingSoonText}>Coming soon</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f1a" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#2d2d44",
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "700", color: "#ffffff" },
  body: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  iconWrapper: {
    width: 96,
    height: 96,
    borderRadius: 24,
    backgroundColor: "rgba(99,102,241,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  heading: { fontSize: 22, fontWeight: "700", color: "#ffffff", marginBottom: 8 },
  subtext: { fontSize: 14, color: "#6b7280", textAlign: "center", lineHeight: 20 },
  comingSoon: {
    marginTop: 20,
    backgroundColor: "rgba(99,102,241,0.15)",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  comingSoonText: { fontSize: 13, fontWeight: "600", color: "#6366f1" },
});
