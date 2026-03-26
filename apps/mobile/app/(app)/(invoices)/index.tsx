import { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../src/lib/trpc";
import { formatCurrency, formatDate } from "../../../src/lib/utils";

const C = {
  bg: "#0f0f1a",
  surface: "#1a1a2e",
  border: "#2d2d44",
  brand: "#6366f1",
  textPrimary: "#ffffff",
  textSecondary: "#9ca3af",
  textMuted: "#6b7280",
  success: "#10b981",
  danger: "#ef4444",
  warning: "#f59e0b",
  info: "#3b82f6",
};

type InvoiceType = "sale" | "purchase";
type StatusFilter = "all" | "draft" | "sent" | "partial" | "overdue" | "paid" | "cancelled";

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "partial", label: "Partial" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
  { key: "cancelled", label: "Cancelled" },
];

type StatusKey = "draft" | "unfulfilled" | "sent" | "paid" | "partial" | "overdue" | "cancelled";

const STATUS_COLORS: Record<StatusKey, { bg: string; text: string }> = {
  draft: { bg: "#374151", text: "#d1d5db" },
  unfulfilled: { bg: "#374151", text: "#d1d5db" },
  sent: { bg: "#1e3a5f", text: "#60a5fa" },
  paid: { bg: "#064e3b", text: "#34d399" },
  partial: { bg: "#451a03", text: "#fbbf24" },
  overdue: { bg: "#450a0a", text: "#f87171" },
  cancelled: { bg: "#374151", text: "#9ca3af" },
};

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status as StatusKey] ?? { bg: "#374151", text: "#d1d5db" };
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <Text style={[styles.badgeText, { color: colors.text }]}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Text>
    </View>
  );
}

const PAGE_SIZE = 20;

