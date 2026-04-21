import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { trpc } from "../../../src/lib/trpc";
import { useBusinessStore } from "../../../src/stores/business";
import { formatCurrency, formatDate } from "../../../src/lib/utils";
import { accumulatePages } from "../../../src/lib/accumulate-pages";
import { makeStyles } from "../../../src/lib/makeStyles";
import { useColors } from "../../../src/contexts/ThemeContext";
import {
  StatusBadge,
  FAB,
  SearchBar,
  PressableRow,
  EmptyState,
  QueryError,
} from "../../../src/components/ui";

type InvoiceType = "sale" | "purchase";
type StatusFilter = "all" | "unpaid" | "draft" | "sent" | "partial" | "overdue" | "paid" | "cancelled";

const UNPAID_STATUSES = ["sent", "partial", "overdue"] as const;

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unpaid", label: "Unpaid" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "partial", label: "Partial" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
  { key: "cancelled", label: "Cancelled" },
];

const PAGE_SIZE = 20;

export default function InvoicesScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string; status?: string }>();
  const { businessId } = useBusinessStore();
  const [invoiceType, setInvoiceType] = useState<InvoiceType>((params.type as InvoiceType) || "sale");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>((params.status as StatusFilter) || "all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [allInvoices, setAllInvoices] = useState<NonNullable<typeof data>["data"]>([]);

  // Sync route params to state when navigating from other screens (e.g. home dashboard)
  useEffect(() => {
    if (params.type) setInvoiceType(params.type as InvoiceType);
    if (params.status) setStatusFilter(params.status as StatusFilter);
  }, [params.type, params.status]);

  const queryInput = {
    type: invoiceType,
    status: statusFilter === "all" ? undefined : statusFilter === "unpaid" ? [...UNPAID_STATUSES] : (statusFilter as Exclude<StatusFilter, "all" | "unpaid">),
    search: search.length > 0 ? search : undefined,
    page,
    limit: PAGE_SIZE,
    documentType: "invoice" as const,
  };

  const { data, isLoading, isFetching, isError, refetch, isRefetching } =
    trpc.invoice.list.useQuery(queryInput, { enabled: !!businessId, placeholderData: (prev) => prev });

  const total = data?.total ?? 0;
  const hasMore = allInvoices.length < total;

  useEffect(() => {
    if (data?.data) {
      setAllInvoices((prev) => accumulatePages(prev, data.data, page));
    }
  }, [data?.data, page]);

  // Reset accumulation when filters change
  useEffect(() => {
    setPage(1);
    setAllInvoices([]);
  }, [invoiceType, statusFilter, search]);

  const handleTypeToggle = useCallback((type: InvoiceType) => {
    setInvoiceType(type);
    setStatusFilter("all");
    setSearch("");
  }, []);

  const handleStatusFilter = useCallback((status: StatusFilter) => {
    setStatusFilter(status);
  }, []);

  const handleSearchChange = useCallback((text: string) => {
    setSearch(text);
  }, []);

  const handleLoadMore = useCallback(() => {
    if (hasMore && !isFetching) {
      setPage((p) => p + 1);
    }
  }, [hasMore, isFetching]);

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
        <SearchBar
          value={search}
          onChangeText={handleSearchChange}
          placeholder="Search by invoice # or party..."
        />
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

  const renderItem = ({ item }: { item: typeof allInvoices[0] }) => (
    <PressableRow
      style={styles.invoiceRow}
      onPress={() => router.push(`/(invoices)/${item.id}` as never)}
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
    </PressableRow>
  );

  const ListEmpty = isError ? (
    <QueryError message="Failed to load invoices" onRetry={refetch} />
  ) : isLoading ? null : (
    <EmptyState
      icon="receipt-outline"
      title="No invoices found"
      description={search ? "Try a different search term" : "Create your first invoice"}
    />
  );

  const ListFooter = isFetching && allInvoices.length > 0 ? (
    <View style={styles.loadingFooter}>
      <ActivityIndicator color={colors.brand} />
    </View>
  ) : hasMore ? (
    <TouchableOpacity style={styles.loadMoreBtn} onPress={handleLoadMore}>
      <Text style={styles.loadMoreText}>Load more</Text>
    </TouchableOpacity>
  ) : null;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.headerBar}>
        <Text style={styles.screenTitle}>Invoices</Text>
      </View>

      <FlatList
        data={allInvoices}
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

      <FAB onPress={() => router.push("/(invoices)/create" as never)} />
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  headerBar: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textPrimary,
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
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
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
    backgroundColor: colors.brand,
  },
  typeBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
  },
  typeBtnTextActive: {
    color: colors.textPrimary,
  },
  searchWrap: {
    marginBottom: 12,
  },
  statusFilterList: {
    gap: 8,
    paddingBottom: 12,
  },
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
  statusFilterText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  statusFilterTextActive: {
    color: colors.textPrimary,
  },
  countText: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 8,
  },
  invoiceRow: {
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
  invoiceLeft: {
    flex: 1,
    paddingRight: 12,
    gap: 3,
  },
  invoiceNumber: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  partyName: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  invoiceDate: {
    fontSize: 11,
    color: colors.textMuted,
  },
  invoiceRight: {
    alignItems: "flex-end",
    gap: 6,
  },
  invoiceAmount: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.textPrimary,
  },
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
  loadMoreText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.brand,
  },
  loadingFooter: {
    paddingVertical: 20,
    alignItems: "center",
  },
}));
