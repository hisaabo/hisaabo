import { View, Text, SafeAreaView, StyleSheet, TouchableOpacity, ScrollView, Dimensions } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

const MENU_ITEMS = [
  { label: "Payments", icon: "card-outline", route: "/(more)/payments" },
  { label: "Expenses", icon: "receipt-outline", route: "/(more)/expenses" },
  { label: "Cash & Bank", icon: "wallet-outline", route: "/(more)/bank" },
  { label: "Quotations", icon: "document-text-outline", route: "/(more)/quotations" },
  { label: "Credit Notes", icon: "return-down-back-outline", route: "/(more)/credit-notes" },
  { label: "Delivery Challans", icon: "car-outline", route: "/(more)/delivery-challans" },
  { label: "Store Orders", icon: "storefront-outline", route: "/(more)/store-orders" },
  { label: "GST Reports", icon: "pie-chart-outline", route: "/(more)/gst" },
  { label: "Settings", icon: "settings-outline", route: "/(more)/settings" },
] as const;

const { width } = Dimensions.get("window");
const PADDING = 16;
const COLUMNS = 3;
const GAP = 12;
const CARD_WIDTH = (width - PADDING * 2 - GAP * (COLUMNS - 1)) / COLUMNS;

export default function MoreScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>More</Text>
        <Text style={styles.subtitle}>All features & settings</Text>
      </View>
      <ScrollView contentContainerStyle={styles.gridContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.grid}>
          {MENU_ITEMS.map((item) => (
            <TouchableOpacity
              key={item.label}
              style={styles.card}
              onPress={() => router.push(item.route as any)}
              activeOpacity={0.7}
            >
              <View style={styles.iconWrapper}>
                <Ionicons name={item.icon as any} size={26} color="#6366f1" />
              </View>
              <Text style={styles.cardLabel}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f0f1a",
  },
  header: {
    paddingHorizontal: PADDING,
    paddingTop: 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#ffffff",
  },
  subtitle: {
    fontSize: 13,
    color: "#6b7280",
    marginTop: 2,
  },
  gridContainer: {
    paddingHorizontal: PADDING,
    paddingBottom: 24,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: GAP,
  },
  card: {
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#2d2d44",
    padding: 16,
    alignItems: "center",
    gap: 8,
    width: CARD_WIDTH,
  },
  iconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: "rgba(99, 102, 241, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#ffffff",
    textAlign: "center",
    lineHeight: 14,
  },
});
