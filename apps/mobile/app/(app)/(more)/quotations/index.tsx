import { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";
import { formatCurrency, formatDate } from "../../../../src/lib/utils";
import { colors } from "../../../../src/lib/theme";
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

export default function QuotationsScreen() {
  const router = useRouter();
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
    trpc.quotation.list.useQuery(queryInput);

  const convertMutation = trpc.document.convert.useMutation({
    onSuccess: (result) => {
      utils.quotation.list.invalidate();
      Alert.alert("Converted", `Invoice created: ${result.invoiceNumber}`, [
        { text: "OK" },
      ]);
    },
    onError: (err) => {
      Alert.alert("Error", err.message);
    },
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
    if (hasMore && !isLoading) {
      setPage((p) => p + 1);
    }
  }, [hasMore, isLoading]);

  const handleConvert = useCallback(
    (id: string, num: string) => {
      Alert.alert(
        "Convert to Invoice",
        `Convert quotation ${num} into a sales invoice?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Convert",
            onPress: () =>
              convertMutation.mutate({
                sourceDocumentId: id,
                targetDocumentType: "invoice",
              }),
          },
        ]
      );
    },
    [convertMutation]
  );

  const ListHeader = (
    <View style={styles.listHeader}>
      <View style={styles.headerBar}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Quotations</Text>
        <View style={{ width: 40 }} />
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

      {!isLoading && (
        <Text style={styles.countText}>
          {total} {total === 1 ? "quotation" : "quotations"}
        </Text>
      )}
    </View>
  );

  const renderItem = ({ item }: { item: typeof docs[0] }) => (
    <PressableRow style={styles.docRow} onPress={() => {}}>
      <View style={styles.docLeft}>
        <Text style={styles.docNumber}>{item.invoiceNumber}</Text>
        <Text style={styles.partyName} numberOfLines={1}>
          {item.partyName}
        </Text>
        <Text style={styles.docDate}>{formatDate(item.invoiceDate)}</Text>
      </View>
      <View style={styles.docRight}>
        <Text style={styles.docAmount}>{formatCurrency(item.totalAmount)}</Text>
        <StatusBadge status={item.status} />
        {item.status !== "cancelled" && (
          <TouchableOpacity
            style={styles.convertBtn}
            onPress={() => handleConvert(item.id, item.invoiceNumber)}
            activeOpacity={0.7}
            disabled={convertMutation.isPending}
          >
            {convertMutation.isPending ? (
              <ActivityIndicator size={10} color={colors.brand} />
            ) : (
              <Text style={styles.convertBtnText}>To Invoice</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </PressableRow>
  );

  const ListEmpty = isError ? (
    <QueryError message="Failed to load quotations" onRetry={refetch} />
  ) : isLoading ? null : (
    <EmptyState
      icon="document-text-outline"
      title="No quotations found"
      description={search ? "Try a different search term" : "Create your first quotation"}
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

      <FAB onPress={() => router.push("/(more)/quotations/create" as never)} />
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
  statusFilterBtnActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
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
  docNumber: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  partyName: { fontSize: 13, color: colors.textSecondary },
  docDate: { fontSize: 11, color: colors.textMuted },
  docRight: { alignItems: "flex-end", gap: 6 },
  docAmount: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  convertBtn: {
    backgroundColor: colors.brandLight,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.brand + "40",
  },
  convertBtnText: { fontSize: 10, fontWeight: "700", color: colors.brand },
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
