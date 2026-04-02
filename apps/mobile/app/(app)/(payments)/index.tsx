import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../src/lib/trpc";
import { formatCurrency, formatDateShort } from "../../../src/lib/utils";
import { colors } from "../../../src/lib/theme";
import { FAB, SearchBar, PressableRow, EmptyState } from "../../../src/components/ui";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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

function UntrackedBanner() {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  const { data: countData } = trpc.payment.untrackedPayments.useQuery(
    { page: 1, limit: 1 },
    { staleTime: 60_000 }
  );

  const { data: fullData } = trpc.payment.untrackedPayments.useQuery(
    { page: 1, limit: 100 },
    { enabled: expanded, staleTime: 60_000 }
  );

  const count = countData?.total ?? 0;

  if (count === 0) return null;

  const handleToggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((v) => !v);
  };

  const payments = fullData?.data ?? [];

  return (
    <View style={bannerStyles.wrapper}>
      <TouchableOpacity
        style={bannerStyles.header}
        onPress={handleToggle}
        activeOpacity={0.8}
      >
        <View style={bannerStyles.headerLeft}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
          <Text style={bannerStyles.headerText}>
            {count} untracked {count === 1 ? "payment" : "payments"} — not linked to a bank account
          </Text>
        </View>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.warning}
        />
      </TouchableOpacity>

      {expanded && (
        <View style={bannerStyles.list}>
          {payments.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={bannerStyles.row}
              onPress={() => router.push(`/(more)/payments/${item.id}` as never)}
              activeOpacity={0.7}
            >
              <View style={bannerStyles.rowLeft}>
                <Text style={bannerStyles.rowNumber}>{item.paymentNumber}</Text>
                <Text style={bannerStyles.rowParty} numberOfLines={1}>{item.partyName}</Text>
              </View>
              <View style={bannerStyles.rowRight}>
                <Text style={bannerStyles.rowAmount}>{formatCurrency(item.amount)}</Text>
                <Text style={bannerStyles.rowDate}>
                  {item.paymentDate ? formatDateShort(item.paymentDate) : "—"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={colors.warning} style={{ marginLeft: 6 }} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

export default function PaymentsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [allPayments, setAllPayments] = useState<NonNullable<typeof data>["data"]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data, isLoading, isFetching, refetch } = trpc.payment.list.useQuery(
    {
      page,
      limit: PAGE_SIZE,
      search: search.length > 0 ? search : undefined,
    },
    { placeholderData: (prev) => prev }
  );

  // Accumulate pages — reset on page 1, append on subsequent pages
  useEffect(() => {
    if (data?.data) {
      setAllPayments((prev) => {
        if (page === 1) return data.data;
        const existingIds = new Set(prev.map((p) => p.id));
        const newItems = data.data.filter((p) => !existingIds.has(p.id));
        return [...prev, ...newItems];
      });
    }
  }, [data?.data, page]);

  // Reset accumulation when search changes
  useEffect(() => {
    setPage(1);
    setAllPayments([]);
  }, [search]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setPage(1);
    setAllPayments([]);
    await refetch();
    setIsRefreshing(false);
  }, [refetch]);

  const handleSearch = useCallback((text: string) => {
    setSearch(text);
  }, []);

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
      {isLoading && page === 1 && allPayments.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      ) : (
        <FlatList
          data={allPayments}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          keyboardDismissMode="on-drag"
          ListHeaderComponent={<UntrackedBanner />}
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
            if (!isFetching && data && allPayments.length < data.total) {
              setPage((p) => p + 1);
            }
          }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            isFetching && allPayments.length > 0 ? (
              <View style={styles.footer}>
                <ActivityIndicator color={colors.brand} />
              </View>
            ) : null
          }
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
  footer: {
    paddingVertical: 20,
    alignItems: "center",
  },
});

const bannerStyles = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warning + "55",
    borderRadius: 12,
    marginBottom: 12,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  headerText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.warning,
    flex: 1,
  },
  list: {
    borderTopWidth: 1,
    borderTopColor: colors.warning + "33",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.warning + "22",
  },
  rowLeft: {
    flex: 1,
    gap: 2,
  },
  rowNumber: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.textMuted,
  },
  rowParty: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  rowRight: {
    alignItems: "flex-end",
    gap: 2,
  },
  rowAmount: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.warning,
  },
  rowDate: {
    fontSize: 11,
    color: colors.textMuted,
  },
});
