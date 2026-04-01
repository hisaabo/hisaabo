import { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";
import { formatDate } from "../../../../src/lib/utils";
import { colors } from "../../../../src/lib/theme";
import {
  FAB,
  SearchBar,
  PressableRow,
  EmptyState,
  QueryError,
} from "../../../../src/components/ui";

type StatusFilter = "all" | "pending" | "shipped" | "in_transit" | "delivered" | "returned";

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "shipped", label: "Shipped" },
  { key: "in_transit", label: "In Transit" },
  { key: "delivered", label: "Delivered" },
  { key: "returned", label: "Returned" },
];

const STATUS_COLORS: Record<string, string> = {
  pending: colors.warning,
  shipped: colors.info,
  in_transit: colors.brand,
  delivered: colors.success,
  returned: colors.danger,
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  shipped: "Shipped",
  in_transit: "In Transit",
  delivered: "Delivered",
  returned: "Returned",
};

const PAGE_SIZE = 20;

function ShipmentStatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? colors.textMuted;
  const label = STATUS_LABELS[status] ?? status;
  return (
    <View style={[sb.badge, { backgroundColor: color + "20", borderColor: color + "40" }]}>
      <Text style={[sb.text, { color }]}>{label}</Text>
    </View>
  );
}

const sb = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  text: {
    fontSize: 11,
    fontWeight: "700",
  },
});

export default function ShipmentsScreen() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const queryInput = {
    status: statusFilter === "all" ? undefined : statusFilter,
    search: search.length > 0 ? search : undefined,
    page,
    limit: PAGE_SIZE,
  };

  const { data, isLoading, isError, refetch, isRefetching } =
    trpc.shipment.list.useQuery(queryInput);

  const docs = data?.data ?? [];
  const total = data?.total ?? 0;
  const hasMore = total > page * PAGE_SIZE;

  const handleStatusFilter = useCallback((status: StatusFilter) => {
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
        <Text style={styles.screenTitle}>Shipments</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.searchWrap}>
        <SearchBar
          value={search}
          onChangeText={handleSearchChange}
          placeholder="Search by tracking, carrier..."
        />
      </View>

      <FlatList
        horizontal
        data={STATUS_FILTERS}
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
          {total} {total === 1 ? "shipment" : "shipments"}
        </Text>
      )}
    </View>
  );

  const renderItem = ({ item }: { item: typeof docs[0] }) => (
    <PressableRow
      style={styles.docRow}
      onPress={() => router.push(`/(more)/shipments/${item.id}` as never)}
    >
      <View style={styles.docLeft}>
        <View style={styles.carrierRow}>
          <Ionicons name="cube-outline" size={14} color={colors.brand} />
          <Text style={styles.carrierText} numberOfLines={1}>
            {item.carrier ? item.carrier.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "No Carrier"}
          </Text>
        </View>
        {item.trackingNumber ? (
          <Text style={styles.trackingText} numberOfLines={1}>{item.trackingNumber}</Text>
        ) : null}
        {item.partyName ? (
          <Text style={styles.partyName} numberOfLines={1}>{item.partyName}</Text>
        ) : null}
        {item.shipmentDate ? (
          <Text style={styles.docDate}>{formatDate(item.shipmentDate)}</Text>
        ) : null}
      </View>
      <View style={styles.docRight}>
        {item.cost && parseFloat(item.cost) > 0 ? (
          <Text style={styles.costText}>
            {"\u20B9"}{parseFloat(item.cost).toFixed(0)}
          </Text>
        ) : null}
        <ShipmentStatusBadge status={item.status} />
      </View>
    </PressableRow>
  );

  const ListEmpty = isError ? (
    <QueryError message="Failed to load shipments" onRetry={refetch} />
  ) : isLoading ? null : (
    <EmptyState
      icon="cube-outline"
      title="No shipments found"
      description={search ? "Try a different search term" : "Create your first shipment"}
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
        data={docs}
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

      <FAB onPress={() => router.push("/(more)/shipments/create" as never)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flatListContent: { paddingBottom: 100 },
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
  docRow: {
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
  docLeft: { flex: 1, paddingRight: 12, gap: 3 },
  carrierRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  carrierText: { fontSize: 14, fontWeight: "700", color: colors.textPrimary, flex: 1 },
  trackingText: { fontSize: 12, color: colors.brand, fontFamily: "monospace" },
  partyName: { fontSize: 13, color: colors.textSecondary },
  docDate: { fontSize: 11, color: colors.textMuted },
  docRight: { alignItems: "flex-end", gap: 6 },
  costText: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
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
});
