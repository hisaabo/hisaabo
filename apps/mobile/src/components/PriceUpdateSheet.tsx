import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { PriceUpdateProposal, PriceUpdateSkip } from "@hisaabo/shared";
import { makeStyles } from "../lib/makeStyles";
import { useColors } from "../contexts/ThemeContext";
import { formatCurrency } from "../lib/utils";

interface Props {
  visible: boolean;
  proposals: readonly PriceUpdateProposal[];
  /** Lines that were changed but could not be offered, with the reason. */
  skipped?: readonly PriceUpdateSkip[];
  /** The bill's side: sale bills offer selling prices, purchase bills purchase prices. */
  side: "sale" | "purchase";
  /** [Update item prices]: the bill is saved, then these prices are written. */
  onUpdate: (selected: PriceUpdateProposal[]) => void;
  /** [Just this bill]: the bill is saved, the catalog is left alone. */
  onJustThisBill: () => void;
  /** Android back / backdrop / X: back to the form, nothing saved. */
  onBack: () => void;
}

/**
 * "Update saved prices?" — the one confirmation on save when the user can update
 * items and changed a rate on a catalog-linked line. Mirrors the web dialog:
 * every changed item listed with a checkbox (checked by default), two actions,
 * and the bill is saved either way.
 */
export function PriceUpdateSheet({ visible, proposals, skipped = [], side, onUpdate, onJustThisBill, onBack }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const [checked, setChecked] = useState<Set<string>>(() => new Set(proposals.map((p) => p.key)));

  // A new set of proposals (the sheet is reused across saves) starts all-checked.
  useEffect(() => {
    setChecked(new Set(proposals.map((p) => p.key)));
  }, [proposals]);

  const toggle = (key: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const selected = proposals.filter((p) => checked.has(p.key));

  return (
    <Modal transparent visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onBack}>
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onBack}
          accessibilityLabel="Back to editing"
        />
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              Update saved prices?
            </Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onBack} accessibilityLabel="Back to editing" activeOpacity={0.7}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.lead}>
            You changed the {side === "sale" ? "selling" : "purchase"} price on this bill. Update the item's saved price too, so the next bill starts from it.
          </Text>

          <ScrollView style={styles.list} bounces={false}>
            {proposals.map((p) => {
              const isChecked = checked.has(p.key);
              return (
                <TouchableOpacity
                  key={p.key}
                  style={styles.row}
                  onPress={() => toggle(p.key)}
                  activeOpacity={0.7}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isChecked }}
                  accessibilityLabel={`${p.label}, ${p.oldPrice === null ? "no saved price" : formatCurrency(p.oldPrice)} to ${formatCurrency(p.newPrice)}`}
                >
                  <Ionicons
                    name={isChecked ? "checkbox" : "square-outline"}
                    size={22}
                    color={isChecked ? colors.brand : colors.textMuted}
                  />
                  <View style={styles.rowText}>
                    <Text style={styles.label} numberOfLines={2}>{p.label}</Text>
                    <Text style={styles.prices}>
                      {p.oldPrice === null ? "No saved price" : formatCurrency(p.oldPrice)} → <Text style={styles.newPrice}>{formatCurrency(p.newPrice)}</Text>
                      {p.priceIncludesTax ? <Text style={styles.basis}>{"  incl. GST"}</Text> : null}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {skipped.length > 0 && (
            <View style={styles.skipped}>
              <Text style={styles.skippedTitle}>Not offered:</Text>
              {skipped.map((s, i) => (
                <Text key={`${s.itemName}-${i}`} style={styles.skippedText}>
                  {s.itemName}: {s.reason}.
                </Text>
              ))}
            </View>
          )}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={onJustThisBill} activeOpacity={0.8} accessibilityRole="button">
              <Text style={styles.secondaryText}>Just this bill</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryBtn, selected.length === 0 && styles.primaryBtnDisabled]}
              onPress={() => onUpdate(selected)}
              disabled={selected.length === 0}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ disabled: selected.length === 0 }}
            >
              <Text style={styles.primaryText}>Update item prices</Text>
            </TouchableOpacity>
          </View>
          <SafeAreaView edges={["bottom"]} />
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: Platform.OS === "ios" ? 8 : 16,
    maxHeight: "80%",
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: colors.textPrimary, fontSize: 18, fontWeight: "700" },
  closeBtn: { padding: 6 },
  lead: { color: colors.textSecondary, fontSize: 14, marginTop: 6, marginBottom: 12 },
  list: { flexGrow: 0, borderWidth: 1, borderColor: colors.borderLight, borderRadius: 12 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  rowText: { flex: 1 },
  label: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
  prices: { color: colors.textSecondary, fontSize: 14, marginTop: 2 },
  newPrice: { color: colors.textPrimary, fontWeight: "700" },
  basis: { color: colors.textMuted, fontSize: 12 },
  skipped: { marginTop: 10 },
  skippedTitle: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },
  skippedText: { color: colors.textMuted, fontSize: 12 },
  actions: { flexDirection: "row", gap: 10, marginTop: 16 },
  secondaryBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryText: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
  primaryBtn: { flex: 1, alignItems: "center", paddingVertical: 14, borderRadius: 12, backgroundColor: colors.brand },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
}));
