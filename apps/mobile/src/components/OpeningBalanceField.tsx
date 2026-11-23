import { View, Text, TextInput, TouchableOpacity } from "react-native";
import type { OpeningBalanceDirection } from "@hisaabo/shared";
import { makeStyles } from "../lib/makeStyles";
import { useColors } from "../contexts/ThemeContext";

interface OpeningBalanceFieldProps {
  /** Unsigned amount as typed. The direction carries the sign. */
  amount: string;
  direction: OpeningBalanceDirection;
  onAmountChange: (amount: string) => void;
  onDirectionChange: (direction: OpeningBalanceDirection) => void;
  /** Party type, only to word the hint. */
  partyType?: "customer" | "supplier";
}

/**
 * A party's opening balance as an amount plus a "To receive / To pay" toggle,
 * instead of a bare signed number: the stored value is positive when they owe
 * you and negative when you owe them. `composeOpeningBalance` /
 * `splitOpeningBalance` (@hisaabo/shared) turn the pair into the stored value
 * and back. Mirrors the web form's OpeningBalanceField.
 */
export function OpeningBalanceField({
  amount,
  direction,
  onAmountChange,
  onDirectionChange,
  partyType,
}: OpeningBalanceFieldProps) {
  const styles = useStyles();
  const colors = useColors();
  const options: Array<{ value: OpeningBalanceDirection; label: string }> = [
    { value: "receive", label: "To receive" },
    { value: "pay", label: "To pay" },
  ];
  const hint =
    direction === "receive"
      ? partyType === "supplier"
        ? "To receive: the supplier owes you (for example an advance you paid)."
        : "To receive: they owe you."
      : partyType === "customer"
        ? "To pay: you owe the customer (for example an advance they paid)."
        : "To pay: you owe them.";

  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>Opening Balance</Text>
      <TextInput
        style={styles.input}
        placeholder="0.00"
        placeholderTextColor={colors.textMuted}
        value={amount}
        onChangeText={onAmountChange}
        keyboardType="decimal-pad"
        accessibilityLabel="Opening balance amount"
      />
      <View style={styles.toggle}>
        {options.map((o) => (
          <TouchableOpacity
            key={o.value}
            style={[styles.option, direction === o.value && styles.optionActive]}
            onPress={() => onDirectionChange(o.value)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ selected: direction === o.value }}
          >
            <Text style={[styles.optionText, direction === o.value && styles.optionTextActive]}>
              {o.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.hint}>{hint}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  fieldGroup: {
    paddingVertical: 12,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
    marginBottom: 6,
  },
  input: {
    fontSize: 15,
    color: colors.textPrimary,
    padding: 0,
    marginBottom: 10,
  },
  toggle: {
    flexDirection: "row",
    backgroundColor: colors.bg,
    borderRadius: 10,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  option: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 9,
    borderRadius: 8,
  },
  optionActive: {
    backgroundColor: colors.brand,
  },
  optionText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textMuted,
  },
  optionTextActive: {
    color: colors.textPrimary,
  },
  hint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 6,
  },
}));
