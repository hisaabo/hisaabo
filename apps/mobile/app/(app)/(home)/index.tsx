import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { trpc } from "../../../src/lib/trpc";
import { useBusinessStore } from "../../../src/stores/business";
import { formatCurrency, formatDate } from "../../../src/lib/utils";
import { colors } from "../../../src/lib/theme";
import {
  StatusBadge,
  Card,
  EmptyState,
  QueryError,
  Skeleton,
  PressableRow,
} from "../../../src/components/ui";

type Period = "month" | "quarter" | "fy" | "all";

interface PeriodDates {
  fromDate?: string;
  toDate?: string;
}

function getPeriodDates(period: Period): PeriodDates {
  const now = new Date();
  if (period === "all") return {};

  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      fromDate: start.toISOString(),
      toDate: now.toISOString(),
    };
  }

  if (period === "quarter") {
    const q = Math.floor(now.getMonth() / 3);
    const start = new Date(now.getFullYear(), q * 3, 1);
    return {
      fromDate: start.toISOString(),
      toDate: now.toISOString(),
    };
  }

  // Financial Year (April start)
  const fyStartMonth = 3; // April = index 3
  const fyYear = now.getMonth() < fyStartMonth ? now.getFullYear() - 1 : now.getFullYear();
  const fyStart = new Date(fyYear, fyStartMonth, 1);
  return {
    fromDate: fyStart.toISOString(),
    toDate: now.toISOString(),
  };
}

const PERIOD_LABELS: Record<Period, string> = {
  month: "This Month",
  quarter: "This Quarter",
  fy: "This FY",
  all: "All Time",
};

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

