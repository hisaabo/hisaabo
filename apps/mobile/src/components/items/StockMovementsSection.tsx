import { useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../lib/trpc";
import { formatDate, formatQuantity } from "../../lib/utils";
import { makeStyles } from "../../lib/makeStyles";
import { useColors } from "../../contexts/ThemeContext";
import { PeriodChips, UnitChips, type HistoryPeriod } from "./HistoryControls";

const PAGE_SIZE = 30;

interface Props {
  itemId: string;
  baseUnit: string;
  unitVariants: { unit: string }[] | null | undefined;
}

/**
 * Stock movements for the selected period, shown in the chosen unit (base unit
 * or any unit variant; converted server-side via conversion factors). Totals
 * cover the whole period; rows load page by page.
 */
export function StockMovementsSection({ itemId, baseUnit, unitVariants }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const [period, setPeriod] = useState<HistoryPeriod>("all");
  const [unit, setUnit] = useState(baseUnit);

  const { data: summary, isLoading } = trpc.item.stockSummary.useQuery({ id: itemId, period, unit });
  const page = trpc.item.stockMovementsPage.useInfiniteQuery(
    { id: itemId, period, unit, limit: PAGE_SIZE },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  const rows = page.data?.pages.flatMap((p) => p.rows) ?? [];
  const stats = summary?.stats;
  const shownUnit = summary?.unit ?? unit;

  return (
    <View style={styles.wrap}>
      <PeriodChips value={period} onChange={setPeriod} />
      <UnitChips baseUnit={baseUnit} variants={unitVariants} value={unit} onChange={setUnit} />

      {isLoading ? (
        <ActivityIndicator color={colors.brand} style={styles.loader} />
      ) : !stats || stats.count === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="git-commit-outline" size={40} color={colors.border} />
          <Text style={styles.emptyText}>No stock movements</Text>
        </View>
      ) : (
        <>
          <View style={styles.totals} testID="stock-totals">
            <Text style={[styles.pill, styles.pillIn]}>In +{formatQuantity(stats.totalIn)} {shownUnit}</Text>
            <Text style={[styles.pill, styles.pillOut]}>Out -{formatQuantity(stats.totalOut)} {shownUnit}</Text>
            <Text style={styles.count}>{stats.count} movements</Text>
          </View>

          {rows.map((r, idx) => {
            const isIn = r.direction === "in";
            return (
              <View key={r.id} style={[styles.row, idx < rows.length - 1 && styles.rowBorder]}>
                <View style={[styles.arrow, isIn ? styles.arrowIn : styles.arrowOut]}>
                  <Ionicons
                    name={isIn ? "arrow-down-outline" : "arrow-up-outline"}
                    size={16}
                    color={isIn ? colors.success : colors.danger}
                  />
                </View>
                <View style={styles.info}>
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
                  <Text style={[styles.qty, isIn ? styles.qtyIn : styles.qtyOut]}>
                    {isIn ? "+" : ""}{formatQuantity(r.qtyChange)} {shownUnit}
                  </Text>
                  <Text style={styles.muted}>Bal {formatQuantity(r.balance)}</Text>
                </View>
              </View>
            );
          })}
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
  loader: { paddingVertical: 32 },
  empty: { alignItems: "center", paddingVertical: 48, gap: 12 },
  emptyText: { fontSize: 15, color: colors.textMuted },
  totals: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  pill: { fontSize: 12, fontWeight: "600", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, overflow: "hidden" },
  pillIn: { color: colors.success, backgroundColor: colors.successBg },
  pillOut: { color: colors.danger, backgroundColor: colors.dangerBg },
  count: { fontSize: 12, color: colors.textMuted, marginLeft: "auto" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: 12 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.surface },
  arrow: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  arrowIn: { backgroundColor: colors.successBg },
  arrowOut: { backgroundColor: colors.dangerBg },
  info: { flex: 1, gap: 2 },
  right: { alignItems: "flex-end", gap: 2 },
  doc: { fontSize: 14, fontWeight: "600" },
  muted: { fontSize: 12, color: colors.textMuted },
  secondary: { fontSize: 12, color: colors.textSecondary },
  qty: { fontSize: 15, fontWeight: "700" },
  qtyIn: { color: colors.success },
  qtyOut: { color: colors.danger },
  more: { alignItems: "center", paddingVertical: 14 },
  moreText: { fontSize: 14, fontWeight: "600" },
}));
