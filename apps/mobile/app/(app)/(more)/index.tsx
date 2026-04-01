import { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";
import { colors } from "../../../src/lib/theme";
import { PressableRow } from "../../../src/components/ui";

/* ── Menu items ──────────────────────────────────────────────── */

interface MenuItem {
  label: string;
  icon: string;
  route: string;
}

const ALL_ITEMS: MenuItem[] = [
  { label: "Items", icon: "cube-outline", route: "/(items)" },
  { label: "Expenses", icon: "receipt-outline", route: "/(more)/expenses" },
  { label: "Cash & Bank", icon: "wallet-outline", route: "/(more)/bank" },
  { label: "Quotations", icon: "document-text-outline", route: "/(more)/quotations" },
  { label: "Credit Notes", icon: "return-down-back-outline", route: "/(more)/credit-notes" },
  { label: "Delivery Challans", icon: "car-outline", route: "/(more)/delivery-challans" },
  { label: "Proforma Invoices", icon: "document-text-outline", route: "/(more)/proforma-invoices" },
  { label: "Sales Returns", icon: "return-down-back-outline", route: "/(more)/sales-returns" },
  { label: "Store Orders", icon: "storefront-outline", route: "/(more)/store-orders" },
  { label: "GST Returns", icon: "pie-chart-outline", route: "/(more)/gst" },
  { label: "Shipments", icon: "boat-outline", route: "/(more)/shipments" },
  { label: "Business Reports", icon: "bar-chart-outline", route: "/(more)/reports" },
  { label: "Settings", icon: "settings-outline", route: "/(more)/settings" },
];

const RECENT_KEY = "hisaabo_recent_more";
const MAX_RECENT = 4;

/* ── Recent tracking ─────────────────────────────────────────── */

async function getRecent(): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function trackRecent(route: string) {
  try {
    const recent = await getRecent();
    const updated = [route, ...recent.filter((r) => r !== route)].slice(0, MAX_RECENT);
    await SecureStore.setItemAsync(RECENT_KEY, JSON.stringify(updated));
  } catch { /* non-fatal */ }
}

/* ── Screen ──────────────────────────────────────────────────── */

export default function MoreScreen() {
  const router = useRouter();
  const [recentRoutes, setRecentRoutes] = useState<string[]>([]);

  useEffect(() => {
    getRecent().then(setRecentRoutes);
  }, []);

  function handlePress(item: MenuItem) {
    trackRecent(item.route);
    setRecentRoutes((prev) => [item.route, ...prev.filter((r) => r !== item.route)].slice(0, MAX_RECENT));
    router.push(item.route as any);
  }

  // Split items into recent and the rest
  const recentItems = recentRoutes
    .map((route) => ALL_ITEMS.find((i) => i.route === route))
    .filter((i): i is MenuItem => !!i);

  const recentSet = new Set(recentRoutes);
  const otherItems = ALL_ITEMS.filter((i) => !recentSet.has(i.route));

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <View style={s.header}>
        <Text style={s.title}>More</Text>
      </View>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* Recent section */}
        {recentItems.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Recent</Text>
            <View style={s.grid}>
              {recentItems.map((item) => (
                <GridItem key={item.route} item={item} onPress={() => handlePress(item)} />
              ))}
            </View>
          </View>
        )}

        {/* All other items */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>{recentItems.length > 0 ? "All Features" : "Features"}</Text>
          <View style={s.grid}>
            {otherItems.map((item) => (
              <GridItem key={item.route} item={item} onPress={() => handlePress(item)} />
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ── Grid item ───────────────────────────────────────────────── */

function GridItem({ item, onPress }: { item: MenuItem; onPress: () => void }) {
  return (
    <PressableRow style={s.card} onPress={onPress}>
      <View style={s.iconWrap}>
        <Ionicons name={item.icon as any} size={22} color={colors.brand} />
      </View>
      <Text style={s.cardLabel} numberOfLines={2}>{item.label}</Text>
    </PressableRow>
  );
}

/* ── Styles ──────────────────────────────────────────────────── */

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 28, fontWeight: "700", color: colors.textPrimary, letterSpacing: -0.5 },
  content: { paddingHorizontal: 16, paddingBottom: 32 },

  section: { marginTop: 20 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 10,
  },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  card: {
    width: "48%",
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 16,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textPrimary,
    flex: 1,
  },
});