export default function InvoicesScreen() {
  const router = useRouter();
  const [invoiceType, setInvoiceType] = useState<InvoiceType>("sale");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const queryInput = {
    type: invoiceType,
    status: statusFilter === "all" ? undefined : (statusFilter as Exclude<StatusFilter, "all">),
    search: search.length > 0 ? search : undefined,
    page,
    limit: PAGE_SIZE,
    documentType: "invoice" as const,
  };

  const { data, isLoading, refetch, isRefetching } =
    trpc.invoice.list.useQuery(queryInput);

  const invoices = data?.data ?? [];
  const total = data?.total ?? 0;
  const hasMore = total > page * PAGE_SIZE;

  const handleTypeToggle = useCallback((type: InvoiceType) => {
    setInvoiceType(type);
    setPage(1);
    setStatusFilter("all");
    setSearch("");
  }, []);

  const handleStatusFilter = useCallback((status: StatusFilter) => {
    setStatusFilter(status);
    setPage(1);
  }, []);

  const handleSearchChange = useCallback((text: string) => {
    setSearch(text);
    setPage(1);
  }, []);

  const handleLoadMore = useCallback(() => {
    if (hasMore && !isLoading) {
      setPage((p) => p + 1);
    }
  }, [hasMore, isLoading]);

  const ListHeader = (
    <View style={styles.listHeader}>
      {/* Type Toggle */}
      <View style={styles.typeToggle}>
        <TouchableOpacity
          style={[styles.typeBtn, invoiceType === "sale" && styles.typeBtnActive]}
          onPress={() => handleTypeToggle("sale")}
          activeOpacity={0.7}
        >
          <Text style={[styles.typeBtnText, invoiceType === "sale" && styles.typeBtnTextActive]}>
            Sales
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeBtn, invoiceType === "purchase" && styles.typeBtnActive]}
          onPress={() => handleTypeToggle("purchase")}
          activeOpacity={0.7}
        >
          <Text
            style={[styles.typeBtnText, invoiceType === "purchase" && styles.typeBtnTextActive]}
          >
            Purchases
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color={C.textMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by invoice # or party..."
          placeholderTextColor={C.textMuted}
          value={search}
          onChangeText={handleSearchChange}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => handleSearchChange("")}>
            <Ionicons name="close-circle" size={16} color={C.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Status Filters */}
      <FlatList
        horizontal
        data={STATUS_FILTERS}
        keyExtractor={(item) => item.key}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.statusFilterList}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[
              styles.statusFilterBtn,
              statusFilter === item.key && styles.statusFilterBtnActive,
            ]}
            onPress={() => handleStatusFilter(item.key)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.statusFilterText,
                statusFilter === item.key && styles.statusFilterTextActive,
              ]}
            >
              {item.label}
            </Text>
          </TouchableOpacity>
        )}
      />

      {/* Count */}
      {!isLoading && (
        <Text style={styles.countText}>
          {total} {total === 1 ? "invoice" : "invoices"}
        </Text>
      )}
    </View>
  );

  const renderItem = ({ item }: { item: typeof invoices[0] }) => (
    <TouchableOpacity
      style={styles.invoiceRow}
      onPress={() => router.push(`/(invoices)/${item.id}` as never)}
      activeOpacity={0.7}
    >
      <View style={styles.invoiceLeft}>
        <Text style={styles.invoiceNumber}>{item.invoiceNumber}</Text>
        <Text style={styles.partyName} numberOfLines={1}>
          {item.partyName}
        </Text>
        <Text style={styles.invoiceDate}>{formatDate(item.invoiceDate)}</Text>
      </View>
      <View style={styles.invoiceRight}>
        <Text style={styles.invoiceAmount}>{formatCurrency(item.totalAmount)}</Text>
        <StatusBadge status={item.status} />
      </View>
    </TouchableOpacity>
  );

  const ListEmpty = isLoading ? (
    <View style={styles.centeredWrap}>
      <ActivityIndicator size="large" color={C.brand} />
    </View>
  ) : (
    <View style={styles.emptyWrap}>
      <Ionicons name="receipt-outline" size={48} color={C.textMuted} />
      <Text style={styles.emptyTitle}>No invoices found</Text>
      <Text style={styles.emptySubtitle}>
        {search ? "Try a different search term" : "Create your first invoice"}
      </Text>
    </View>
  );

  const ListFooter =
    hasMore ? (
      <TouchableOpacity style={styles.loadMoreBtn} onPress={handleLoadMore}>
        {isLoading ? (
          <ActivityIndicator size="small" color={C.brand} />
        ) : (
          <Text style={styles.loadMoreText}>Load more</Text>
        )}
      </TouchableOpacity>
    ) : null;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.headerBar}>
        <Text style={styles.screenTitle}>Invoices</Text>
      </View>

      <FlatList
        data={invoices}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={ListFooter}
        contentContainerStyle={styles.flatListContent}
        showsVerticalScrollIndicator={false}
        onRefresh={refetch}
        refreshing={isRefetching}
      />

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push("/(invoices)/create" as never)}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color="#ffffff" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  headerBar: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: C.textPrimary,
  },
  flatListContent: {
    paddingBottom: 100,
  },
  listHeader: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  typeToggle: {
    flexDirection: "row",
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 4,
    marginBottom: 12,
  },
  typeBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: "center",
  },
  typeBtnActive: {
    backgroundColor: C.brand,
  },
  typeBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: C.textMuted,
  },
  typeBtnTextActive: {
    color: "#ffffff",
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: C.textPrimary,
    padding: 0,
  },
  statusFilterList: {
    gap: 8,
    paddingBottom: 12,
  },
  statusFilterBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  statusFilterBtnActive: {
    backgroundColor: C.brand,
    borderColor: C.brand,
  },
  statusFilterText: {
    fontSize: 12,
    fontWeight: "600",
    color: C.textMuted,
  },
  statusFilterTextActive: {
    color: "#ffffff",
  },
  countText: {
    fontSize: 12,
    color: C.textMuted,
    marginBottom: 8,
  },
  invoiceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.surface,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  invoiceLeft: {
    flex: 1,
    paddingRight: 12,
    gap: 3,
  },
  invoiceNumber: {
    fontSize: 14,
    fontWeight: "700",
    color: C.textPrimary,
  },
  partyName: {
    fontSize: 13,
    color: C.textSecondary,
  },
  invoiceDate: {
    fontSize: 11,
    color: C.textMuted,
  },
  invoiceRight: {
    alignItems: "flex-end",
    gap: 6,
  },
  invoiceAmount: {
    fontSize: 15,
    fontWeight: "700",
    color: C.textPrimary,
  },
  badge: {
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "600",
  },
  centeredWrap: {
    paddingTop: 80,
    alignItems: "center",
  },
  emptyWrap: {
    paddingTop: 80,
    alignItems: "center",
    gap: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: C.textSecondary,
  },
  emptySubtitle: {
    fontSize: 13,
    color: C.textMuted,
  },
  loadMoreBtn: {
    marginHorizontal: 16,
    marginTop: 4,
    paddingVertical: 12,
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
  },
  loadMoreText: {
    fontSize: 14,
    fontWeight: "600",
    color: C.brand,
  },
  fab: {
    position: "absolute",
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.brand,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: C.brand,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
});
