import { View, Text, StyleSheet, ScrollView, Dimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../../src/lib/theme";
import { PressableRow } from "../../../src/components/ui";

interface MenuItem {
  label: string;
  icon: string;
  route: string;
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

const MENU_SECTIONS: MenuSection[] = [
  {
    title: "Daily Use",
    items: [
      { label: "Payments", icon: "card-outline", route: "/(more)/payments" },
      { label: "Expenses", icon: "receipt-outline", route: "/(more)/expenses" },
    ],
  },
  {
    title: "Banking",
    items: [
      { label: "Cash & Bank", icon: "wallet-outline", route: "/(more)/bank" },
    ],
  },
  {
    title: "Documents",
    items: [
      { label: "Quotations", icon: "document-text-outline", route: "/(more)/quotations" },
      { label: "Credit Notes", icon: "return-down-back-outline", route: "/(more)/credit-notes" },
      { label: "Delivery Challans", icon: "car-outline", route: "/(more)/delivery-challans" },
      { label: "Store Orders", icon: "storefront-outline", route: "/(more)/store-orders" },
    ],
  },
  {
    title: "Business",
    items: [
      { label: "GST Reports", icon: "pie-chart-outline", route: "/(more)/gst" },
      { label: "Reports", icon: "bar-chart-outline", route: "/(more)/reports" },
      { label: "Settings", icon: "settings-outline", route: "/(more)/settings" },
    ],
  },
];

const { width } = Dimensions.get("window");
const PADDING = 16;
const COLUMNS = 3;
const GAP = 12;
const CARD_WIDTH = (width - PADDING * 2 - GAP * (COLUMNS - 1)) / COLUMNS;

// For the Daily Use section, use 2-column larger cards for quicker access
const CARD_WIDTH_2COL = (width - PADDING * 2 - GAP) / 2;

export default function MoreScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>More</Text>
        <Text style={styles.subtitle}>All features & settings</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {MENU_SECTIONS.map((section) => {
          const isDailyUse = section.title === "Daily Use";
          return (
            <View key={section.title} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <View style={[styles.grid, isDailyUse && styles.gridTwoCol]}>
                {section.items.map((item) => (
                  <PressableRow
                    key={item.label}
                    style={[
                      styles.card,
                      { width: isDailyUse ? CARD_WIDTH_2COL : CARD_WIDTH },
                    ]}
                    onPress={() => router.push(item.route as any)}
                  >
                    <View style={[styles.iconWrapper, isDailyUse && styles.iconWrapperLarge]}>
                      <Ionicons
                        name={item.icon as any}
                        size={isDailyUse ? 28 : 24}
                        color={colors.brand}
                      />
                    </View>
                    <Text style={[styles.cardLabel, isDailyUse && styles.cardLabelLarge]}>
                      {item.label}
                    </Text>
                  </PressableRow>
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: PADDING,
    paddingTop: 20,
    paddingBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  content: {
    paddingHorizontal: PADDING,
    paddingBottom: 32,
  },
  section: {
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GAP,
  },
  gridTwoCol: {
    // 2-column layout — items stretch evenly
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    alignItems: "center",
    gap: 8,
  },
  iconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapperLarge: {
    width: 52,
    height: 52,
    borderRadius: 14,
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textPrimary,
    textAlign: "center",
    lineHeight: 16,
  },
  cardLabelLarge: {
    fontSize: 14,
  },
});
