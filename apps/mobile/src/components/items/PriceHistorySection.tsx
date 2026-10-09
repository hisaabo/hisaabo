import { useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../lib/trpc";
import { formatDate } from "../../lib/utils";
import { makeStyles } from "../../lib/makeStyles";
import { useColors } from "../../contexts/ThemeContext";
import { Chip, PeriodChips, UnitChips, type HistoryPeriod } from "./HistoryControls";

const PAGE_SIZE = 30;

/** At least 2, up to 4 decimals (per-gram style prices need them). */
function money(v: string | null | undefined): string {
  const n = Number(v);
  if (v == null || !Number.isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

interface Props {
  itemId: string;
  baseUnit: string;
  unitVariants: { unit: string }[] | null | undefined;
}

/**
 * Price history for the selected period. min / avg / max / latest are computed
 * server-side over EVERY line in the period (not just the rows loaded below),
 * prices are normalised to the chosen unit, and the table pages on demand.
 */
export function PriceHistorySection({ itemId, baseUnit, unitVariants }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const [period, setPeriod] = useState<HistoryPeriod>("all");
  const [invoiceType, setInvoiceType] = useState<"sale" | "purchase">("sale");
  const [unit, setUnit] = useState(baseUnit);

  const { data: summary, isLoading } = trpc.item.priceSummary.useQuery({ id: itemId, period, invoiceType, unit });
  const page = trpc.item.priceHistoryPage.useInfiniteQuery(
    { id: itemId, period, invoiceType, unit, limit: PAGE_SIZE },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  const rows = page.data?.pages.flatMap((p) => p.rows) ?? [];
  const stats = summary?.stats;
  const shownUnit = summary?.unit ?? unit;

  return (
    <View style={styles.wrap}>
      <PeriodChips value={period} onChange={setPeriod} />
      <View style={styles.chipRow}>
        <Chip label="Sales" active={invoiceType === "sale"} onPress={() => setInvoiceType("sale")} />
        <Chip label="Purchases" active={invoiceType === "purchase"} onPress={() => setInvoiceType("purchase")} />
      </View>
      <UnitChips baseUnit={baseUnit} variants={unitVariants} value={unit} onChange={setUnit} />

      {isLoading ? (
        <ActivityIndicator color={colors.brand} style={styles.loader} />
      ) : !stats || stats.count === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="pricetag-outline" size={40} color={colors.border} />
          <Text style={styles.emptyText}>No price history</Text>
        </View>
      ) : (
        <>
          <View style={styles.statsRow} testID="price-stats">
            {([["Min", stats.min], ["Avg", stats.avg], ["Max", stats.max], ["Latest", stats.latest]] as const).map(([label, v]) => (
              <View key={label} style={styles.stat}>
                <Text style={styles.statLabel}>{label}</Text>
                <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{money(v)}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.caption}>Per {shownUnit} · {stats.count} line{stats.count === 1 ? "" : "s"} in period</Text>

          {rows.map((r, idx) => (
            <View key={r.id} style={[styles.row, idx < rows.length - 1 && styles.rowBorder]}>
              <View style={styles.left}>
                <Text
                  style={[styles.doc, { color: colors.brand }]}
                  onPress={() => router.push(`/(invoices)/${r.invoiceId}` as never)}
                >
                  {r.invoiceNumber}
                </Text>
                <Text style={styles.muted}>{formatDate(r.invoiceDate)}</Text>
                <Text style={styles.secondary}>{r.partyName}</Text>
              </View>
              <View style={styles.right}>
                <Text style={styles.price}>{money(r.price)}</Text>
                {r.selectedUnit && r.selectedUnit !== shownUnit ? (
                  <Text style={styles.muted}>billed {money(r.unitPrice)}/{r.selectedUnit}</Text>
                ) : null}
              </View>
            </View>
          ))}
          {page.hasNextPage && (
            <TouchableOpacity
              style={styles.more}
              onPress={() => page.fetchNextPage()}
              disabled={page.isFetchingNextPage}
              accessibilityRole="button"
              accessibilityLabel="Load more"
            >
              {page.isFetchingNextPage ? (
                <ActivityIndicator color={colors.brand} />
              ) : (
                <Text style={[styles.moreText, { color: colors.brand }]}>Load more</Text>
              )}
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { gap: 12, paddingHorizontal: 20, paddingTop: 12 },
  chipRow: { flexDirection: "row", gap: 8 },
  loader: { paddingVertical: 32 },
  empty: { alignItems: "center", paddingVertical: 48, gap: 12 },
  emptyText: { fontSize: 15, color: colors.textMuted },
  statsRow: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: 10, padding: 8, borderWidth: 1, borderColor: colors.border },
  statLabel: { fontSize: 10, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase" },
  statValue: { fontSize: 13, fontWeight: "700", color: colors.textPrimary, marginTop: 2 },
  caption: { fontSize: 11, color: colors.textMuted },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 12 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.surface },
  left: { flex: 1, gap: 2 },
  right: { alignItems: "flex-end", gap: 2 },
  doc: { fontSize: 14, fontWeight: "600" },
  muted: { fontSize: 12, color: colors.textMuted },
  secondary: { fontSize: 12, color: colors.textSecondary },
  price: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  more: { alignItems: "center", paddingVertical: 14 },
  moreText: { fontSize: 14, fontWeight: "600" },
}));