function SalesTrendChart({ data }: { data: Array<{ month: string; invoiced: string; collected: string }> }) {
  const maxValue = useMemo(() => {
    return Math.max(...data.map((d) => parseFloat(d.invoiced) || 0), 1);
  }, [data]);

  return (
    <View style={chartStyles.container}>
      <View style={chartStyles.barsRow}>
        {data.map((d, i) => {
          const pct = Math.max((parseFloat(d.invoiced) / maxValue) * 100, 2);
          const month = new Date(d.month).toLocaleDateString("en-IN", { month: "short" });
          return (
            <View key={i} style={chartStyles.barWrapper}>
              <View style={chartStyles.barBg}>
                <View
                  style={[
                    chartStyles.bar,
                    {
                      height: `${pct}%` as any,
                      backgroundColor: colors.brand,
                    },
                  ]}
                />
              </View>
              <Text style={chartStyles.barLabel}>{month}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const chartStyles = StyleSheet.create({
  container: {
    marginTop: 8,
  },
  barsRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    height: 80,
  },
  barWrapper: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    height: "100%",
    justifyContent: "flex-end",
  },
  barBg: {
    flex: 1,
    width: "100%",
    justifyContent: "flex-end",
  },
  bar: {
    width: "100%",
    borderRadius: 3,
    minHeight: 2,
  },
  barLabel: {
    fontSize: 9,
    color: colors.textMuted,
    textAlign: "center",
  },
});

export default function DashboardScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { businessId, businessName } = useBusinessStore();
  const [period, setPeriod] = useState<Period>("fy");
  const [showBusinessModal, setShowBusinessModal] = useState(false);
  const setBusiness = useBusinessStore((s) => s.setBusiness);

  const periodDates = getPeriodDates(period);

  const { data, isLoading, isError, refetch, isRefetching } =
    trpc.dashboard.summary.useQuery(
      periodDates.fromDate ? { fromDate: periodDates.fromDate, toDate: periodDates.toDate } : undefined
    );

  const { data: trendData, isLoading: trendLoading } =
    trpc.dashboard.salesTrend.useQuery({
      months: 6,
      fromDate: periodDates.fromDate,
      toDate: periodDates.toDate,
    });

  const { data: topOutstanding } =
    trpc.dashboard.topOutstanding.useQuery({ limit: 5 });

  const { data: lowStockData } =
    trpc.item.lowStockCount.useQuery(undefined);

  const { data: businesses } =
    trpc.business.list.useQuery(undefined);

  const summary = data;
  const totalSales = summary?.totalSales ?? "0";
  const totalPurchases = summary?.totalPurchases ?? "0";
  const totalExpenses = summary?.totalExpenses ?? "0";
  const receivable = summary?.receivable ?? "0";
  const payable = summary?.payable ?? "0";
  const cashInHand = summary?.cashInHand ?? "0";
  const recentInvoices = summary?.recentInvoices ?? [];

  const lowStockCount = lowStockData ?? 0;

  const handleSwitchBusiness = async (id: string, name: string) => {
    setBusiness(id, name);
    setShowBusinessModal(false);
    queryClient.invalidateQueries();
  };

  if (isError) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <QueryError message="Failed to load dashboard" onRetry={refetch} />
      </SafeAreaView>
    );
  }

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
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
      >
        {/* Header with business selector */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.businessSelector}
            onPress={() => setShowBusinessModal(true)}
            activeOpacity={0.7}
          >
            <View>
              <Text style={styles.greeting}>Good day,</Text>
              <View style={styles.businessNameRow}>
                <Text style={styles.businessName} numberOfLines={1}>
                  {businessName ?? "Your Business"}
                </Text>
                <Ionicons name="chevron-down" size={16} color={colors.textSecondary} style={{ marginTop: 4 }} />
              </View>
            </View>
          </TouchableOpacity>
          <View style={styles.headerIcon}>
            <Ionicons name="business-outline" size={22} color={colors.brand} />
          </View>
        </View>

        {/* Period selector */}
        <View style={styles.periodSelector}>
          {(["month", "quarter", "fy", "all"] as Period[]).map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.periodPill, period === p && styles.periodPillActive]}
              onPress={() => setPeriod(p)}
              activeOpacity={0.7}
            >
              <Text style={[styles.periodPillText, period === p && styles.periodPillTextActive]}>
                {PERIOD_LABELS[p]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {isLoading ? (
          <>
            <Text style={styles.sectionTitle}>Financial Overview</Text>
            <View style={styles.grid}>
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} width="47.5%" height={90} borderRadius={16} />
              ))}
            </View>
            <Text style={styles.sectionTitle}>Sales Trend</Text>
            <Skeleton width="100%" height={120} borderRadius={16} style={{ marginBottom: 24 }} />
            <Text style={styles.sectionTitle}>Recent Invoices</Text>
            <Card>
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} width="100%" height={60} borderRadius={8} style={{ marginBottom: 8 }} />
              ))}
            </Card>
          </>
        ) : (
          <>
            {/* Summary Cards Grid */}
            <Text style={styles.sectionTitle}>Financial Overview</Text>
            <View style={styles.grid}>
              <SummaryCard
                label="Total Sales"
                value={formatCurrency(totalSales)}
                icon="trending-up-outline"
                iconColor={colors.success}
                tintColor={colors.success}
              />
              <SummaryCard
                label="Total Purchases"
                value={formatCurrency(totalPurchases)}
                icon="cart-outline"
                iconColor={colors.textSecondary}
              />
              <SummaryCard
                label="Receivable"
                value={formatCurrency(receivable)}
                icon="arrow-down-circle-outline"
                iconColor={parseFloat(receivable) > 0 ? colors.warning : colors.textSecondary}
                tintColor={parseFloat(receivable) > 0 ? colors.warning : undefined}
              />
              <SummaryCard
                label="Payable"
                value={formatCurrency(payable)}
                icon="arrow-up-circle-outline"
                iconColor={colors.danger}
              />
              <SummaryCard
                label="Cash in Hand"
                value={formatCurrency(cashInHand)}
                icon="cash-outline"
                iconColor={colors.brand}
                tintColor={colors.brand}
              />
              <SummaryCard
                label="Total Expenses"
                value={formatCurrency(totalExpenses)}
                icon="receipt-outline"
                iconColor={colors.danger}
              />
            </View>

            {/* Sales Trend Chart */}
            <Text style={styles.sectionTitle}>Sales Trend</Text>
            <Card style={{ marginBottom: 24 }}>
              {trendLoading ? (
                <Skeleton width="100%" height={80} borderRadius={8} />
              ) : trendData && trendData.length > 0 ? (
                <SalesTrendChart data={trendData} />
              ) : (
                <EmptyState icon="bar-chart-outline" title="No trend data" />
              )}
            </Card>

            {/* Top Outstanding Parties */}
            {topOutstanding && topOutstanding.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Top Outstanding</Text>
                <View style={styles.invoiceList}>
                  {topOutstanding.map((party, idx) => (
                    <View
                      key={party.partyId}
                      style={[
                        styles.invoiceRow,
                        idx === topOutstanding.length - 1 && styles.invoiceRowLast,
                      ]}
                    >
                      <View style={styles.invoiceLeft}>
                        <View style={styles.partyAvatar}>
                          <Text style={styles.partyAvatarText}>
                            {party.partyName.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <Text style={styles.partyName} numberOfLines={1}>
                          {party.partyName}
                        </Text>
                      </View>
                      <Text style={[styles.invoiceAmount, { color: colors.warning }]}>
                        {formatCurrency(party.outstanding)}
                      </Text>
                    </View>
                  ))}
                </View>
                <View style={{ height: 24 }} />
              </>
            )}

            {/* Recent Invoices */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent Invoices</Text>
              <TouchableOpacity onPress={() => router.push("/(invoices)")}>
                <Text style={styles.seeAll}>See all</Text>
              </TouchableOpacity>
            </View>

            {recentInvoices.length === 0 ? (
              <Card>
                <EmptyState icon="receipt-outline" title="No invoices yet" />
              </Card>
            ) : (
              <View style={styles.invoiceList}>
                {recentInvoices.map((inv, idx) => (
                  <PressableRow
                    key={inv.id}
                    style={[
                      styles.invoiceRow,
                      idx === recentInvoices.length - 1 && styles.invoiceRowLast,
                    ]}
                    onPress={() => router.push(`/(invoices)/${inv.id}` as never)}
                  >
                    <View style={styles.invoiceLeft}>
                      <Text style={styles.invoiceNumber}>{inv.invoiceNumber}</Text>
                      <Text style={styles.invoicePartyName} numberOfLines={1}>
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
                  </PressableRow>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Business Switcher Modal */}
      <Modal
        visible={showBusinessModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowBusinessModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowBusinessModal(false)}
        >
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Switch Business</Text>
            {businesses && businesses.length > 0 ? (
              <FlatList
                data={businesses}
                keyExtractor={(b) => b.id}
                renderItem={({ item: b }) => (
                  <TouchableOpacity
                    style={[
                      styles.businessItem,
                      b.id === businessId && styles.businessItemActive,
                    ]}
                    onPress={() => handleSwitchBusiness(b.id, b.name)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.businessItemIcon}>
                      <Ionicons name="business-outline" size={18} color={b.id === businessId ? colors.textPrimary : colors.brand} />
                    </View>
                    <Text style={[styles.businessItemName, b.id === businessId && { color: colors.textPrimary }]}>
                      {b.name}
                    </Text>
                    {b.id === businessId && (
                      <Ionicons name="checkmark" size={18} color={colors.textPrimary} />
                    )}
                  </TouchableOpacity>
                )}
              />
            ) : (
              <Text style={styles.noBusinessText}>No other businesses</Text>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
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
    paddingBottom: 12,
  },
  businessSelector: {
    flex: 1,
  },
  greeting: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: "500",
  },
  businessNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  businessName: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.textPrimary,
    marginTop: 2,
    maxWidth: 260,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  periodSelector: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 20,
    flexWrap: "wrap",
  },
  periodPill: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 44,
    justifyContent: "center",
  },
  periodPillActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  periodPillText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  periodPillTextActive: {
    color: colors.textPrimary,
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
    color: colors.textPrimary,
    marginBottom: 12,
  },
  seeAll: {
    fontSize: 13,
    color: colors.brand,
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
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
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
    color: colors.textMuted,
    fontWeight: "500",
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  invoiceList: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  invoiceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  invoiceRowLast: {
    borderBottomWidth: 0,
  },
  invoiceLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 12,
    gap: 10,
  },
  partyAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  partyAvatarText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.brand,
  },
  partyName: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
    flex: 1,
  },
  invoiceNumber: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 2,
  },
  invoicePartyName: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  invoiceRight: {
    alignItems: "flex-end",
    gap: 4,
  },
  invoiceAmount: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  invoiceMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  invoiceDate: {
    fontSize: 10,
    color: colors.textMuted,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingBottom: 40,
    paddingHorizontal: 16,
    maxHeight: "60%",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 16,
    textAlign: "center",
  },
  businessItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 4,
  },
  businessItemActive: {
    backgroundColor: colors.brand,
  },
  businessItemIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  businessItemName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  noBusinessText: {
    textAlign: "center",
    color: colors.textMuted,
    paddingVertical: 24,
    fontSize: 14,
  },
});
