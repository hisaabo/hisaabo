import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState, useMemo } from "react";
import { trpc } from "../../../src/lib/trpc";
import { useBusinessStore } from "../../../src/stores/business";
import { formatCurrency } from "../../../src/lib/utils";
import { makeStyles } from "../../../src/lib/makeStyles";
import { useColors } from "../../../src/contexts/ThemeContext";
import { Card, QueryError, Skeleton, DatePickerField } from "../../../src/components/ui";

type Period = "month" | "quarter" | "fy" | "all" | "custom";

interface PeriodDates {
  fromDate?: string;
  toDate?: string;
}

function getPeriodDates(period: Period, customFrom: Date | null, customTo: Date | null): PeriodDates {
  const now = new Date();

  if (period === "all") return {};

  if (period === "custom") {
    const from = customFrom ? new Date(customFrom.getFullYear(), customFrom.getMonth(), customFrom.getDate()).toISOString() : undefined;
    const to = customTo ? new Date(customTo.getFullYear(), customTo.getMonth(), customTo.getDate(), 23, 59, 59, 999).toISOString() : undefined;
    return { fromDate: from, toDate: to };
  }

  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { fromDate: start.toISOString(), toDate: now.toISOString() };
  }

  if (period === "quarter") {
    const q = Math.floor(now.getMonth() / 3);
    const start = new Date(now.getFullYear(), q * 3, 1);
    return { fromDate: start.toISOString(), toDate: now.toISOString() };
  }

  // FY
  const fyStartMonth = 3;
  const fyYear = now.getMonth() < fyStartMonth ? now.getFullYear() - 1 : now.getFullYear();
  const fyStart = new Date(fyYear, fyStartMonth, 1);
  return { fromDate: fyStart.toISOString(), toDate: now.toISOString() };
}

const PERIODS: { key: Period; label: string }[] = [
  { key: "month", label: "This Month" },
  { key: "quarter", label: "This Quarter" },
  { key: "fy", label: "This FY" },
  { key: "all", label: "All Time" },
  { key: "custom", label: "Custom" },
];

interface PercentBarProps {
  value: number;
  total: number;
  color: string;
}

function PercentBar({ value, total, color }: PercentBarProps) {
  const barStyles = useBarStyles();
  const pct = total > 0 ? Math.max((value / total) * 100, 2) : 0;
  return (
    <View style={barStyles.bg}>
      <View style={[barStyles.fill, { width: `${pct}%` as any, backgroundColor: color }]} />
    </View>
  );
}

const useBarStyles = makeStyles((colors) => ({
  bg: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    marginTop: 6,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 3,
  },
}));

