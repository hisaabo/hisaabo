import { useState, useCallback } from "react";
import {
  View,
  Text,
  SafeAreaView,
  StyleSheet,
  FlatList,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";
import { formatCurrency, formatDateShort } from "../../../../src/lib/utils";

type PaymentMode = "cash" | "bank" | "upi" | "cheque" | "other";

const MODE_COLORS: Record<PaymentMode, { bg: string; text: string }> = {
  cash: { bg: "rgba(34, 197, 94, 0.15)", text: "#22c55e" },
  upi: { bg: "rgba(168, 85, 247, 0.15)", text: "#a855f7" },
  bank: { bg: "rgba(59, 130, 246, 0.15)", text: "#3b82f6" },
  cheque: { bg: "rgba(245, 158, 11, 0.15)", text: "#f59e0b" },
  other: { bg: "rgba(156, 163, 175, 0.15)", text: "#9ca3af" },
};

const CATEGORY_COLORS = [
  "#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#3b82f6", "#ec4899", "#14b8a6",
];

const PAGE_SIZE = 20;

export default function ExpensesScreen() {
  const router = useRouter();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: categoriesData } = trpc.expense.categories.useQuery();

  const { data, isLoading, refetch } = trpc.expense.list.useQuery({
    page,
    limit: PAGE_SIZE,
    category: selectedCategory ?? undefined,
  });

  const { data: summaryData } = trpc.expense.summary.useQuery({});

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setPage(1);
    await refetch();
    setIsRefreshing(false);
  }, [refetch]);

  const handleCategorySelect = useCallback((cat: string | null) => {
    setSelectedCategory(cat);
    setPage(1);
  }, []);

  const expenses = data?.data ?? [];
  const categories = categoriesData ?? [];
  const summary = summaryData ?? [];
  const totalExpenses = summary.reduce((acc, s) => acc + parseFloat(s.total || "0"), 0);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.title}>Expenses</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Summary Card */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryMain}>
          <Text style={styles.summaryLabel}>Total Expenses</Text>
          <Text style={styles.summaryAmount}>{formatCurrency(totalExpenses)}</Text>
        </View>
        {summary.slice(0, 3).map((s, i) => (
          <View key={s.category} style={styles.summaryItem}>
            <View style={[styles.summaryDot, { backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }]} />
            <Text style={styles.summaryCategory} numberOfLines={1}>{s.category}</Text>
            <Text style={styles.summaryItemAmount}>{formatCurrency(s.total)}</Text>
          </View>
        ))}
      </View>

      {/* Category Chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        <TouchableOpacity
          style={[styles.chip, selectedCategory === null && styles.chipActive]}
          onPress={() => handleCategorySelect(null)}
          activeOpacity={0.7}
        >
          <Text style={[styles.chipText, selectedCategory === null && styles.chipTextActive]}>
            All
          </Text>
        </TouchableOpacity>
        {categories.map((cat, i) => (
          <TouchableOpacity
            key={cat}
            style={[
              styles.chip,
              selectedCategory === cat && { backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] + "22", borderColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] },
            ]}
            onPress={() => handleCategorySelect(cat)}
            activeOpacity={0.7}
          >
            <Text style={[
              styles.chipText,
              selectedCategory === cat && { color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] },
            ]}>
              {cat}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* List */}
      {isLoading && !data ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#6366f1" size="large" />
        </View>
      ) : (
        <FlatList
          data={expenses}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor="#6366f1"
            />
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="receipt-outline" size={48} color="#2d2d44" />
              <Text style={styles.emptyText}>No expenses found</Text>
            </View>
          }
          renderItem={({ item }) => {
            const modeColors = MODE_COLORS[item.mode as PaymentMode] ?? MODE_COLORS.other;
            return (
              <View style={styles.card}>
                <View style={styles.cardRow}>
                  <View style={styles.categoryBadgeWrapper}>
                    <Text style={styles.categoryBadgeText}>{item.category}</Text>
                  </View>
                  <Text style={styles.amount}>{formatCurrency(item.amount)}</Text>
                </View>
                {item.description ? (
                  <Text style={styles.description} numberOfLines={2}>{item.description}</Text>
                ) : null}
                <View style={styles.cardFooter}>
                  <Text style={styles.date}>
                    {item.expenseDate ? formatDateShort(item.expenseDate) : "—"}
                  </Text>
                  <View style={[styles.badge, { backgroundColor: modeColors.bg }]}>
                    <Text style={[styles.badgeText, { color: modeColors.text }]}>
                      {item.mode.charAt(0).toUpperCase() + item.mode.slice(1)}
                    </Text>
                  </View>
                </View>
              </View>
            );
          }}
          onEndReached={() => {
            if (data && page * PAGE_SIZE < data.total) {
              setPage((p) => p + 1);
            }
          }}
          onEndReachedThreshold={0.4}
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push("/(more)/expenses/create")}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color="#ffffff" />
      </TouchableOpacity>
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

  // Summary Card
  summaryCard: {
    margin: 16,
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#2d2d44",
    padding: 16,
  },
  summaryMain: { marginBottom: 12 },
  summaryLabel: { fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 },
  summaryAmount: { fontSize: 26, fontWeight: "700", color: "#ffffff", marginTop: 4 },
  summaryItem: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  summaryDot: { width: 8, height: 8, borderRadius: 4 },
  summaryCategory: { flex: 1, fontSize: 13, color: "#9ca3af" },
  summaryItemAmount: { fontSize: 13, fontWeight: "600", color: "#ffffff" },

  // Chips
  chipRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 12 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#2d2d44",
    backgroundColor: "#1a1a2e",
  },
  chipActive: { backgroundColor: "rgba(99,102,241,0.2)", borderColor: "#6366f1" },
  chipText: { fontSize: 13, fontWeight: "600", color: "#9ca3af" },
  chipTextActive: { color: "#6366f1" },

  // List
  listContent: { paddingHorizontal: 16, paddingBottom: 100 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  emptyText: { color: "#6b7280", marginTop: 12, fontSize: 14 },

  card: {
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2d2d44",
    padding: 14,
    marginBottom: 10,
  },
  cardRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  categoryBadgeWrapper: {
    backgroundColor: "rgba(99,102,241,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  categoryBadgeText: { fontSize: 12, fontWeight: "600", color: "#6366f1" },
  amount: { fontSize: 17, fontWeight: "700", color: "#ffffff" },
  description: { fontSize: 13, color: "#9ca3af", marginTop: 6 },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#2d2d44",
  },
  date: { fontSize: 12, color: "#6b7280" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: "600" },

  fab: {
    position: "absolute",
    bottom: 32,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#6366f1",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#6366f1",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
});
