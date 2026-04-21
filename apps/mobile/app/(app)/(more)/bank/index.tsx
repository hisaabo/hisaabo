import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";
import { formatCurrency } from "../../../../src/lib/utils";
import { makeStyles } from "../../../../src/lib/makeStyles";
import { useColors } from "../../../../src/contexts/ThemeContext";
import { PressableRow, EmptyState, FAB } from "../../../../src/components/ui";

type AccountType = "savings" | "current" | "cash" | "upi" | "credit" | "payment_gateway" | "other";

const ACCOUNT_TYPE_CONFIG: Record<AccountType, { label: string; color: string; bg: string; icon: string }> = {
  savings: { label: "Savings", color: "#3b82f6", bg: "rgba(59,130,246,0.15)", icon: "card-outline" },
  current: { label: "Current", color: "#6366f1", bg: "rgba(99,102,241,0.15)", icon: "business-outline" },
  cash: { label: "Cash", color: "#22c55e", bg: "rgba(34,197,94,0.15)", icon: "cash-outline" },
  upi: { label: "UPI", color: "#a855f7", bg: "rgba(168,85,247,0.15)", icon: "phone-portrait-outline" },
  credit: { label: "Credit Card", color: "#f59e0b", bg: "rgba(245,158,11,0.15)", icon: "wallet-outline" },
  payment_gateway: { label: "Gateway", color: "#ec4899", bg: "rgba(236,72,153,0.15)", icon: "globe-outline" },
  other: { label: "Other", color: "#9ca3af", bg: "rgba(156,163,175,0.15)", icon: "ellipsis-horizontal-outline" },
};

function AccountTypeBadge({ type }: { type: string }) {
  const styles = useStyles();
  const config = ACCOUNT_TYPE_CONFIG[type as AccountType] ?? ACCOUNT_TYPE_CONFIG.other;
  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <Text style={[styles.badgeText, { color: config.color }]}>{config.label}</Text>
    </View>
  );
}

export default function BankAccountsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();

  const { data: accounts, isLoading: accountsLoading } = trpc.bankAccount.list.useQuery();
  const { data: summary, isLoading: summaryLoading } = trpc.bankAccount.summary.useQuery();

  const isLoading = accountsLoading || summaryLoading;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Cash & Bank</Text>
        <TouchableOpacity
          style={styles.transferBtn}
          onPress={() => router.push("/(more)/bank/transfer" as never)}
          activeOpacity={0.7}
        >
          <Ionicons name="swap-horizontal-outline" size={22} color={colors.brand} />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.brand} size="large" />
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
                    <View style={[styles.summaryDot, { backgroundColor: colors.success }]} />
                    <Text style={styles.summaryItemLabel}>Cash in Hand</Text>
                    <Text style={styles.summaryItemValue}>{formatCurrency(summary.cashInHand)}</Text>
                  </View>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryItem}>
                    <View style={[styles.summaryDot, { backgroundColor: colors.info }]} />
                    <Text style={styles.summaryItemLabel}>Bank Balance</Text>
                    <Text style={styles.summaryItemValue}>{formatCurrency(summary.bankBalance)}</Text>
                  </View>
                </View>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="wallet-outline"
              title="No accounts found"
              description="Add a cash or bank account to get started"
            />
          }
          renderItem={({ item }) => {
            const config = ACCOUNT_TYPE_CONFIG[item.accountType as AccountType] ?? ACCOUNT_TYPE_CONFIG.other;
            const balance = parseFloat(item.currentBalance || "0");
            const isNegative = balance < 0;
            return (
              <PressableRow
                style={styles.accountCard}
                onPress={() => router.push(`/(more)/bank/${item.id}` as never)}
              >
                <View style={[styles.accountIcon, { backgroundColor: config.bg }]}>
                  <Ionicons name={config.icon as any} size={22} color={config.color} />
                </View>
                <View style={styles.accountInfo}>
                  <View style={styles.accountNameRow}>
                    <Text style={styles.accountName}>{item.accountName}</Text>
                    {item.isDefault && (
                      <View style={styles.defaultBadge}>
                        <Ionicons name="star" size={9} color={colors.brand} />
                        <Text style={styles.defaultBadgeText}>Default</Text>
                      </View>
                    )}
                  </View>
                  {item.bankName ? <Text style={styles.bankName}>{item.bankName}</Text> : null}
                  {item.accountNumber ? (
                    <Text style={styles.accountNumber}>****{item.accountNumber.slice(-4)}</Text>
                  ) : null}
                </View>
                <View style={styles.accountRight}>
                  <AccountTypeBadge type={item.accountType} />
                  <Text style={[styles.balance, isNegative && styles.balanceNegative]}>
                    {formatCurrency(Math.abs(balance))}
                    {isNegative ? " Dr" : ""}
                  </Text>
                  <TouchableOpacity
                    style={styles.editBtn}
                    onPress={() => router.push(`/(more)/bank/edit?id=${item.id}` as never)}
                    activeOpacity={0.7}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="create-outline" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              </PressableRow>
            );
          }}
        />
      )}

      <FAB onPress={() => router.push("/(more)/bank/create" as never)} />
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  transferBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80 },
  listContent: { paddingHorizontal: 16, paddingBottom: 100 },

  // Summary Card
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    marginBottom: 20,
    marginTop: 16,
  },
  summaryLabel: { fontSize: 12, color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  summaryTotal: { fontSize: 30, fontWeight: "700", color: colors.textPrimary, marginTop: 6, marginBottom: 16 },
  summaryRow: { flexDirection: "row", alignItems: "center" },
  summaryItem: { flex: 1, gap: 4 },
  summaryDot: { width: 8, height: 8, borderRadius: 4, marginBottom: 2 },
  summaryItemLabel: { fontSize: 12, color: colors.textMuted },
  summaryItemValue: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  summaryDivider: { width: 1, height: 40, backgroundColor: colors.border, marginHorizontal: 16 },

  // Account Card
  accountCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  accountIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  accountInfo: { flex: 1 },
  accountNameRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  accountName: { fontSize: 15, fontWeight: "600", color: colors.textPrimary },
  bankName: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  accountNumber: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  accountRight: { alignItems: "flex-end", gap: 6 },
  balance: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  balanceNegative: { color: colors.danger },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: "600" },
  defaultBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: colors.brandLight,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  defaultBadgeText: { fontSize: 10, fontWeight: "600", color: colors.brand },
  editBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
}));
