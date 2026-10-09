import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles } from "../../lib/makeStyles";
import { useColors } from "../../contexts/ThemeContext";

export type ItemTypeValue = "product" | "service";

export const ITEM_TYPE_LOCK_HINT =
  "Type can't be changed because this item already has invoices, documents or stock movements.";

interface Props {
  value: ItemTypeValue;
  onChange: (v: ItemTypeValue) => void;
  /** True when the item has transactions (item.getById.hasTransactions). The API rejects the change too. */
  locked?: boolean;
}

const OPTIONS: { value: ItemTypeValue; label: string; icon: "cube-outline" | "briefcase-outline" }[] = [
  { value: "product", label: "Product", icon: "cube-outline" },
  { value: "service", label: "Service", icon: "briefcase-outline" },
];

export function ItemTypeToggle({ value, onChange, locked = false }: Props) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View>
      <View style={[styles.typeToggle, locked && styles.locked]}>
        {OPTIONS.map((o) => {
          const active = value === o.value;
          return (
            <TouchableOpacity
              key={o.value}
              style={[styles.typeOption, active && styles.typeOptionActive]}
              onPress={() => onChange(o.value)}
              disabled={locked}
              accessibilityRole="button"
              accessibilityLabel={o.label}
              accessibilityState={{ disabled: locked, selected: active }}
              activeOpacity={0.8}
            >
              <Ionicons name={o.icon} size={18} color={active ? colors.textPrimary : colors.textMuted} />
              <Text style={[styles.typeOptionText, active && styles.typeOptionTextActive]}>{o.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {locked && <Text style={styles.hint}>{ITEM_TYPE_LOCK_HINT}</Text>}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  typeToggle: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  locked: { opacity: 0.6 },
  typeOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 9,
    gap: 8,
  },
  typeOptionActive: { backgroundColor: colors.brand },
  typeOptionText: { fontSize: 15, fontWeight: "600", color: colors.textMuted },
  typeOptionTextActive: { color: colors.textPrimary },
  hint: { marginTop: 8, fontSize: 12, color: colors.textMuted },
}));