export default function ReportsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { businessId } = useBusinessStore();
  const [period, setPeriod] = useState<Period>("fy");
  const [customFrom, setCustomFrom] = useState<Date | null>(null);
  const [customTo, setCustomTo] = useState<Date | null>(null);

  const STATUS_COLORS = useMemo<Record<string, string>>(() => ({
    paid: colors.success,
    partial: colors.warning,
    unpaid: colors.danger,
    overdue: colors.danger,
    draft: colors.textMuted,
    cancelled: colors.textMuted,
  }), [colors]);

  const dates = getPeriodDates(period, customFrom, customTo);

  const {
    data: plData,
    isLoading: plLoading,
    isError: plError,
    refetch: refetchPL,
    isRefetching: plRefetching,
  } = trpc.dashboard.profitAndLoss.useQuery(dates, { enabled: !!businessId });

  const {
    data: agingData,
    isLoading: agingLoading,
    isError: agingError,
    refetch: refetchAging,
    isRefetching: agingRefetching,
  } = trpc.dashboard.receivablesAging.useQuery(undefined, { enabled: !!businessId });

  const {
    data: expenseData,
    isLoading: expenseLoading,
    isError: expenseError,
    refetch: refetchExpenses,
    isRefetching: expenseRefetching,
  } = trpc.dashboard.expensesByCategory.useQuery(dates, { enabled: !!businessId });

  const {
    data: statusData,
    isLoading: statusLoading,
    isError: statusError,
    refetch: refetchStatus,
    isRefetching: statusRefetching,
  } = trpc.dashboard.invoiceStatusBreakdown.useQuery(dates, { enabled: !!businessId });

  const isRefreshing = plRefetching || agingRefetching || expenseRefetching || statusRefetching;

  const handleRefresh = () => {
    refetchPL();
    refetchAging();
    refetchExpenses();
    refetchStatus();
  };

  const totalExpenseAmount = expenseData
    ? expenseData.reduce((sum, e) => sum + parseFloat(e.total ?? "0"), 0)
    : 0;

  const _totalStatusAmount = statusData
    ? statusData.reduce((sum, s) => sum + parseFloat(s.total ?? "0"), 0)
    : 0;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Reports</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
      >
        {/* Period Selector */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.periodScroll}
          contentContainerStyle={styles.periodContainer}
        >
          {PERIODS.map((p) => (
            <TouchableOpacity
              key={p.key}
              style={[styles.pill, period === p.key && styles.pillActive]}
              onPress={() => setPeriod(p.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.pillText, period === p.key && styles.pillTextActive]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {period === "custom" && (
          <View style={styles.customDateRow}>
            <View style={styles.customDateField}>
              <DatePickerField
                label="From"
                value={customFrom ?? new Date()}
                onChange={setCustomFrom}
              />
            </View>
            <View style={styles.customDateField}>
              <DatePickerField
                label="To"
                value={customTo ?? new Date()}
                onChange={setCustomTo}
                minimumDate={customFrom ?? undefined}
              />
            </View>
          </View>
        )}

        {/* Profit & Loss */}
        <Text style={styles.sectionTitle}>Profit & Loss</Text>
        <Card style={styles.card}>
          {plLoading ? (
            <>
              <Skeleton width="100%" height={20} borderRadius={6} style={{ marginBottom: 12 }} />
              <Skeleton width="80%" height={20} borderRadius={6} style={{ marginBottom: 12 }} />
              <Skeleton width="70%" height={20} borderRadius={6} />
            </>
          ) : plError ? (
            <QueryError message="Failed to load P&L" onRetry={refetchPL} />
          ) : plData ? (
            <>
              <PLRow label="Revenue" value={plData.revenue} valueColor={colors.success} />
              <PLRow label="Cost of Goods (Purchases)" value={plData.cogs} valueColor={colors.danger} negative />
              <View style={styles.plDivider} />
              <PLRow label="Gross Profit" value={plData.grossProfit} bold
                suffix={`(${plData.grossMarginPercent}%)`}
                valueColor={parseFloat(plData.grossProfit) >= 0 ? colors.success : colors.danger}
              />
              <PLRow label="Total Expenses" value={plData.totalExpenses} valueColor={colors.danger} negative />
              <View style={styles.plDivider} />
              <PLRow label="Net Profit" value={plData.netProfit} bold
                suffix={`(${plData.netMarginPercent}%)`}
                valueColor={parseFloat(plData.netProfit) >= 0 ? colors.success : colors.danger}
              />
            </>
          ) : null}
        </Card>

        {/* Receivables Aging */}
        <Text style={styles.sectionTitle}>Receivables Aging</Text>
        <Card style={styles.card}>
          {agingLoading ? (
            <Skeleton width="100%" height={100} borderRadius={6} />
          ) : agingError ? (
            <QueryError message="Failed to load aging" onRetry={refetchAging} />
          ) : agingData ? (
            <>
              {/* Summary row */}
              <View style={styles.agingHeaderRow}>
                <Text style={[styles.agingCell, styles.agingPartyCell, styles.agingHeaderText]}>Party</Text>
                <Text style={[styles.agingCell, styles.agingHeaderText]}>Current</Text>
                <Text style={[styles.agingCell, styles.agingHeaderText]}>31-60</Text>
                <Text style={[styles.agingCell, styles.agingHeaderText]}>61-90</Text>
                <Text style={[styles.agingCell, styles.agingHeaderText]}>90+</Text>
              </View>
              {agingData.rows.length === 0 ? (
                <Text style={styles.emptyText}>No outstanding receivables</Text>
              ) : (
                agingData.rows.map((row) => (
                  <View key={row.partyId} style={styles.agingRow}>
                    <Text style={[styles.agingCell, styles.agingPartyCell]} numberOfLines={1}>
                      {row.partyName}
                    </Text>
                    <Text style={[styles.agingCell, parseFloat(row.current) > 0 && { color: colors.success }]}>
                      {parseFloat(row.current) > 0 ? formatCurrency(row.current) : "-"}
                    </Text>
                    <Text style={[styles.agingCell, parseFloat(row.days31_60) > 0 && { color: colors.warning }]}>
                      {parseFloat(row.days31_60) > 0 ? formatCurrency(row.days31_60) : "-"}
                    </Text>
                    <Text style={[styles.agingCell, parseFloat(row.days61_90) > 0 && { color: colors.amber }]}>
                      {parseFloat(row.days61_90) > 0 ? formatCurrency(row.days61_90) : "-"}
                    </Text>
                    <Text style={[styles.agingCell, parseFloat(row.days90Plus) > 0 && { color: colors.danger }]}>
                      {parseFloat(row.days90Plus) > 0 ? formatCurrency(row.days90Plus) : "-"}
                    </Text>
                  </View>
                ))
              )}
              {agingData.rows.length > 0 && (
                <>
                  <View style={styles.plDivider} />
                  <View style={styles.agingRow}>
                    <Text style={[styles.agingCell, styles.agingPartyCell, { fontWeight: "700", color: colors.textPrimary }]}>
                      Total
                    </Text>
                    <Text style={[styles.agingCell, { fontWeight: "700", color: colors.textPrimary }]}>
                      {formatCurrency(agingData.summary.current)}
                    </Text>
                    <Text style={[styles.agingCell, { fontWeight: "700", color: colors.textPrimary }]}>
                      {formatCurrency(agingData.summary.days31_60)}
                    </Text>
                    <Text style={[styles.agingCell, { fontWeight: "700", color: colors.textPrimary }]}>
                      {formatCurrency(agingData.summary.days61_90)}
                    </Text>
                    <Text style={[styles.agingCell, { fontWeight: "700", color: colors.textPrimary }]}>
                      {formatCurrency(agingData.summary.days90Plus)}
                    </Text>
                  </View>
                </>
              )}
            </>
          ) : null}
        </Card>

        {/* Expenses by Category */}
        <Text style={styles.sectionTitle}>Expenses by Category</Text>
        <Card style={styles.card}>
          {expenseLoading ? (
            <Skeleton width="100%" height={120} borderRadius={6} />
          ) : expenseError ? (
            <QueryError message="Failed to load expenses" onRetry={refetchExpenses} />
          ) : expenseData && expenseData.length > 0 ? (
            expenseData.map((e, i) => {
              const amount = parseFloat(e.total ?? "0");
              const pct = totalExpenseAmount > 0 ? ((amount / totalExpenseAmount) * 100).toFixed(1) : "0";
              return (
                <View key={e.category ?? i} style={[styles.expenseRow, i < expenseData.length - 1 && styles.expenseRowBorder]}>
                  <View style={styles.expenseInfo}>
                    <View style={styles.expenseLabelRow}>
                      <Text style={styles.expenseCategory}>{e.category ?? "Uncategorized"}</Text>
                      <Text style={styles.expensePct}>{pct}%</Text>
                    </View>
                    <PercentBar value={amount} total={totalExpenseAmount} color={colors.brand} />
                  </View>
                  <View style={styles.expenseRight}>
                    <Text style={styles.expenseAmount}>{formatCurrency(amount)}</Text>
                    <Text style={styles.expenseCount}>{e.count} items</Text>
                  </View>
                </View>
              );
            })
          ) : (
            <Text style={styles.emptyText}>No expense data</Text>
          )}
        </Card>

        {/* Invoice Status Breakdown */}
        <Text style={styles.sectionTitle}>Invoice Status Breakdown</Text>
        <Card style={[styles.card, { marginBottom: 0 }]}>
          {statusLoading ? (
            <Skeleton width="100%" height={80} borderRadius={6} />
          ) : statusError ? (
            <QueryError message="Failed to load status breakdown" onRetry={refetchStatus} />
          ) : statusData && statusData.length > 0 ? (
            statusData.map((s, i) => {
              const amount = parseFloat(s.total ?? "0");
              const statusColor = STATUS_COLORS[s.status] ?? colors.textMuted;
              return (
                <View key={s.status} style={[styles.statusRow, i < statusData.length - 1 && styles.statusRowBorder]}>
                  <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                  <Text style={styles.statusLabel}>{s.status.charAt(0).toUpperCase() + s.status.slice(1)}</Text>
                  <Text style={styles.statusCount}>{s.count} invoices</Text>
                  <Text style={[styles.statusAmount, { color: statusColor }]}>{formatCurrency(amount)}</Text>
                </View>
              );
            })
          ) : (
            <Text style={styles.emptyText}>No invoice data</Text>
          )}
        </Card>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function PLRow({
  label,
  value,
  valueColor,
  bold,
  negative,
  suffix,
}: {
  label: string;
  value: string;
  valueColor?: string;
  bold?: boolean;
  negative?: boolean;
  suffix?: string;
}) {
  const plStyles = usePlStyles();
  const display = negative
    ? `-${formatCurrency(Math.abs(parseFloat(value)))}`
    : formatCurrency(parseFloat(value));
  return (
    <View style={plStyles.row}>
      <Text style={[plStyles.label, bold && plStyles.bold]}>{label}</Text>
      <View style={plStyles.right}>
        <Text style={[plStyles.value, bold && plStyles.bold, valueColor ? { color: valueColor } : {}]}>
          {display}
        </Text>
        {suffix && <Text style={plStyles.suffix}>{suffix}</Text>}
      </View>
    </View>
  );
}

const usePlStyles = makeStyles((colors) => ({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  label: {
    fontSize: 13,
    color: colors.textSecondary,
    flex: 1,
  },
  bold: {
    fontWeight: "700",
    color: colors.textPrimary,
    fontSize: 14,
  },
  right: {
    alignItems: "flex-end",
  },
  value: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: "600",
  },
  suffix: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
}));

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  periodScroll: {
    marginBottom: 16,
    marginHorizontal: -16,
  },
  periodContainer: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: "row",
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  pillTextActive: {
    color: colors.textPrimary,
  },
  customDateRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  customDateField: {
    flex: 1,
  },
  customDateLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: "600",
    marginBottom: 6,
    textTransform: "uppercase",
  },
  customDateInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 13,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 10,
    marginTop: 4,
  },
  card: {
    marginBottom: 24,
  },
  plDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  // Aging table
  agingHeaderRow: {
    flexDirection: "row",
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 4,
  },
  agingHeaderText: {
    color: colors.textMuted,
    fontWeight: "700",
    fontSize: 10,
    textTransform: "uppercase",
  },
  agingRow: {
    flexDirection: "row",
    paddingVertical: 8,
  },
  agingCell: {
    flex: 1,
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: "right",
  },
  agingPartyCell: {
    flex: 2,
    textAlign: "left",
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 16,
  },
  // Expense rows
  expenseRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
  },
  expenseRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  expenseInfo: {
    flex: 1,
  },
  expenseLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  expenseCategory: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textPrimary,
    textTransform: "capitalize",
  },
  expensePct: {
    fontSize: 11,
    color: colors.textMuted,
  },
  expenseRight: {
    alignItems: "flex-end",
    minWidth: 80,
  },
  expenseAmount: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  expenseCount: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  // Status rows
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 10,
  },
  statusRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  statusCount: {
    fontSize: 12,
    color: colors.textMuted,
    marginRight: 8,
  },
  statusAmount: {
    fontSize: 14,
    fontWeight: "700",
    minWidth: 80,
    textAlign: "right",
  },
}));
