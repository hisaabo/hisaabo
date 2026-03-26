import { useState, useCallback } from "react";
import {
  View,
  Text,
  SafeAreaView,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";
import { formatCurrency, formatDateShort } from "../../../../src/lib/utils";

type PaymentMode = "cash" | "bank" | "upi" | "cheque" | "other";

const MODE_COLORS: Record<PaymentMode, { bg: string; text: string }> = {
  cash: { bg: "rgba(34, 197, 94, 0.15)", text: "#22c55e" },
  upi: { bg: "rgba(168, 85, 247, 0.15)", text: "#a855f7" },
  bank: { bg: "rgba(59, 130, 246, 0.15)", text: "#3b82f6" },
  cheque: { bg: "rgba(245, 158, 11, 0.15)", text: "#f59e0b" },
  other: { bg: "rgba(156, 163, 175, 0.15)", text: "#9ca3af" },
};

function ModeBadge({ mode }: { mode: string }) {
  const colors = MODE_COLORS[mode as PaymentMode] ?? MODE_COLORS.other;
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <Text style={[styles.badgeText, { color: colors.text }]}>
        {mode.charAt(0).toUpperCase() + mode.slice(1)}
      </Text>
    </View>
  );
}

const PAGE_SIZE = 20;

export default function PaymentsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data, isLoading, refetch } = trpc.payment.list.useQuery({
    page,
    limit: PAGE_SIZE,
    search: search.length > 0 ? search : undefined,
  });

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setPage(1);
    await refetch();
    setIsRefreshing(false);
  }, [refetch]);

  const handleSearch = useCallback((text: string) => {
    setSearch(text);
    setPage(1);
  }, []);

  const handleItemPress = useCallback((payment: { paymentNumber: string | null; partyName: string; amount: string }) => {
    Alert.alert(
      payment.paymentNumber ?? "Payment",
      `Party: ${payment.partyName}\nAmount: ${formatCurrency(payment.amount)}`,
      [{ text: "Close" }]
    );
  }, []);

  const payments = data?.data ?? [];

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.title}>Payments</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Search Bar */}
      <View style={styles.searchWrapper}>
        <Ionicons name="search-outline" size={18} color="#6b7280" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search payments or parties..."
          placeholderTextColor="#6b7280"
          value={search}
          onChangeText={handleSearch}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => handleSearch("")}>
            <Ionicons name="close-circle" size={18} color="#6b7280" />
          </TouchableOpacity>
        )}
      </View>

      {/* List */}
      {isLoading && !data ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#6366f1" size="large" />
        </View>
      ) : (
        <FlatList
          data={payments}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor="#6366f1"
            />
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="card-outline" size={48} color="#2d2d44" />
              <Text style={styles.emptyText}>No payments found</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => handleItemPress(item)}
              activeOpacity={0.7}
            >
              <View style={styles.cardRow}>
                <View style={styles.cardLeft}>
                  <Text style={styles.paymentNumber}>{item.paymentNumber}</Text>
                  <Text style={styles.partyName} numberOfLines={1}>{item.partyName}</Text>
                </View>
                <Text style={styles.amount}>{formatCurrency(item.amount)}</Text>
              </View>
              <View style={styles.cardFooter}>
                <Text style={styles.date}>
                  {item.paymentDate ? formatDateShort(item.paymentDate) : "—"}
                </Text>
                <ModeBadge mode={item.mode} />
              </View>
            </TouchableOpacity>
          )}
          onEndReached={() => {
            if (data && page * PAGE_SIZE < data.total) {
              setPage((p) => p + 1);
            }
          }}
          onEndReachedThreshold={0.4}
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push("/(more)/payments/create")}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color="#ffffff" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f1a" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#2d2d44",
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "700", color: "#ffffff" },
  searchWrapper: {
    flexDirection: "row",
    alignItems: "center",
    margin: 16,
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2d2d44",
    paddingHorizontal: 12,
    height: 44,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    color: "#ffffff",
    fontSize: 14,
    height: "100%",
  },
  listContent: { paddingHorizontal: 16, paddingBottom: 100 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80 },
  emptyText: { color: "#6b7280", marginTop: 12, fontSize: 14 },
  card: {
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2d2d44",
    padding: 14,
    marginBottom: 10,
  },
  cardRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  cardLeft: { flex: 1, marginRight: 12 },
  paymentNumber: { fontSize: 13, fontWeight: "600", color: "#9ca3af" },
  partyName: { fontSize: 16, fontWeight: "600", color: "#ffffff", marginTop: 2 },
  amount: { fontSize: 17, fontWeight: "700", color: "#ffffff" },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#2d2d44",
  },
  date: { fontSize: 12, color: "#6b7280" },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: { fontSize: 11, fontWeight: "600", textTransform: "capitalize" },
  fab: {
    position: "absolute",
    bottom: 32,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#6366f1",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#6366f1",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
});
