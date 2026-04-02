import { useState, useCallback, useEffect } from "react";
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
import { formatCurrency } from "../../../src/lib/utils";
import { colors } from "../../../src/lib/theme";
import { FAB, SearchBar, PressableRow, EmptyState } from "../../../src/components/ui";

type ItemTypeFilter = "product" | "service" | null;

export default function ItemsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [itemType, setItemType] = useState<ItemTypeFilter>(null);
  const [lowStock, setLowStock] = useState(false);
  const [page, setPage] = useState(1);
  const [allItems, setAllItems] = useState<NonNullable<typeof data>["data"]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, isFetching, refetch } = trpc.item.list.useQuery(
    {
      search: search || undefined,
      itemType: itemType || undefined,
      lowStock: lowStock || undefined,
      page,
      limit: 20,
    },
    { placeholderData: (prev) => prev }
  );

  const total = data?.total ?? 0;

  // Accumulate pages — reset on page 1, append on subsequent pages
  useEffect(() => {
    if (data?.data) {
      setAllItems((prev) => {
        if (page === 1) return data.data;
        const existingIds = new Set(prev.map((i) => i.id));
        const newItems = data.data.filter((i) => !existingIds.has(i.id));
        return [...prev, ...newItems];
      });
    }
  }, [data?.data, page]);

  // Reset accumulation when filters change
  useEffect(() => {
    setPage(1);
    setAllItems([]);
  }, [search, itemType, lowStock]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(1);
    setAllItems([]);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleSearch = (text: string) => {
    setSearch(text);
  };

  const loadMore = () => {
    if (!isFetching && data && allItems.length < total) {
      setPage((p) => p + 1);
    }
  };

  const isLowStock = (item: (typeof allItems)[0]) => {
    if (item.itemMode === "variants") return false;
    if (!item.lowStockAlert) return false;
    return (
      parseFloat(item.stockQuantity ?? "0") <=
      parseFloat(item.lowStockAlert ?? "0")
    );
  };

  const renderItem = ({ item }: { item: (typeof allItems)[0] }) => {
    const itemLowStock = isLowStock(item);
    const isVariant = item.itemMode === "variants";
    const isAltUnit = item.itemMode === "alt_units";

    return (
      <PressableRow
        style={styles.listItem}
        onPress={() => router.push(`/(app)/(items)/${item.id}` as never)}
      >
        <View style={styles.itemLeft}>
          <View
            style={[
              styles.itemIconBox,
              item.itemType === "service"
                ? styles.itemIconBoxService
                : styles.itemIconBoxProduct,
            ]}
          >
            <Ionicons
              name={
                item.itemType === "service" ? "briefcase-outline" : "cube-outline"
              }
              size={20}
              color={item.itemType === "service" ? "#8b5cf6" : colors.brand}
            />
          </View>
          <View style={styles.itemInfo}>
            <View style={styles.itemNameRow}>
              <Text style={styles.itemName} numberOfLines={1}>
                {item.name}
              </Text>
              {isVariant && (
                <View style={styles.badgeVariant}>
                  <Text style={styles.badgeText}>VAR</Text>
                </View>
              )}
              {isAltUnit && (
                <View style={styles.badgeAltUnit}>
                  <Text style={styles.badgeText}>ALT</Text>
                </View>
              )}
            </View>
            {item.sku ? (
              <Text style={styles.itemSku}>{item.sku}</Text>
            ) : null}
            {item.itemType === "product" && !isVariant && (
              <Text
                style={[
                  styles.stockText,
                  itemLowStock ? styles.stockLow : styles.stockNormal,
                ]}
              >
                {itemLowStock && (
                  <Ionicons name="warning-outline" size={11} color={colors.warning} />
                )}{" "}
                {parseFloat(item.stockQuantity ?? "0").toFixed(
                  parseFloat(item.stockQuantity ?? "0") % 1 === 0 ? 0 : 2
                )}{" "}
                {item.unit}
                {itemLowStock ? " · Low stock" : ""}
              </Text>
            )}
            {isVariant && (
              <Text style={styles.stockText}>
                {item.variantCount ?? 0} variants ·{" "}
                {parseFloat(item.variantTotalStock ?? "0").toFixed(0)}{" "}
                {item.unit} total
              </Text>
            )}
          </View>
        </View>
        <View style={styles.itemRight}>
          <Text style={styles.salePrice}>
            {item.salePrice ? formatCurrency(item.salePrice) : "—"}
          </Text>
          <Text style={styles.priceLabel}>Sale price</Text>
        </View>
      </PressableRow>
    );
  };

  const renderEmpty = () => {
    if (isLoading) return null;
    return (
      <EmptyState
        icon="cube-outline"
        title="No items found"
        description={search ? "Try a different search term" : "Add your first item using the + button"}
      />
    );
  };

  const renderFooter = () => {
    if (!isFetching || allItems.length === 0) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.screenTitle}>Items</Text>
        <Text style={styles.countBadge}>{total}</Text>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <SearchBar
          value={search}
          onChangeText={handleSearch}
          placeholder="Search items..."
        />
      </View>

      {/* Filter Row */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[
            styles.filterChip,
            itemType === null && styles.filterChipActive,
          ]}
          onPress={() => {
            setItemType(null);
          }}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.filterChipText,
              itemType === null && styles.filterChipTextActive,
            ]}
          >
            All
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.filterChip,
            itemType === "product" && styles.filterChipActive,
          ]}
          onPress={() => {
            setItemType("product");
          }}
          activeOpacity={0.7}
        >
          <Ionicons
            name="cube-outline"
            size={13}
            color={itemType === "product" ? colors.textPrimary : colors.textMuted}
          />
          <Text
            style={[
              styles.filterChipText,
              itemType === "product" && styles.filterChipTextActive,
            ]}
          >
            Products
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.filterChip,
            itemType === "service" && styles.filterChipActive,
          ]}
          onPress={() => {
            setItemType("service");
          }}
          activeOpacity={0.7}
        >
          <Ionicons
            name="briefcase-outline"
            size={13}
            color={itemType === "service" ? colors.textPrimary : colors.textMuted}
          />
          <Text
            style={[
              styles.filterChipText,
              itemType === "service" && styles.filterChipTextActive,
            ]}
          >
            Services
          </Text>
        </TouchableOpacity>

        <View style={styles.filterSpacer} />

        <TouchableOpacity
          style={[
            styles.filterChipOutline,
            lowStock && styles.filterChipOutlineActive,
          ]}
          onPress={() => {
            setLowStock((v) => !v);
          }}
          activeOpacity={0.7}
        >
          <Ionicons
            name="warning-outline"
            size={13}
            color={lowStock ? colors.warning : colors.textMuted}
          />
          <Text
            style={[
              styles.filterChipText,
              lowStock && styles.filterChipTextWarning,
            ]}
          >
            Low Stock
          </Text>
        </TouchableOpacity>
      </View>

      {/* Item List */}
      {isLoading && page === 1 && allItems.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      ) : (
        <FlatList
          data={allItems}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          contentContainerStyle={[allItems.length === 0 ? styles.listEmpty : undefined, { paddingBottom: 100 }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.brand}
              colors={[colors.brand]}
            />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          keyboardDismissMode="on-drag"
        />
      )}

      <FAB onPress={() => router.push("/(app)/(items)/create" as never)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 10,
  },
  screenTitle: {
    fontSize: 26,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  countBadge: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.brand,
    backgroundColor: colors.brandLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: "hidden",
  },
  searchContainer: {
    marginHorizontal: 20,
    marginBottom: 10,
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 12,
    gap: 8,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  filterChipOutline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipOutlineActive: {
    borderColor: colors.warning,
    backgroundColor: "rgba(245,158,11,0.1)",
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
  },
  filterChipTextActive: {
    color: colors.textPrimary,
  },
  filterChipTextWarning: {
    color: colors.warning,
  },
  filterSpacer: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  listEmpty: {
    flex: 1,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: colors.bg,
  },
  itemLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 12,
  },
  itemIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  itemIconBoxProduct: {
    backgroundColor: colors.brandLight,
    borderWidth: 1,
    borderColor: "rgba(99,102,241,0.25)",
  },
  itemIconBoxService: {
    backgroundColor: "rgba(139,92,246,0.15)",
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.25)",
  },
  itemInfo: {
    flex: 1,
    gap: 2,
  },
  itemNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  itemName: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textPrimary,
    flex: 1,
  },
  itemSku: {
    fontSize: 12,
    color: colors.textMuted,
    fontFamily: "monospace",
  },
  stockText: {
    fontSize: 12,
    marginTop: 1,
  },
  stockNormal: {
    color: colors.textMuted,
  },
  stockLow: {
    color: colors.warning,
  },
  badgeVariant: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: "rgba(139,92,246,0.2)",
  },
  badgeAltUnit: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: "rgba(20,184,166,0.2)",
  },
  badgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#a78bfa",
    letterSpacing: 0.5,
  },
  itemRight: {
    alignItems: "flex-end",
    gap: 2,
  },
  salePrice: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  priceLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
  separator: {
    height: 1,
    backgroundColor: colors.surface,
    marginLeft: 76,
  },
  footer: {
    paddingVertical: 20,
    alignItems: "center",
  },
});
