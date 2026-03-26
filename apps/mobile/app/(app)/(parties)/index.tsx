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

type PartyType = "customer" | "supplier";

export default function PartiesScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<PartyType>("customer");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } =
    trpc.party.list.useQuery({
      type: activeTab,
      search: search || undefined,
      page,
      limit: 20,
    });

  const parties = data?.data ?? [];
  const total = data?.total ?? 0;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(1);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleTabChange = (tab: PartyType) => {
    setActiveTab(tab);
    setPage(1);
    setSearch("");
  };

  const handleSearch = (text: string) => {
    setSearch(text);
    setPage(1);
  };

  const loadMore = () => {
    if (parties.length < total && !isLoading) {
      setPage((p) => p + 1);
    }
  };

  const renderItem = ({ item }: { item: (typeof parties)[0] }) => {
    const balance = parseFloat(item.openingBalance || "0");
    const isReceivable = balance >= 0;

    return (
      <TouchableOpacity
        style={styles.listItem}
        activeOpacity={0.7}
        onPress={() => router.push(`/(app)/(parties)/${item.id}` as never)}
      >
        <View style={styles.itemLeft}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>
              {item.name.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.itemInfo}>
            <Text style={styles.itemName} numberOfLines={1}>
              {item.name}
            </Text>
            {item.phone ? (
              <Text style={styles.itemSecondary}>{item.phone}</Text>
            ) : (
              <Text style={styles.itemSecondaryMuted}>No phone</Text>
            )}
          </View>
        </View>
        <View style={styles.itemRight}>
          <Text
            style={[
              styles.balanceText,
              isReceivable ? styles.balanceGreen : styles.balanceRed,
            ]}
          >
            {formatCurrency(Math.abs(balance))}
          </Text>
          <Text style={styles.balanceLabel}>
            {isReceivable ? "Receivable" : "Payable"}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmpty = () => {
    if (isLoading) return null;
    return (
      <View style={styles.emptyState}>
        <Ionicons name="people-outline" size={56} color="#2d2d44" />
        <Text style={styles.emptyTitle}>No {activeTab}s found</Text>
        <Text style={styles.emptySubtitle}>
          {search
            ? "Try a different search term"
            : `Add your first ${activeTab} using the + button`}
        </Text>
      </View>
    );
  };

  const renderFooter = () => {
    if (!isLoading || parties.length === 0) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.screenTitle}>Parties</Text>
        <Text style={styles.countBadge}>{total}</Text>
      </View>

      {/* Segmented Control */}
      <View style={styles.segmentedControl}>
        <TouchableOpacity
          style={[
            styles.segmentTab,
            activeTab === "customer" && styles.segmentTabActive,
          ]}
          onPress={() => handleTabChange("customer")}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.segmentTabText,
              activeTab === "customer" && styles.segmentTabTextActive,
            ]}
          >
            Customers
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.segmentTab,
            activeTab === "supplier" && styles.segmentTabActive,
          ]}
          onPress={() => handleTabChange("supplier")}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.segmentTabText,
              activeTab === "supplier" && styles.segmentTabTextActive,
            ]}
          >
            Suppliers
          </Text>
        </TouchableOpacity>
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
          placeholder={`Search ${activeTab}s...`}
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

      {/* Party List */}
      {isLoading && page === 1 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color="#6366f1" size="large" />
        </View>
      ) : (
        <FlatList
          data={parties}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          contentContainerStyle={parties.length === 0 ? styles.listEmpty : undefined}
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
        onPress={() => router.push("/(app)/(parties)/create" as never)}
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
  segmentedControl: {
    flexDirection: "row",
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: "#2d2d44",
  },
  segmentTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 9,
  },
  segmentTabActive: {
    backgroundColor: "#6366f1",
  },
  segmentTabText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#6b7280",
  },
  segmentTabTextActive: {
    color: "#ffffff",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 20,
    marginBottom: 12,
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
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(99,102,241,0.2)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(99,102,241,0.3)",
  },
  avatarText: {
    fontSize: 17,
    fontWeight: "700",
    color: "#6366f1",
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#ffffff",
    marginBottom: 2,
  },
  itemSecondary: {
    fontSize: 13,
    color: "#9ca3af",
  },
  itemSecondaryMuted: {
    fontSize: 13,
    color: "#6b7280",
    fontStyle: "italic",
  },
  itemRight: {
    alignItems: "flex-end",
    gap: 2,
  },
  balanceText: {
    fontSize: 15,
    fontWeight: "700",
  },
  balanceGreen: {
    color: "#10b981",
  },
  balanceRed: {
    color: "#ef4444",
  },
  balanceLabel: {
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
