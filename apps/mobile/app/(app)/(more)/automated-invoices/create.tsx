import { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Modal,
  FlatList,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";
import { formatCurrency } from "../../../../src/lib/utils";
import { colors } from "../../../../src/lib/theme";
import { haptic } from "../../../../src/lib/haptics";
import { DatePickerField } from "../../../../src/components/ui";

/* ── Types & Helpers ──────────────────────────────────────────── */

type InvoiceType = "sale" | "purchase";
type Frequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "half_yearly" | "yearly" | "custom";

interface LineItem {
  description: string;
  quantity: string;
  unitPrice: string;
  taxPercent: string;
  discountPercent: string;
}

function newLineItem(): LineItem {
  return { description: "", quantity: "1", unitPrice: "0", taxPercent: "0", discountPercent: "0" };
}

function safeNum(s: string) {
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

const TYPE_OPTIONS: { value: InvoiceType; label: string }[] = [
  { value: "sale", label: "Sale" },
  { value: "purchase", label: "Purchase" },
];

const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "half_yearly", label: "Half Yearly" },
  { value: "yearly", label: "Yearly" },
  { value: "custom", label: "Custom" },
];

/* ── Party Picker Modal ───────────────────────────────────────── */

interface PartyPickerProps {
  visible: boolean;
  onSelect: (party: { id: string; name: string }) => void;
  onClose: () => void;
}

function PartyPickerModal({ visible, onSelect, onClose }: PartyPickerProps) {
  const [search, setSearch] = useState("");
  const { data } = trpc.party.list.useQuery(
    { page: 1, limit: 200 },
    { enabled: visible }
  );
  const parties = data?.data ?? [];
  const filtered = search
    ? parties.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : parties;

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={modalStyles.overlay}>
        <View style={modalStyles.sheet}>
          <View style={modalStyles.header}>
            <Text style={modalStyles.title}>Select Party</Text>
            <TouchableOpacity onPress={onClose} style={modalStyles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={modalStyles.searchWrap}>
            <Ionicons name="search-outline" size={15} color={colors.textMuted} style={modalStyles.searchIcon} />
            <TextInput
              style={modalStyles.searchInput}
              placeholder="Search..."
              placeholderTextColor={colors.textMuted}
              value={search}
              onChangeText={setSearch}
              autoFocus
            />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={modalStyles.listContent}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={modalStyles.listItem}
                onPress={() => { onSelect(item); onClose(); }}
                activeOpacity={0.7}
              >
                <View style={modalStyles.listItemIcon}>
                  <Ionicons name="person-outline" size={16} color={colors.brand} />
                </View>
                <View>
                  <Text style={modalStyles.listItemName}>{item.name}</Text>
                  {item.phone && <Text style={modalStyles.listItemSub}>{item.phone}</Text>}
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={modalStyles.emptyText}>No parties found</Text>}
          />
        </View>
      </View>
    </Modal>
  );
}

/* ── Line Item Row ────────────────────────────────────────────── */

interface LineItemRowProps {
  item: LineItem;
  index: number;
  onChange: (index: number, field: keyof LineItem, value: string) => void;
  onRemove: (index: number) => void;
}

function LineItemRow({ item, index, onChange, onRemove }: LineItemRowProps) {
  const lineTotal = useMemo(() => {
    const qty = safeNum(item.quantity);
    const price = safeNum(item.unitPrice);
    const tax = safeNum(item.taxPercent);
    const disc = safeNum(item.discountPercent);
    const subtotal = qty * price;
    const afterDiscount = subtotal * (1 - disc / 100);
    return afterDiscount + afterDiscount * (tax / 100);
  }, [item]);

  return (
    <View style={styles.lineItemCard}>
      <View style={styles.lineItemHeader}>
        <Text style={styles.lineItemIndex}>#{index + 1}</Text>
        <TouchableOpacity onPress={() => onRemove(index)} style={styles.removeBtn}>
          <Ionicons name="close-circle" size={20} color={colors.danger} />
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.descInput}
        value={item.description}
        onChangeText={(v) => onChange(index, "description", v)}
        placeholder="Item description"
        placeholderTextColor={colors.textMuted}
        multiline
        numberOfLines={2}
      />

      <View style={styles.lineItemFields}>
        {(["quantity", "unitPrice", "taxPercent", "discountPercent"] as const).map((field, fi) => (
          <View style={styles.lineField} key={field}>
            <Text style={styles.fieldLabel}>{["Qty", "Rate", "GST %", "Disc %"][fi]}</Text>
            <TextInput
              style={styles.fieldInput}
              value={item[field]}
              onChangeText={(v) => onChange(index, field, v)}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textMuted}
            />
          </View>
        ))}
      </View>

      <View style={styles.lineTotalRow}>
        <Text style={styles.lineTotalLabel}>Amount</Text>
        <Text style={styles.lineTotalValue}>{formatCurrency(lineTotal)}</Text>
      </View>
    </View>
  );
}

