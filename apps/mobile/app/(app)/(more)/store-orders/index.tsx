import { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";
import { formatCurrency, formatDate } from "../../../../src/lib/utils";
import { makeStyles } from "../../../../src/lib/makeStyles";
import { useColors } from "../../../../src/contexts/ThemeContext";
import {
  StatusBadge,
  SearchBar,
  PressableRow,
  EmptyState,
  QueryError,
} from "../../../../src/components/ui";

type OrderStatus = "pending" | "confirmed" | "preparing" | "ready" | "delivered" | "cancelled";

const STATUS_TABS: { key: "all" | OrderStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "confirmed", label: "Confirmed" },
  { key: "preparing", label: "Preparing" },
  { key: "ready", label: "Ready" },
  { key: "delivered", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
];

const PAGE_SIZE = 20;

export default function StoreOrdersScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<"all" | OrderStatus>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const queryInput = {
    status: statusFilter === "all" ? undefined : statusFilter,
    search: search.length > 0 ? search : undefined,
    page,
    limit: PAGE_SIZE,
  };

  const { data, isLoading, isError, refetch, isRefetching } =
    trpc.store.listOrders.useQuery(queryInput);

  const orders = data?.data ?? [];
  const total = data?.total ?? 0;
  const hasMore = total > page * PAGE_SIZE;

  const handleStatusFilter = useCallback((status: "all" | OrderStatus) => {
    setStatusFilter(status);
    setPage(1);
  }, []);

  const handleSearchChange = useCallback((text: string) => {
    setSearch(text);
    setPage(1);
  }, []);

  const handleLoadMore = useCallback(() => {
    if (hasMore && !isLoading) setPage((p) => p + 1);
  }, [hasMore, isLoading]);

  const ListHeader = (
    <View style={styles.listHeader}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Store Orders</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.searchWrap}>
        <SearchBar
          value={search}
          onChangeText={handleSearchChange}
          placeholder="Search by order # or customer..."
        />
      </View>

      <FlatList
        horizontal
        data={STATUS_TABS}
        keyExtractor={(item) => item.key}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.statusFilterList}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.statusFilterBtn, statusFilter === item.key && styles.statusFilterBtnActive]}
            onPress={() => handleStatusFilter(item.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.statusFilterText, statusFilter === item.key && styles.statusFilterTextActive]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        )}
      />

      {!isLoading && (
        <Text style={styles.countText}>
          {total} {total === 1 ? "order" : "orders"}
        </Text>
      )}
    </View>
  );

  const renderItem = ({ item }: { item: typeof orders[0] }) => (
    <PressableRow
      style={styles.orderRow}
      onPress={() => router.push(`/(more)/store-orders/${item.id}` as never)}
    >
      <View style={styles.orderLeft}>
        <View style={styles.orderNumRow}>
          <Text style={styles.orderNumber}>{item.orderNumber}</Text>
          <StatusBadge status={item.status} />
        </View>
        <Text style={styles.customerName} numberOfLines={1}>{item.customerName}</Text>
        {item.customerPhone ? (
          <Text style={styles.customerPhone}>{item.customerPhone}</Text>
        ) : null}
        <Text style={styles.orderDate}>{formatDate(item.createdAt)}</Text>
      </View>
      <View style={styles.orderRight}>
        <Text style={styles.orderAmount}>{formatCurrency(item.totalAmount)}</Text>
        <Text style={styles.itemCount}>{item.itemCount} {item.itemCount === 1 ? "item" : "items"}</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </View>
    </PressableRow>
  );

  const ListEmpty = isError ? (
    <QueryError message="Failed to load orders" onRetry={refetch} />
  ) : isLoading ? null : (
    <EmptyState
      icon="storefront-outline"
      title="No orders found"
      description={search ? "Try a different search term" : "Store orders will appear here"}
    />
  );

  const ListFooter = hasMore ? (
    <TouchableOpacity style={styles.loadMoreBtn} onPress={handleLoadMore}>
      <Text style={styles.loadMoreText}>Load more</Text>
    </TouchableOpacity>
  ) : null;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={ListFooter}
        contentContainerStyle={styles.flatListContent}
        showsVerticalScrollIndicator={false}
        onRefresh={refetch}
        refreshing={isRefetching}
        keyboardDismissMode="on-drag"
      />
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  flatListContent: { paddingBottom: 40 },
  listHeader: { paddingBottom: 8 },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  screenTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
    textAlign: "center",
  },
  searchWrap: { paddingHorizontal: 16, marginBottom: 12 },
  statusFilterList: { gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  statusFilterBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusFilterBtnActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  statusFilterText: { fontSize: 12, fontWeight: "600", color: colors.textMuted },
  statusFilterTextActive: { color: colors.textPrimary },
  countText: { fontSize: 12, color: colors.textMuted, paddingHorizontal: 16, marginBottom: 8 },
  orderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  orderLeft: { flex: 1, paddingRight: 12, gap: 3 },
  orderNumRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  orderNumber: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  customerName: { fontSize: 13, color: colors.textSecondary },
  customerPhone: { fontSize: 12, color: colors.textMuted },
  orderDate: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  orderRight: { alignItems: "flex-end", gap: 4 },
  orderAmount: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  itemCount: { fontSize: 11, color: colors.textMuted },
  loadMoreBtn: {
    marginHorizontal: 16,
    marginTop: 4,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  loadMoreText: { fontSize: 14, fontWeight: "600", color: colors.brand },
}));
