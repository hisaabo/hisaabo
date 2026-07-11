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

type StatusFilter = "all" | "draft" | "sent" | "cancelled";

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "cancelled", label: "Cancelled" },
];

const PAGE_SIZE = 20;

export default function DeliveryChallansScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { can } = usePermissions();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const utils = trpc.useUtils();

  const deleteMutation = trpc.deliveryChallan.delete.useMutation({
    onSuccess: () => { utils.deliveryChallan.list.invalidate(); haptic.success(); },
    onError: (err) => { haptic.error(); Alert.alert("Error", err.message); },
  });

  const updateStatusMutation = trpc.deliveryChallan.updateStatus.useMutation({
    onSuccess: () => { utils.deliveryChallan.list.invalidate(); haptic.success(); },
    onError: (err) => { haptic.error(); Alert.alert("Error", err.message); },
  });

  const queryInput = {
    status: statusFilter === "all" ? undefined : statusFilter,
    search: search.length > 0 ? search : undefined,
    page,
    limit: PAGE_SIZE,
  };

  const { data, isLoading, isError, refetch, isRefetching } =
    trpc.deliveryChallan.list.useQuery(queryInput);

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
        <Text style={styles.screenTitle}>Delivery Challans</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.infoBox}>
        <Ionicons name="information-circle-outline" size={16} color={colors.warning} />
        <Text style={styles.infoText}>Stock is decremented on creation (dispatches)</Text>
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
          {total} {total === 1 ? "delivery challan" : "delivery challans"}
        </Text>
      )}
    </View>
  );

  const renderItem = ({ item }: { item: typeof docs[0] }) => (
    <View style={styles.docCard}>
      <PressableRow style={styles.docRow} onPress={() => router.push(`/(more)/delivery-challans/${item.id}` as never)}>
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
    <QueryError message="Failed to load delivery challans" onRetry={refetch} />
  ) : isLoading ? null : (
    <EmptyState
      icon="cube-outline"
      title="No delivery challans found"
      description={search ? "Try a different search term" : "Create your first delivery challan"}
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
        <FAB onPress={() => router.push("/(more)/delivery-challans/create" as never)} />
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
    backgroundColor: colors.warningBg,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.warning + "30",
  },
  infoText: { fontSize: 12, color: colors.warning, flex: 1 },
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
  actionRow: {
    flexDirection: "row" as const,
    borderTopWidth: 1,
    borderTopColor: "#2d2d44",
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 5,
    paddingVertical: 9,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: "600" as const,
  },
}));
