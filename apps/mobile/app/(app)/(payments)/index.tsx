import { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../src/lib/trpc";
import { formatCurrency, formatDateShort } from "../../../src/lib/utils";
import { colors } from "../../../src/lib/theme";
import { FAB, SearchBar, PressableRow, EmptyState } from "../../../src/components/ui";

type PaymentMode = "cash" | "bank" | "upi" | "cheque" | "other";

const MODE_COLORS: Record<PaymentMode, { bg: string; text: string }> = {
  cash: { bg: "rgba(34, 197, 94, 0.15)", text: "#22c55e" },
  upi: { bg: "rgba(168, 85, 247, 0.15)", text: "#a855f7" },
  bank: { bg: "rgba(59, 130, 246, 0.15)", text: "#3b82f6" },
  cheque: { bg: "rgba(245, 158, 11, 0.15)", text: "#f59e0b" },
  other: { bg: "rgba(156, 163, 175, 0.15)", text: "#9ca3af" },
};

function ModeBadge({ mode }: { mode: string }) {
  const modeColors = MODE_COLORS[mode as PaymentMode] ?? MODE_COLORS.other;
  return (
    <View style={[styles.badge, { backgroundColor: modeColors.bg }]}>
      <Text style={[styles.badgeText, { color: modeColors.text }]}>
        {mode.charAt(0).toUpperCase() + mode.slice(1)}
      </Text>
    </View>
  );
}

const PAGE_SIZE = 20;

export default function PaymentsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data, isLoading, refetch } = trpc.payment.list.useQuery({
    page,
    limit: PAGE_SIZE,
    search: search.length > 0 ? search : undefined,
  });

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setPage(1);
    await refetch();
    setIsRefreshing(false);
  }, [refetch]);

  const handleSearch = useCallback((text: string) => {
    setSearch(text);
    setPage(1);
  }, []);

  const payments = data?.data ?? [];

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Payments</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Search Bar */}
      <View style={styles.searchWrapper}>
        <SearchBar
          value={search}
          onChangeText={handleSearch}
          placeholder="Search payments or parties..."
        />
      </View>

      {/* List */}
      {isLoading && !data ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      ) : (
        <FlatList
          data={payments}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.brand}
              colors={[colors.brand]}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="card-outline"
              title="No payments found"
              description={search ? "Try a different search term" : "Record your first payment"}
            />
          }
          renderItem={({ item }) => (
            <PressableRow
              style={styles.card}
              onPress={() => router.push(`/(more)/payments/${item.id}` as never)}
            >
              <View style={styles.cardRow}>
                <View style={styles.cardLeft}>
                  <Text style={styles.paymentNumber}>{item.paymentNumber}</Text>
                  <Text style={styles.partyName} numberOfLines={1}>{item.partyName}</Text>
                </View>
                <Text style={styles.amount}>{formatCurrency(item.amount)}</Text>
              </View>
              <View style={styles.cardFooter}>
                <Text style={styles.date}>
                  {item.paymentDate ? formatDateShort(item.paymentDate) : "—"}
                </Text>
                <ModeBadge mode={item.mode} />
              </View>
            </PressableRow>
          )}
          onEndReached={() => {
            if (data && page * PAGE_SIZE < data.total) {
              setPage((p) => p + 1);
            }
          }}
          onEndReachedThreshold={0.4}
        />
      )}

      <FAB onPress={() => router.push("/(payments)/create" as never)} />
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
  searchWrapper: {
    margin: 16,
  },
  listContent: { paddingHorizontal: 16, paddingBottom: 100 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
  },
  cardRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  cardLeft: { flex: 1, marginRight: 12 },
  paymentNumber: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  partyName: { fontSize: 16, fontWeight: "600", color: colors.textPrimary, marginTop: 2 },
  amount: { fontSize: 17, fontWeight: "700", color: colors.textPrimary },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  date: { fontSize: 12, color: colors.textMuted },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: { fontSize: 11, fontWeight: "600", textTransform: "capitalize" },
});
