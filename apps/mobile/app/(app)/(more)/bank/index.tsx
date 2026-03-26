import {
  View,
  Text,
  SafeAreaView,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";
import { formatCurrency } from "../../../../src/lib/utils";

type AccountType = "savings" | "current" | "cash" | "upi" | "credit" | "other";

const ACCOUNT_TYPE_CONFIG: Record<AccountType, { label: string; color: string; bg: string; icon: string }> = {
  savings: { label: "Savings", color: "#3b82f6", bg: "rgba(59,130,246,0.15)", icon: "card-outline" },
  current: { label: "Current", color: "#6366f1", bg: "rgba(99,102,241,0.15)", icon: "business-outline" },
  cash: { label: "Cash", color: "#22c55e", bg: "rgba(34,197,94,0.15)", icon: "cash-outline" },
  upi: { label: "UPI", color: "#a855f7", bg: "rgba(168,85,247,0.15)", icon: "phone-portrait-outline" },
  credit: { label: "Credit", color: "#f59e0b", bg: "rgba(245,158,11,0.15)", icon: "wallet-outline" },
  other: { label: "Other", color: "#9ca3af", bg: "rgba(156,163,175,0.15)", icon: "ellipsis-horizontal-outline" },
};

function AccountTypeBadge({ type }: { type: string }) {
  const config = ACCOUNT_TYPE_CONFIG[type as AccountType] ?? ACCOUNT_TYPE_CONFIG.other;
  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <Text style={[styles.badgeText, { color: config.color }]}>{config.label}</Text>
    </View>
  );
}

export default function BankAccountsScreen() {
  const router = useRouter();

  const { data: accounts, isLoading: accountsLoading } = trpc.bankAccount.list.useQuery();
  const { data: summary, isLoading: summaryLoading } = trpc.bankAccount.summary.useQuery();

  const isLoading = accountsLoading || summaryLoading;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.title}>Cash & Bank</Text>
        <View style={{ width: 40 }} />
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#6366f1" size="large" />
        </View>
      ) : (
        <FlatList
          data={accounts ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            summary ? (
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>Total Balance</Text>
                <Text style={styles.summaryTotal}>{formatCurrency(summary.totalBalance)}</Text>
                <View style={styles.summaryRow}>
                  <View style={styles.summaryItem}>
                    <View style={[styles.summaryDot, { backgroundColor: "#22c55e" }]} />
                    <Text style={styles.summaryItemLabel}>Cash in Hand</Text>
                    <Text style={styles.summaryItemValue}>{formatCurrency(summary.cashInHand)}</Text>
                  </View>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryItem}>
                    <View style={[styles.summaryDot, { backgroundColor: "#3b82f6" }]} />
                    <Text style={styles.summaryItemLabel}>Bank Balance</Text>
                    <Text style={styles.summaryItemValue}>{formatCurrency(summary.bankBalance)}</Text>
                  </View>
                </View>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="wallet-outline" size={48} color="#2d2d44" />
              <Text style={styles.emptyText}>No accounts found</Text>
              <Text style={styles.emptySubtext}>Add a cash or bank account to get started</Text>
            </View>
          }
          renderItem={({ item }) => {
            const config = ACCOUNT_TYPE_CONFIG[item.accountType as AccountType] ?? ACCOUNT_TYPE_CONFIG.other;
            const balance = parseFloat(item.currentBalance || "0");
            const isNegative = balance < 0;
            return (
              <TouchableOpacity
                style={styles.accountCard}
                onPress={() => Alert.alert(item.accountName, "Transaction history coming soon")}
                activeOpacity={0.7}
              >
                <View style={[styles.accountIcon, { backgroundColor: config.bg }]}>
                  <Ionicons name={config.icon as any} size={22} color={config.color} />
                </View>
                <View style={styles.accountInfo}>
                  <View style={styles.accountNameRow}>
                    <Text style={styles.accountName}>{item.accountName}</Text>
                    {item.isDefault && (
                      <View style={styles.defaultBadge}>
                        <Text style={styles.defaultBadgeText}>Default</Text>
                      </View>
                    )}
                  </View>
                  {item.bankName ? (
                    <Text style={styles.bankName}>{item.bankName}</Text>
                  ) : null}
                  {item.accountNumber ? (
                    <Text style={styles.accountNumber}>
                      ****{item.accountNumber.slice(-4)}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.accountRight}>
                  <AccountTypeBadge type={item.accountType} />
                  <Text style={[styles.balance, isNegative && styles.balanceNegative]}>
                    {formatCurrency(Math.abs(balance))}
                    {isNegative ? " Dr" : ""}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
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
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80 },
  emptyText: { color: "#6b7280", marginTop: 12, fontSize: 15, fontWeight: "600" },
  emptySubtext: { color: "#6b7280", marginTop: 4, fontSize: 13, textAlign: "center", paddingHorizontal: 40 },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },

  // Summary Card
  summaryCard: {
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#2d2d44",
    padding: 20,
    marginBottom: 20,
    marginTop: 16,
  },
  summaryLabel: { fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 },
  summaryTotal: { fontSize: 30, fontWeight: "700", color: "#ffffff", marginTop: 6, marginBottom: 16 },
  summaryRow: { flexDirection: "row", alignItems: "center" },
  summaryItem: { flex: 1, gap: 4 },
  summaryDot: { width: 8, height: 8, borderRadius: 4, marginBottom: 2 },
  summaryItemLabel: { fontSize: 12, color: "#6b7280" },
  summaryItemValue: { fontSize: 16, fontWeight: "700", color: "#ffffff" },
  summaryDivider: { width: 1, height: 40, backgroundColor: "#2d2d44", marginHorizontal: 16 },

  // Account Card
  accountCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a2e",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2d2d44",
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  accountIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  accountInfo: { flex: 1 },
  accountNameRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  accountName: { fontSize: 15, fontWeight: "600", color: "#ffffff" },
  bankName: { fontSize: 12, color: "#9ca3af", marginTop: 2 },
  accountNumber: { fontSize: 12, color: "#6b7280", marginTop: 1 },
  accountRight: { alignItems: "flex-end", gap: 6 },
  balance: { fontSize: 16, fontWeight: "700", color: "#ffffff" },
  balanceNegative: { color: "#ef4444" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: "600" },
  defaultBadge: {
    backgroundColor: "rgba(99,102,241,0.15)",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  defaultBadgeText: { fontSize: 10, fontWeight: "600", color: "#6366f1" },
});
