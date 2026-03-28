import { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../src/lib/trpc";
import { formatCurrency } from "../../../src/lib/utils";
import { colors } from "../../../src/lib/theme";
import { FAB, SearchBar, PressableRow, EmptyState, QueryError } from "../../../src/components/ui";

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
      <PressableRow
        style={styles.listItem}
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
      </PressableRow>
    );
  };

  const renderEmpty = () => {
    if (isLoading) return null;
    return (
      <EmptyState
        icon="people-outline"
        title={`No ${activeTab}s found`}
        description={search ? "Try a different search term" : `Add your first ${activeTab} using the + button`}
      />
    );
  };

  const renderFooter = () => {
    if (!isLoading || parties.length === 0) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator color={colors.brand} />
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
        <SearchBar
          value={search}
          onChangeText={handleSearch}
          placeholder={`Search ${activeTab}s...`}
        />
      </View>

      {/* Party List */}
      {isLoading && page === 1 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.brand} size="large" />
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
          contentContainerStyle={[parties.length === 0 ? styles.listEmpty : undefined, { paddingBottom: 100 }]}
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

      <FAB onPress={() => router.push("/(app)/(parties)/create" as never)} />
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
  segmentedControl: {
    flexDirection: "row",
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 9,
  },
  segmentTabActive: {
    backgroundColor: colors.brand,
  },
  segmentTabText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textMuted,
  },
  segmentTabTextActive: {
    color: colors.textPrimary,
  },
  searchContainer: {
    marginHorizontal: 20,
    marginBottom: 12,
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
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(99,102,241,0.3)",
  },
  avatarText: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.brand,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: 2,
  },
  itemSecondary: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  itemSecondaryMuted: {
    fontSize: 13,
    color: colors.textMuted,
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
    color: colors.success,
  },
  balanceRed: {
    color: colors.danger,
  },
  balanceLabel: {
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
