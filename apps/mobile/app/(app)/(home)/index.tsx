import { View, Text, ScrollView, RefreshControl, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState, useMemo } from "react";
import { trpc } from "../../../src/lib/trpc";
import { useBusinessStore } from "../../../src/stores/business";
import { formatCurrency, formatDate } from "../../../src/lib/utils";
import { colors } from "../../../src/lib/theme";
import { StatusBadge, Skeleton } from "../../../src/components/ui";

/* ── Period helpers ──────────────────────────────────────────── */

type Period = "month" | "quarter" | "fy" | "all";

const PERIODS: { key: Period; label: string }[] = [
  { key: "month", label: "This Month" },
  { key: "quarter", label: "This Quarter" },
  { key: "fy", label: "This FY" },
  { key: "all", label: "All Time" },
];

function getPeriodDates(period: Period): { fromDate?: string; toDate?: string } {
  const now = new Date();
  if (period === "all") return {};
  if (period === "month") {
    return { fromDate: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), toDate: now.toISOString() };
  }
  if (period === "quarter") {
    const q = Math.floor(now.getMonth() / 3);
    return { fromDate: new Date(now.getFullYear(), q * 3, 1).toISOString(), toDate: now.toISOString() };
  }
  const fyYear = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
  return { fromDate: new Date(fyYear, 3, 1).toISOString(), toDate: now.toISOString() };
}

/* ── Dashboard ──────────────────────────────────────────────── */

export default function DashboardScreen() {
  const router = useRouter();
  const { businessName } = useBusinessStore();
  const [period, setPeriod] = useState<Period>("month");
  const dates = useMemo(() => getPeriodDates(period), [period]);

  // businessId is guaranteed by _layout.tsx — no need for `enabled` gates
  const { data: summary, refetch, isRefetching } = trpc.dashboard.summary.useQuery(
    dates.fromDate ? { fromDate: dates.fromDate, toDate: dates.toDate } : undefined,
  );

  const { data: recentInvoices } = trpc.invoice.list.useQuery({
    page: 1, limit: 5, documentType: "invoice",
  });

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brand} colors={[colors.brand]} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.greeting}>Good day,</Text>
            <Text style={s.businessName}>{businessName || "My Business"}</Text>
          </View>
        </View>

        {/* Period pills */}
        <View style={s.pillRow}>
          {PERIODS.map((p) => (
            <TouchableOpacity
              key={p.key}
              style={[s.pill, period === p.key && s.pillActive]}
              onPress={() => period !== p.key && setPeriod(p.key)}
              activeOpacity={0.7}
            >
              <Text style={[s.pillText, period === p.key && s.pillTextActive]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Summary cards */}
        <Text style={s.sectionTitle}>Financial Overview</Text>
        {summary ? (
          <View style={s.grid}>
            <SummaryCard label="Total Sales" value={formatCurrency(summary.totalSales)} color={colors.success} />
            <SummaryCard label="Total Purchases" value={formatCurrency(summary.totalPurchases)} color={colors.info} />
            <SummaryCard label="Receivable" value={formatCurrency(summary.receivable)} color={colors.warning} />
            <SummaryCard label="Payable" value={formatCurrency(summary.payable)} color={colors.danger} />
            <SummaryCard label="Cash in Hand" value={formatCurrency(summary.cashInHand)} color={colors.brand} />
            <SummaryCard label="Expenses" value={formatCurrency(summary.totalExpenses)} color="#8b5cf6" />
          </View>
        ) : (
          <View style={s.grid}>
            {Array.from({ length: 6 }).map((_, i) => (
              <View key={i} style={s.cardHalf}><Skeleton width="100%" height={80} borderRadius={16} /></View>
            ))}
          </View>
        )}

        {/* Recent invoices */}
        <Text style={[s.sectionTitle, { marginTop: 24 }]}>Recent Invoices</Text>
        {recentInvoices?.data && recentInvoices.data.length > 0 ? (
          <View style={s.invoiceList}>
            {recentInvoices.data.map((inv) => (
              <TouchableOpacity
                key={inv.id}
                style={s.invoiceRow}
                onPress={() => router.push({ pathname: "/(invoices)/[id]", params: { id: inv.id } })}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <View style={s.invoiceTop}>
                    <Text style={s.invoiceNumber}>{inv.invoiceNumber}</Text>
                    <StatusBadge status={inv.status} />
                  </View>
                  <Text style={s.invoiceParty}>{inv.partyName}</Text>
                </View>
                <View style={s.invoiceRight}>
                  <Text style={s.invoiceAmount}>{formatCurrency(inv.totalAmount)}</Text>
                  <Text style={s.invoiceDate}>{formatDate(inv.invoiceDate)}</Text>
                </View>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={s.viewAllBtn} onPress={() => router.push("/(invoices)")} activeOpacity={0.7}>
              <Text style={s.viewAllText}>View all invoices</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.brand} />
            </TouchableOpacity>
          </View>
        ) : recentInvoices ? (
          <View style={s.emptyCard}>
            <Ionicons name="receipt-outline" size={32} color={colors.textMuted} />
            <Text style={s.emptyText}>No invoices yet</Text>
            <Text style={s.emptyHint}>Create your first invoice to see it here</Text>
          </View>
        ) : (
          <Skeleton width="100%" height={120} borderRadius={16} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ── Summary card ───────────────────────────────────────────── */

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={s.cardHalf}>
      <View style={s.card}>
        <View style={[s.cardDot, { backgroundColor: color }]} />
        <Text style={s.cardLabel}>{label}</Text>
        <Text style={s.cardValue}>{value}</Text>
      </View>
    </View>
  );
}

/* ── Styles ──────────────────────────────────────────────────── */

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 16, paddingBottom: 32 },
  header: { paddingTop: 16, marginBottom: 16 },
  greeting: { fontSize: 13, color: colors.textMuted },
  businessName: { fontSize: 22, fontWeight: "700", color: colors.textPrimary, letterSpacing: -0.5, marginTop: 2 },
  pillRow: { flexDirection: "row", gap: 8, marginBottom: 20 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, minHeight: 36, justifyContent: "center" },
  pillActive: { backgroundColor: "rgba(99, 102, 241, 0.15)", borderColor: colors.brand },
  pillText: { fontSize: 12, fontWeight: "600", color: colors.textMuted },
  pillTextActive: { color: colors.brand },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.textPrimary, marginBottom: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  cardHalf: { width: "48%" },
  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14 },
  cardDot: { width: 8, height: 8, borderRadius: 4, marginBottom: 8 },
  cardLabel: { fontSize: 11, fontWeight: "600", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  cardValue: { fontSize: 18, fontWeight: "700", color: colors.textPrimary, letterSpacing: -0.3 },
  invoiceList: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  invoiceRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  invoiceTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  invoiceNumber: { fontSize: 13, fontWeight: "600", color: colors.textPrimary },
  invoiceParty: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  invoiceRight: { alignItems: "flex-end" },
  invoiceAmount: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  invoiceDate: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  viewAllBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 12 },
  viewAllText: { fontSize: 13, fontWeight: "600", color: colors.brand },
  emptyCard: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 32, alignItems: "center", gap: 8 },
  emptyText: { fontSize: 14, fontWeight: "600", color: colors.textSecondary },
  emptyHint: { fontSize: 12, color: colors.textMuted, textAlign: "center" },
});
