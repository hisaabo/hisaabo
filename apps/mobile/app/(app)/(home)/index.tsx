import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../src/lib/trpc";
import { useBusinessStore } from "../../../src/stores/business";
import { formatCurrency, formatDate } from "../../../src/lib/utils";

const C = {
  bg: "#0f0f1a",
  surface: "#1a1a2e",
  border: "#2d2d44",
  brand: "#6366f1",
  textPrimary: "#ffffff",
  textSecondary: "#9ca3af",
  textMuted: "#6b7280",
  success: "#10b981",
  danger: "#ef4444",
  warning: "#f59e0b",
  info: "#3b82f6",
};

type StatusKey = "draft" | "unfulfilled" | "sent" | "paid" | "partial" | "overdue" | "cancelled";

const STATUS_COLORS: Record<StatusKey, { bg: string; text: string }> = {
  draft: { bg: "#374151", text: "#d1d5db" },
  unfulfilled: { bg: "#374151", text: "#d1d5db" },
  sent: { bg: "#1e3a5f", text: "#60a5fa" },
  paid: { bg: "#064e3b", text: "#34d399" },
  partial: { bg: "#451a03", text: "#fbbf24" },
  overdue: { bg: "#450a0a", text: "#f87171" },
  cancelled: { bg: "#374151", text: "#9ca3af" },
};

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status as StatusKey] ?? { bg: "#374151", text: "#d1d5db" };
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <Text style={[styles.badgeText, { color: colors.text }]}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Text>
    </View>
  );
}

interface SummaryCardProps {
  label: string;
  value: string;
  icon: string;
  iconColor: string;
  tintColor?: string;
}

function SummaryCard({ label, value, icon, iconColor, tintColor }: SummaryCardProps) {
  return (
    <View style={[styles.summaryCard, tintColor ? { borderColor: tintColor + "40" } : {}]}>
      <View style={[styles.summaryIconWrap, { backgroundColor: iconColor + "20" }]}>
        <Ionicons name={icon as "cash"} size={18} color={iconColor} />
      </View>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, tintColor ? { color: tintColor } : {}]}>{value}</Text>
    </View>
  );
}

export default function DashboardScreen() {
  const router = useRouter();
  const businessName = useBusinessStore((s) => s.businessName);

  const { data, isLoading, refetch, isRefetching } = trpc.dashboard.summary.useQuery(undefined);

  const summary = data;

  const totalSales = summary?.totalSales ?? "0";
  const totalPurchases = summary?.totalPurchases ?? "0";
  const totalExpenses = summary?.totalExpenses ?? "0";
  const receivable = summary?.receivable ?? "0";
  const payable = summary?.payable ?? "0";
  const cashInHand = summary?.cashInHand ?? "0";
  const recentInvoices = summary?.recentInvoices ?? [];

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={C.brand}
            colors={[C.brand]}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Good day,</Text>
            <Text style={styles.businessName} numberOfLines={1}>
              {businessName ?? "Your Business"}
            </Text>
          </View>
          <View style={styles.headerIcon}>
            <Ionicons name="business-outline" size={22} color={C.brand} />
          </View>
        </View>

        {isLoading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator size="large" color={C.brand} />
          </View>
        ) : (
          <>
            {/* Summary Cards Grid */}
            <Text style={styles.sectionTitle}>Financial Overview</Text>
            <View style={styles.grid}>
              <SummaryCard
                label="Total Sales"
                value={formatCurrency(totalSales)}
                icon="trending-up-outline"
                iconColor={C.success}
                tintColor={C.success}
              />
              <SummaryCard
                label="Total Purchases"
                value={formatCurrency(totalPurchases)}
                icon="cart-outline"
                iconColor={C.textSecondary}
              />
              <SummaryCard
                label="Receivable"
                value={formatCurrency(receivable)}
                icon="arrow-down-circle-outline"
                iconColor={parseFloat(receivable) > 0 ? C.warning : C.textSecondary}
                tintColor={parseFloat(receivable) > 0 ? C.warning : undefined}
              />
              <SummaryCard
                label="Payable"
                value={formatCurrency(payable)}
                icon="arrow-up-circle-outline"
                iconColor={C.danger}
              />
              <SummaryCard
                label="Cash in Hand"
                value={formatCurrency(cashInHand)}
                icon="cash-outline"
                iconColor={C.brand}
                tintColor={C.brand}
              />
              <SummaryCard
                label="Total Expenses"
                value={formatCurrency(totalExpenses)}
                icon="receipt-outline"
                iconColor={C.danger}
              />
            </View>

            {/* Recent Invoices */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent Invoices</Text>
              <TouchableOpacity onPress={() => router.push("/(invoices)")}>
                <Text style={styles.seeAll}>See all</Text>
              </TouchableOpacity>
            </View>

            {recentInvoices.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="receipt-outline" size={36} color={C.textMuted} />
                <Text style={styles.emptyText}>No invoices yet</Text>
              </View>
            ) : (
              <View style={styles.invoiceList}>
                {recentInvoices.map((inv) => (
                  <TouchableOpacity
                    key={inv.id}
                    style={styles.invoiceRow}
                    onPress={() => router.push(`/(invoices)/${inv.id}` as never)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.invoiceLeft}>
                      <Text style={styles.invoiceNumber}>{inv.invoiceNumber}</Text>
                      <Text style={styles.partyName} numberOfLines={1}>
                        {inv.partyName}
                      </Text>
                    </View>
                    <View style={styles.invoiceRight}>
                      <Text style={styles.invoiceAmount}>
                        {formatCurrency(inv.totalAmount)}
                      </Text>
                      <View style={styles.invoiceMeta}>
                        <StatusBadge status={inv.status} />
                        <Text style={styles.invoiceDate}>
                          {formatDate(inv.invoiceDate)}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 16,
    paddingBottom: 20,
  },
  greeting: {
    fontSize: 13,
    color: C.textMuted,
    fontWeight: "500",
  },
  businessName: {
    fontSize: 22,
    fontWeight: "700",
    color: C.textPrimary,
    marginTop: 2,
    maxWidth: 280,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  loaderWrap: {
    paddingTop: 80,
    alignItems: "center",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: C.textPrimary,
    marginBottom: 12,
  },
  seeAll: {
    fontSize: 13,
    color: C.brand,
    fontWeight: "600",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 24,
  },
  summaryCard: {
    width: "47.5%",
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
  },
  summaryIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  summaryLabel: {
    fontSize: 11,
    color: C.textMuted,
    fontWeight: "500",
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: "700",
    color: C.textPrimary,
  },
  badge: {
    borderRadius: 20,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "600",
  },
  emptyCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 40,
    alignItems: "center",
    gap: 10,
  },
  emptyText: {
    fontSize: 14,
    color: C.textMuted,
  },
  invoiceList: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  invoiceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  invoiceLeft: {
    flex: 1,
    paddingRight: 12,
  },
  invoiceNumber: {
    fontSize: 13,
    fontWeight: "700",
    color: C.textPrimary,
    marginBottom: 2,
  },
  partyName: {
    fontSize: 12,
    color: C.textSecondary,
  },
  invoiceRight: {
    alignItems: "flex-end",
    gap: 4,
  },
  invoiceAmount: {
    fontSize: 14,
    fontWeight: "700",
    color: C.textPrimary,
  },
  invoiceMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  invoiceDate: {
    fontSize: 10,
    color: C.textMuted,
  },
});
