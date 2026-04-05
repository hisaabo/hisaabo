import { View, Text, ScrollView, RefreshControl, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState, useMemo, useEffect } from "react";
import { trpc } from "../../../src/lib/trpc";
import { useBusinessStore } from "../../../src/stores/business";
import { useBiometricStore } from "../../../src/stores/biometric";
import { useBusinessSwitcherContext } from "../../../src/contexts/BusinessSwitcherContext";
import { formatCurrency, formatDate } from "../../../src/lib/utils";

/** Whole-number currency for summary cards — paise are noise at this level */
function formatSummary(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "\u20B90";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}
import { colors } from "../../../src/lib/theme";
import { StatusBadge, Skeleton, QueryError } from "../../../src/components/ui";
import { BiometricSetupPrompt } from "../../../src/components/BiometricSetupPrompt";

/* ── Period helpers ──────────────────────────────────────────── */
// CRITICAL: Use Date.UTC() instead of new Date(y,m,d) to avoid IST timezone
// shifting. In IST (UTC+5:30), new Date(2025,3,1).toISOString() produces
// "2025-03-31T18:30:00Z" — March 31 UTC, not April 1. Aligned with web's
// useDateRange hook.

type Period = "month" | "quarter" | "fy" | "all";

const PERIODS: { key: Period; label: string }[] = [
  { key: "month", label: "This Month" },
  { key: "quarter", label: "This Quarter" },
  { key: "fy", label: "This FY" },
  { key: "all", label: "All Time" },
];

function utcDate(y: number, m: number, d: number, h = 0, min = 0, s = 0): string {
  return new Date(Date.UTC(y, m, d, h, min, s)).toISOString();
}

function getPeriodDates(period: Period): { fromDate?: string; toDate?: string } {
  if (period === "all") return {};
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = now.getUTCMonth();
  const toDate = now.toISOString();
  if (period === "month") {
    return { fromDate: utcDate(yyyy, mm, 1), toDate };
  }
  if (period === "quarter") {
    const q = Math.floor(mm / 3);
    return { fromDate: utcDate(yyyy, q * 3, 1), toDate };
  }
  // Indian FY: April (month 3) to March
  const fyYear = mm >= 3 ? yyyy : yyyy - 1;
  return { fromDate: utcDate(fyYear, 3, 1), toDate };
}

/* ── Dashboard ──────────────────────────────────────────────── */

export default function DashboardScreen() {
  const router = useRouter();
  const businessName = useBusinessStore((s) => s.businessName);
  const businessId = useBusinessStore((s) => s.businessId);
  const { openSwitcher } = useBusinessSwitcherContext();
  const [period, setPeriod] = useState<Period>("month");
  const dates = useMemo(() => getPeriodDates(period), [period]);

  // Biometric setup prompt — shows once after first login
  const setupPrompted = useBiometricStore((s) => s.setupPrompted);
  const biometricEnabled = useBiometricStore((s) => s.biometricEnabled);
  const pinEnabled = useBiometricStore((s) => s.pinEnabled);
  const [showSetupPrompt, setShowSetupPrompt] = useState(false);

  // Show setup prompt once if user hasn't been prompted and has no security set up
  useEffect(() => {
    if (!setupPrompted && !biometricEnabled && !pinEnabled) {
      // Slight delay so the dashboard feels loaded first
      const timer = setTimeout(() => setShowSetupPrompt(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [setupPrompted, biometricEnabled, pinEnabled]);

  const { data: summary, refetch, isRefetching, isError: summaryError } = trpc.dashboard.summary.useQuery(
    dates.fromDate ? { fromDate: dates.fromDate, toDate: dates.toDate } : undefined,
    { enabled: !!businessId },
  );

  const { data: recentInvoices, isError: invoicesError, refetch: refetchInvoices } = trpc.invoice.list.useQuery(
    { page: 1, limit: 5, documentType: "invoice" },
    { enabled: !!businessId },
  );

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
            <TouchableOpacity
              style={s.businessNameRow}
              onPress={openSwitcher}
              activeOpacity={0.7}
            >
              <Text style={s.businessName} numberOfLines={1}>{businessName || "My Business"}</Text>
              <Ionicons name="chevron-expand-outline" size={16} color={colors.textMuted} />
            </TouchableOpacity>
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
        {summaryError ? (
          <QueryError message="Could not load summary" onRetry={refetch} />
        ) : summary ? (
          <View style={s.grid}>
            <SummaryCard label="Total Sales" value={formatSummary(summary.totalSales)} color={colors.success} />
            <SummaryCard label="Total Purchases" value={formatSummary(summary.totalPurchases)} color={colors.info} />
            <SummaryCard label="Receivable" value={formatSummary(summary.receivable)} color={colors.warning} />
            <SummaryCard label="Payable" value={formatSummary(summary.payable)} color={colors.danger} />
            <SummaryCard label="Cash in Hand" value={formatSummary(summary.cashInHand)} color={colors.brand} />
            <SummaryCard label="Expenses" value={formatSummary(summary.totalExpenses)} color="#8b5cf6" />
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
        {invoicesError ? (
          <QueryError message="Could not load invoices" onRetry={refetchInvoices} />
        ) : recentInvoices?.data && recentInvoices.data.length > 0 ? (
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

      {/* Biometric setup prompt — shown once after first login */}
      <BiometricSetupPrompt
        visible={showSetupPrompt}
        onDismiss={() => setShowSetupPrompt(false)}
      />
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
  businessNameRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  businessName: { fontSize: 22, fontWeight: "700", color: colors.textPrimary, letterSpacing: -0.5 },
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
