import { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";
import { usePermissions } from "../../../../src/hooks/usePermissions";
import { formatCurrency, formatDate } from "../../../../src/lib/utils";
import { makeStyles } from "../../../../src/lib/makeStyles";
import { useColors } from "../../../../src/contexts/ThemeContext";
import { haptic } from "../../../../src/lib/haptics";
import {
  StatusBadge,
  FAB,
  SearchBar,
  PressableRow,
  EmptyState,
  QueryError,
} from "../../../../src/components/ui";

type StatusFilter = "all" | "draft" | "sent" | "paid" | "cancelled";

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "paid", label: "Refunded" },
  { key: "cancelled", label: "Cancelled" },
];

const PAGE_SIZE = 20;

export default function SalesReturnsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { can } = usePermissions();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const utils = trpc.useUtils();

  const queryInput = {
    status: statusFilter === "all" ? undefined : statusFilter,
    search: search.length > 0 ? search : undefined,
    page,
    limit: PAGE_SIZE,
  };

  const { data, isLoading, isError, refetch, isRefetching } =
    trpc.salesReturn.list.useQuery(queryInput);

  const deleteMutation = trpc.salesReturn.delete.useMutation({
    onSuccess: () => {
      utils.salesReturn.list.invalidate();
      utils.invoice.list.invalidate();
      utils.dashboard.summary.invalidate();
      utils.party.list.invalidate();
      haptic.success();
    },
    onError: (err) => { haptic.error(); Alert.alert("Error", err.message); },
  });

  const updateStatusMutation = trpc.salesReturn.updateStatus.useMutation({
    onSuccess: () => {
      utils.salesReturn.list.invalidate();
      utils.dashboard.summary.invalidate();
      haptic.success();
    },
    onError: (err) => { haptic.error(); Alert.alert("Error", err.message); },
  });

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

  const handleDelete = useCallback((id: string, num: string) => {
    Alert.alert("Delete", `Delete ${num}? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate({ id }) },
    ]);
  }, [deleteMutation]);

  const handleMarkSent = useCallback((id: string) => {
    updateStatusMutation.mutate({ id, status: "sent" });
  }, [updateStatusMutation]);

  const handleCancel = useCallback((id: string, num: string) => {
    Alert.alert("Cancel", `Cancel ${num}?`, [
      { text: "Keep", style: "cancel" },
      { text: "Cancel", style: "destructive", onPress: () => updateStatusMutation.mutate({ id, status: "cancelled" }) },
    ]);
  }, [updateStatusMutation]);

  const ListHeader = (
    <View style={styles.listHeader}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Sales Returns</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.infoBox}>
        <Ionicons name="information-circle-outline" size={16} color={colors.info} />
        <Text style={styles.infoText}>Stock is incremented on creation (goods returned by customer)</Text>
      </View>

      <View style={styles.searchWrap}>
        <SearchBar
          value={search}
          onChangeText={handleSearchChange}
          placeholder="Search by number or party..."
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
          {total} {total === 1 ? "sales return" : "sales returns"}
        </Text>
      )}
    </View>
  );

  const renderItem = ({ item }: { item: typeof docs[0] }) => (
    <View style={styles.docCard}>
      <PressableRow style={styles.docRow} onPress={() => { haptic.light(); router.push(`/(more)/sales-returns/${item.id}` as never); }}>
        <View style={styles.docLeft}>
          <Text style={styles.docNumber}>{item.invoiceNumber}</Text>
          <Text style={styles.partyName} numberOfLines={1}>{item.partyName}</Text>
          <Text style={styles.docDate}>{formatDate(item.invoiceDate)}</Text>
        </View>
        <View style={styles.docRight}>
          <Text style={styles.docAmount}>{formatCurrency(item.totalAmount)}</Text>
          <StatusBadge status={item.status} />
        </View>
      </PressableRow>
      {item.status === "draft" && (
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => handleMarkSent(item.id)}>
            <Ionicons name="send-outline" size={13} color={colors.info || "#3b82f6"} />
            <Text style={[styles.actionBtnText, { color: colors.info || "#3b82f6" }]}>Mark Sent</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => handleDelete(item.id, item.invoiceNumber)}>
            <Ionicons name="trash-outline" size={13} color={colors.danger} />
            <Text style={[styles.actionBtnText, { color: colors.danger }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}
      {item.status === "sent" && (
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => handleCancel(item.id, item.invoiceNumber)}>
            <Ionicons name="close-circle-outline" size={13} color={colors.danger} />
            <Text style={[styles.actionBtnText, { color: colors.danger }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const ListEmpty = isError ? (
    <QueryError message="Failed to load sales returns" onRetry={refetch} />
  ) : isLoading ? null : (
    <EmptyState
      icon="return-down-back-outline"
      title="No sales returns found"
      description={search ? "Try a different search term" : "Create your first sales return"}
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

      {can("create", "Invoice") && (
        <FAB onPress={() => router.push("/(more)/sales-returns/create" as never)} />
      )}
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
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
  infoBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.infoBg,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.info + "30",
  },
  infoText: { fontSize: 12, color: colors.info, flex: 1 },
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
  docCard: {
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  docRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  docLeft: { flex: 1, paddingRight: 12, gap: 3 },
  docNumber: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  partyName: { fontSize: 13, color: colors.textSecondary },
  docDate: { fontSize: 11, color: colors.textMuted },
  docRight: { alignItems: "flex-end", gap: 6 },
  docAmount: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  actionRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.border },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 9 },
  actionBtnText: { fontSize: 12, fontWeight: "600" },
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