/* ── Main Screen ──────────────────────────────────────────────── */

export default function CreateRecurringInvoiceScreen() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [selectedParty, setSelectedParty] = useState<{ id: string; name: string } | null>(null);
  const [type, setType] = useState<InvoiceType>("sale");
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [customIntervalDays, setCustomIntervalDays] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([newLineItem()]);
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [showEndDate, setShowEndDate] = useState(false);
  const [maxRuns, setMaxRuns] = useState("");
  const [notes, setNotes] = useState("");
  const [showPartyPicker, setShowPartyPicker] = useState(false);

  const createMutation = trpc.recurringInvoice.create.useMutation({
    onSuccess: () => {
      haptic.success();
      Alert.alert("Success", "Recurring invoice template created", [
        { text: "OK", onPress: () => router.back() },
      ]);
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to create template");
    },
  });

  const handleLineChange = useCallback((index: number, field: keyof LineItem, value: string) => {
    setLineItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }, []);

  const handleRemoveLine = useCallback((index: number) => {
    setLineItems((prev) => (prev.length === 1 ? [newLineItem()] : prev.filter((_, i) => i !== index)));
  }, []);

  const handleSubmit = useCallback(() => {
    if (!name.trim()) {
      Alert.alert("Validation", "Please enter a template name");
      return;
    }
    if (!selectedParty) {
      Alert.alert("Validation", "Please select a party");
      return;
    }

    const validItems = lineItems.filter((li) => li.description.trim().length > 0);
    if (validItems.length === 0) {
      Alert.alert("Validation", "Add at least one line item with a description");
      return;
    }

    if (frequency === "custom" && (!customIntervalDays || parseInt(customIntervalDays) < 1)) {
      Alert.alert("Validation", "Please enter a valid custom interval in days");
      return;
    }

    haptic.success();
    createMutation.mutate({
      name: name.trim(),
      partyId: selectedParty.id,
      type,
      frequency,
      customIntervalDays: frequency === "custom" ? parseInt(customIntervalDays) : undefined,
      // Post Bug B: map local description (display) onto backend itemName.
      // Stage 3 will split the client state into two fields.
      lineItems: validItems.map((li) => ({
        itemName: li.description.trim(),
        quantity: li.quantity || "1",
        unitPrice: li.unitPrice || "0",
        taxPercent: li.taxPercent || "0",
        discountPercent: li.discountPercent || "0",
      })),
      startDate: startDate.toISOString(),
      endDate: showEndDate && endDate ? endDate.toISOString() : undefined,
      maxRuns: maxRuns ? parseInt(maxRuns) : undefined,
      notes: notes.trim() || undefined,
    });
  }, [name, selectedParty, type, frequency, customIntervalDays, lineItems, startDate, endDate, showEndDate, maxRuns, notes, createMutation]);

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Name */}
          <View style={styles.section}>
            <Text style={styles.label}>Template Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Monthly Rent - ABC Corp"
              placeholderTextColor={colors.textMuted}
              value={name}
              onChangeText={setName}
            />
          </View>

          {/* Party Picker */}
          <View style={styles.section}>
            <Text style={styles.label}>Party *</Text>
            <TouchableOpacity
              style={styles.pickerBtn}
              onPress={() => setShowPartyPicker(true)}
              activeOpacity={0.7}
            >
              <Text
                style={selectedParty ? styles.pickerBtnText : styles.pickerBtnPlaceholder}
                numberOfLines={1}
              >
                {selectedParty?.name ?? "Select a party..."}
              </Text>
              <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Type */}
          <View style={styles.section}>
            <Text style={styles.label}>Invoice Type *</Text>
            <View style={styles.chipRow}>
              {TYPE_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.chip, type === opt.value && styles.chipActive]}
                  onPress={() => setType(opt.value)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, type === opt.value && styles.chipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Frequency */}
          <View style={styles.section}>
            <Text style={styles.label}>Frequency *</Text>
            <View style={styles.chipRow}>
              {FREQUENCY_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.chip, frequency === opt.value && styles.chipActive]}
                  onPress={() => setFrequency(opt.value)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, frequency === opt.value && styles.chipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {frequency === "custom" && (
              <View style={{ marginTop: 10 }}>
                <Text style={styles.label}>Interval (days) *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 45"
                  placeholderTextColor={colors.textMuted}
                  value={customIntervalDays}
                  onChangeText={setCustomIntervalDays}
                  keyboardType="number-pad"
                />
              </View>
            )}
          </View>

          {/* Line Items */}
          <View style={styles.section}>
            <Text style={styles.label}>Line Items *</Text>
            {lineItems.map((li, i) => (
              <LineItemRow
                key={i}
                item={li}
                index={i}
                onChange={handleLineChange}
                onRemove={handleRemoveLine}
              />
            ))}
            <TouchableOpacity
              style={styles.addLineBtn}
              onPress={() => setLineItems((prev) => [...prev, newLineItem()])}
              activeOpacity={0.7}
            >
              <Ionicons name="add-circle-outline" size={18} color={colors.brand} />
              <Text style={styles.addLineBtnText}>Add Line Item</Text>
            </TouchableOpacity>
          </View>

          {/* Start Date */}
          <View style={styles.section}>
            <DatePickerField
              label="Start Date"
              value={startDate}
              onChange={setStartDate}
            />
          </View>

          {/* End Date (optional) */}
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.optionalToggle}
              onPress={() => {
                setShowEndDate(!showEndDate);
                if (!showEndDate && !endDate) {
                  const d = new Date();
                  d.setFullYear(d.getFullYear() + 1);
                  setEndDate(d);
                }
              }}
              activeOpacity={0.7}
            >
              <Ionicons
                name={showEndDate ? "checkbox" : "square-outline"}
                size={20}
                color={showEndDate ? colors.brand : colors.textMuted}
              />
              <Text style={styles.optionalToggleText}>Set End Date</Text>
            </TouchableOpacity>
            {showEndDate && endDate && (
              <View style={{ marginTop: 8 }}>
                <DatePickerField
                  label=""
                  value={endDate}
                  onChange={setEndDate}
                />
              </View>
            )}
          </View>

          {/* Max Runs (optional) */}
          <View style={styles.section}>
            <Text style={styles.label}>Max Runs (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="Leave blank for unlimited"
              placeholderTextColor={colors.textMuted}
              value={maxRuns}
              onChangeText={setMaxRuns}
              keyboardType="number-pad"
            />
          </View>

          {/* Notes */}
          <View style={styles.section}>
            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Notes to include on generated invoices..."
              placeholderTextColor={colors.textMuted}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitBtn, createMutation.isPending && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={createMutation.isPending}
            activeOpacity={0.85}
          >
            {createMutation.isPending ? (
              <ActivityIndicator color={colors.textPrimary} size="small" />
            ) : (
              <Text style={styles.submitBtnText}>Create Template</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <PartyPickerModal
        visible={showPartyPicker}
        onSelect={setSelectedParty}
        onClose={() => setShowPartyPicker(false)}
      />
    </SafeAreaView>
  );
}

/* ── Styles ────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  section: { marginBottom: 20 },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 15,
  },
  textArea: { minHeight: 80, paddingTop: 12 },
  pickerBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pickerBtnText: { fontSize: 15, color: colors.textPrimary, flex: 1 },
  pickerBtnPlaceholder: { fontSize: 15, color: colors.textMuted, flex: 1 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.brandLight, borderColor: colors.brand },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  chipTextActive: { color: colors.brand },

  // Line items
  lineItemCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  lineItemHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  lineItemIndex: { fontSize: 12, fontWeight: "700", color: colors.textMuted },
  removeBtn: { padding: 4 },
  descInput: {
    fontSize: 14,
    color: colors.textPrimary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 8,
    marginBottom: 10,
    minHeight: 36,
  },
  lineItemFields: { flexDirection: "row", gap: 8, marginBottom: 8 },
  lineField: { flex: 1 },
  fieldLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: colors.textMuted,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  fieldInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 13,
    color: colors.textPrimary,
    textAlign: "center",
  },
  lineTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  lineTotalLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  lineTotalValue: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  addLineBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.brand,
    borderStyle: "dashed",
  },
  addLineBtnText: { fontSize: 14, fontWeight: "600", color: colors.brand },

  // Optional toggle
  optionalToggle: { flexDirection: "row", alignItems: "center", gap: 8 },
  optionalToggleText: { fontSize: 14, color: colors.textSecondary, fontWeight: "600" },

  // Submit
  submitBtn: {
    backgroundColor: colors.brand,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: colors.textPrimary, fontSize: 16, fontWeight: "700" },
});

/* ── Modal Styles ──────────────────────────────────────────────── */

const modalStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
    maxHeight: "80%",
    paddingBottom: 32,
  },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
  title: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.textPrimary },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: colors.textPrimary, padding: 0 },
  listContent: { paddingHorizontal: 16, paddingTop: 4 },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  listItemIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.brand + "20",
    alignItems: "center",
    justifyContent: "center",
  },
  listItemName: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  listItemSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  emptyText: { textAlign: "center", paddingTop: 40, fontSize: 14, color: colors.textMuted },
});
