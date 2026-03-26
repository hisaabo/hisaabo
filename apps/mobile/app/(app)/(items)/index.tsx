import { useState, useCallback } from "react";
import {
  View,
  Text,
  SafeAreaView,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../src/lib/trpc";
import { formatCurrency } from "../../../src/lib/utils";

type ItemTypeFilter = "product" | "service" | null;

export default function ItemsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [itemType, setItemType] = useState<ItemTypeFilter>(null);
  const [lowStock, setLowStock] = useState(false);
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = trpc.item.list.useQuery({
    search: search || undefined,
    itemType: itemType || undefined,
    lowStock: lowStock || undefined,
    page,
    limit: 20,
  });

  const items = data?.data ?? [];
  const total = data?.total ?? 0;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(1);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleSearch = (text: string) => {
    setSearch(text);
    setPage(1);
  };

  const loadMore = () => {
    if (items.length < total && !isLoading) {
      setPage((p) => p + 1);
    }
  };

  const isLowStock = (item: (typeof items)[0]) => {
    if (item.itemMode === "variants") return false;
    if (!item.lowStockAlert) return false;
    return (
      parseFloat(item.stockQuantity ?? "0") <=
      parseFloat(item.lowStockAlert ?? "0")
    );
  };

  const renderItem = ({ item }: { item: (typeof items)[0] }) => {
    const itemLowStock = isLowStock(item);
    const isVariant = item.itemMode === "variants";
    const isAltUnit = item.itemMode === "alt_units";

    return (
      <TouchableOpacity
        style={styles.listItem}
        activeOpacity={0.7}
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
              color={item.itemType === "service" ? "#8b5cf6" : "#6366f1"}
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
                  <Ionicons name="warning-outline" size={11} color="#f59e0b" />
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
      </TouchableOpacity>
    );
  };

  const renderEmpty = () => {
    if (isLoading) return null;
    return (
      <View style={styles.emptyState}>
        <Ionicons name="cube-outline" size={56} color="#2d2d44" />
        <Text style={styles.emptyTitle}>No items found</Text>
        <Text style={styles.emptySubtitle}>
          {search
            ? "Try a different search term"
            : "Add your first item using the + button"}
        </Text>
      </View>
    );
  };

  const renderFooter = () => {
    if (page === 1 || items.length >= total) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator color="#6366f1" />
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
        <Ionicons
          name="search-outline"
          size={18}
          color="#6b7280"
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          placeholder="Search items..."
          placeholderTextColor="#6b7280"
          value={search}
          onChangeText={handleSearch}
          returnKeyType="search"
          autoCapitalize="none"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => handleSearch("")}>
            <Ionicons name="close-circle" size={18} color="#6b7280" />
          </TouchableOpacity>
        )}
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
            setPage(1);
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
            setPage(1);
          }}
          activeOpacity={0.7}
        >
          <Ionicons
            name="cube-outline"
            size={13}
            color={itemType === "product" ? "#ffffff" : "#6b7280"}
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
            setPage(1);
          }}
          activeOpacity={0.7}
        >
          <Ionicons
            name="briefcase-outline"
            size={13}
            color={itemType === "service" ? "#ffffff" : "#6b7280"}
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
            setPage(1);
          }}
          activeOpacity={0.7}
        >
          <Ionicons
            name="warning-outline"
            size={13}
            color={lowStock ? "#f59e0b" : "#6b7280"}
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
      {isLoading && page === 1 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color="#6366f1" size="large" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          contentContainerStyle={items.length === 0 ? styles.listEmpty : undefined}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#6366f1"
              colors={["#6366f1"]}
            />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.85}
        onPress={() => router.push("/(app)/(items)/create" as never)}
      >
        <Ionicons name="add" size={28} color="#ffffff" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f0f1a",
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
    color: "#ffffff",
  },
  countBadge: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6366f1",
    backgroundColor: "rgba(99,102,241,0.15)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: "hidden",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 20,
    marginBottom: 10,
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2d2d44",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: "#ffffff",
    fontSize: 15,
    padding: 0,
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
    backgroundColor: "#1a1a2e",
    borderWidth: 1,
    borderColor: "#2d2d44",
  },
  filterChipActive: {
    backgroundColor: "#6366f1",
    borderColor: "#6366f1",
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
    borderColor: "#2d2d44",
  },
  filterChipOutlineActive: {
    borderColor: "#f59e0b",
    backgroundColor: "rgba(245,158,11,0.1)",
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6b7280",
  },
  filterChipTextActive: {
    color: "#ffffff",
  },
  filterChipTextWarning: {
    color: "#f59e0b",
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
    backgroundColor: "#0f0f1a",
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
    backgroundColor: "rgba(99,102,241,0.15)",
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
    color: "#ffffff",
    flex: 1,
  },
  itemSku: {
    fontSize: 12,
    color: "#6b7280",
    fontFamily: "monospace",
  },
  stockText: {
    fontSize: 12,
    marginTop: 1,
  },
  stockNormal: {
    color: "#6b7280",
  },
  stockLow: {
    color: "#f59e0b",
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
    color: "#ffffff",
  },
  priceLabel: {
    fontSize: 11,
    color: "#6b7280",
  },
  separator: {
    height: 1,
    backgroundColor: "#1a1a2e",
    marginLeft: 76,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#ffffff",
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 20,
  },
  footer: {
    paddingVertical: 20,
    alignItems: "center",
  },
  fab: {
    position: "absolute",
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#6366f1",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#6366f1",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
});
