import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { makeStyles } from "../../lib/makeStyles";

export type HistoryPeriod = "6m" | "1y" | "all";

export function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const styles = useStyles();
  return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      activeOpacity={0.7}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const PERIODS: { value: HistoryPeriod; label: string }[] = [
  { value: "6m", label: "Last 6M" },
  { value: "1y", label: "Last 1Y" },
  { value: "all", label: "All" },
];

export function PeriodChips({ value, onChange }: { value: HistoryPeriod; onChange: (v: HistoryPeriod) => void }) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      {PERIODS.map((p) => (
        <Chip key={p.value} label={p.label} active={value === p.value} onPress={() => onChange(p.value)} />
      ))}
    </View>
  );
}

/** Base unit + each unit variant. Renders nothing when the item has no alt units. */
export function UnitChips({
  baseUnit,
  variants,
  value,
  onChange,
}: {
  baseUnit: string;
  variants: { unit: string }[] | null | undefined;
  value: string;
  onChange: (u: string) => void;
}) {
  const styles = useStyles();
  if (!variants || variants.length === 0) return null;
  const units = [baseUnit, ...variants.map((v) => v.unit).filter((u) => u !== baseUnit)];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      <Text style={styles.label}>Unit</Text>
      {units.map((u) => (
        <Chip key={u} label={u} active={value === u} onPress={() => onChange(u)} />
      ))}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { fontSize: 12, color: colors.textMuted, marginRight: 2 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
  chipTextActive: { color: "#fff" },
}));
