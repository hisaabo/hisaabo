import { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
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
import { calcInvoiceTotals } from "@hisaabo/shared";
import { makeStyles } from "../../../../src/lib/makeStyles";
import { useColors } from "../../../../src/contexts/ThemeContext";
import { haptic } from "../../../../src/lib/haptics";
import { DatePickerField } from "../../../../src/components/ui";
import { LineItemNotesField } from "../../../../src/components/LineItemNotesField";

interface LineItem {
  itemId?: string;
  itemName: string;
  /** Free-text per-line note (maps to backend `description`). */
  notes: string;
  quantity: string;
  unitPrice: string;
  taxPercent: string;
  discountPercent: string;
}

function newLineItem(): LineItem {
  return {
    itemName: "",
    notes: "",
    quantity: "1",
    unitPrice: "0",
    taxPercent: "0",
    discountPercent: "0",
  };
}

function todayDate() {
  return new Date();
}

function in30daysDate() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d;
}

function safeNum(s: string) {
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// ── Party Picker ────────────────────────────────────────────────

interface PartyPickerProps {
  visible: boolean;
  onSelect: (party: { id: string; name: string }) => void;
  onClose: () => void;
}

function PartyPickerModal({ visible, onSelect, onClose }: PartyPickerProps) {
  const modalStyles = useModalStyles();
  const colors = useColors();
  const [search, setSearch] = useState("");
  const { data } = trpc.party.list.useQuery(
    { type: "customer", page: 1, limit: 200 },
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
            <Text style={modalStyles.title}>Select Customer</Text>
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
            ListEmptyComponent={<Text style={modalStyles.emptyText}>No customers found</Text>}
          />
        </View>
      </View>
    </Modal>
  );
}

// ── Item Picker ────────────────────────────────────────────────

interface ItemPickerProps {
  visible: boolean;
  onSelect: (item: { id: string; name: string; salePrice?: string | null; taxPercent: string }) => void;
  onClose: () => void;
}

function ItemPickerModal({ visible, onSelect, onClose }: ItemPickerProps) {
  const modalStyles = useModalStyles();
  const colors = useColors();
  const [search, setSearch] = useState("");
  const { data } = trpc.item.list.useQuery({ page: 1, limit: 200 }, { enabled: visible });
  const items = data?.data ?? [];
  const filtered = search
    ? items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()))
    : items;

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={modalStyles.overlay}>
        <View style={modalStyles.sheet}>
          <View style={modalStyles.header}>
            <Text style={modalStyles.title}>Select Item</Text>
            <TouchableOpacity onPress={onClose} style={modalStyles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={modalStyles.searchWrap}>
            <Ionicons name="search-outline" size={15} color={colors.textMuted} style={modalStyles.searchIcon} />
            <TextInput
              style={modalStyles.searchInput}
              placeholder="Search items..."
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
                  <Ionicons name="cube-outline" size={16} color={colors.brand} />
                </View>
                <View style={modalStyles.listItemContent}>
                  <Text style={modalStyles.listItemName}>{item.name}</Text>
                  <Text style={modalStyles.listItemSub}>
                    {item.salePrice ? formatCurrency(item.salePrice) : "No price"} · GST {item.taxPercent}%
                  </Text>
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={modalStyles.emptyText}>No items found</Text>}
          />
        </View>
      </View>
    </Modal>
  );
}

// ── Line Item Row ──────────────────────────────────────────────

interface LineItemRowProps {
  item: LineItem;
  index: number;
  onChange: (index: number, field: keyof LineItem, value: string) => void;
  onRemove: (index: number) => void;
  onPickItem: (index: number) => void;
}

function LineItemRow({ item, index, onChange, onRemove, onPickItem }: LineItemRowProps) {
  const styles = useStyles();
  const colors = useColors();
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
        <TouchableOpacity style={styles.descPickerBtn} onPress={() => onPickItem(index)} activeOpacity={0.7}>
          <Text style={item.itemName ? styles.descText : styles.descPlaceholder} numberOfLines={1}>
            {item.itemName || "Tap to select item..."}
          </Text>
          <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onRemove(index)} style={styles.removeBtn}>
          <Ionicons name="close-circle" size={20} color={colors.danger} />
        </TouchableOpacity>
      </View>

      {item.itemName ? (
        <LineItemNotesField value={item.notes} onChange={(v) => onChange(index, "notes", v)} />
      ) : null}

      <View style={styles.lineItemFields}>
        {(["quantity", "unitPrice", "taxPercent", "discountPercent"] as const).map((field, fi) => (
          <View style={styles.lineField} key={field}>
            <Text style={styles.fieldLabel}>{["Qty", "Rate (₹)", "GST %", "Disc %"][fi]}</Text>
            <TextInput
              style={styles.fieldInput}
              value={item[field]}
              onChangeText={(v) => onChange(index, field, v)}
              keyboardType="decimal-pad"
              placeholder={fi === 1 ? "0" : "0"}
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

// ── Main Screen ────────────────────────────────────────────────

export default function QuotationCreateScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const [selectedParty, setSelectedParty] = useState<{ id: string; name: string } | null>(null);
  const [invoiceDate, setInvoiceDate] = useState(todayDate());
  const [dueDate, setDueDate] = useState(in30daysDate());
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([newLineItem()]);
  const [showPartyPicker, setShowPartyPicker] = useState(false);
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [activeLineIndex, setActiveLineIndex] = useState(0);

  const utils = trpc.useUtils();

  const createMutation = trpc.quotation.create.useMutation({
    onSuccess: () => {
      utils.quotation.list.invalidate();
      utils.party.list.invalidate();
      utils.item.list.invalidate();
      haptic.success();
      router.back();
    },
    onError: (err) => {
      Alert.alert("Error", err.message);
    },
  });

  const totals = useMemo(() => {
    const validItems = lineItems.filter((li) => li.itemName.trim().length > 0);
    if (validItems.length === 0) {
      return { subtotal: "0", taxTotal: "0", lineDiscountTotal: "0", invoiceDiscountAmount: "0", chargesTotal: "0", roundOff: "0", total: "0" };
    }
    return calcInvoiceTotals({
      lineItems: validItems.map((li) => ({
        quantity: li.quantity || "1",
        unitPrice: li.unitPrice || "0",
        taxPercent: li.taxPercent || "0",
        discountPercent: li.discountPercent || "0",
      })),
    });
  }, [lineItems]);

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

  const handlePickItemForLine = useCallback((index: number) => {
    setActiveLineIndex(index);
    setShowItemPicker(true);
  }, []);

  const handleItemSelected = useCallback(
    (item: { id: string; name: string; salePrice?: string | null; taxPercent: string }) => {
      setLineItems((prev) => {
        const next = [...prev];
        next[activeLineIndex] = {
          ...next[activeLineIndex],
          itemId: item.id,
          itemName: item.name,
          unitPrice: item.salePrice ?? "0",
          taxPercent: item.taxPercent,
        };
        return next;
      });
    },
    [activeLineIndex]
  );

  const handleCreate = useCallback(() => {
    if (!selectedParty) {
      Alert.alert("Validation", "Please select a customer.");
      return;
    }
    const validItems = lineItems.filter(
      (li) => li.itemName.trim().length > 0 && parseFloat(li.quantity) > 0
    );
    if (validItems.length === 0) {
      Alert.alert("Validation", "Add at least one item.");
      return;
    }

    createMutation.mutate({
      partyId: selectedParty.id,
      type: "sale",
      documentType: "quotation",
      invoiceDate: invoiceDate.toISOString(),
      dueDate: dueDate.toISOString(),
      notes: notes.trim() || undefined,
      additionalCharges: "0",
      invoiceDiscount: "0",
      invoiceDiscountType: "amount",
      roundOff: "0",
      // Bug B: itemName is the required name snapshot; description is the
      // optional free-text per-line note (empty → omitted).
      lineItems: validItems.map((li) => ({
        itemId: li.itemId,
        itemName: li.itemName.trim(),
        description: li.notes.trim() || undefined,
        quantity: li.quantity || "1",
        unitPrice: li.unitPrice || "0",
        taxPercent: li.taxPercent || "0",
        discountPercent: li.discountPercent || "0",
      })),
    });
  }, [selectedParty, lineItems, invoiceDate, dueDate, notes, createMutation]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>New Quotation</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Party */}
          <Text style={styles.sectionLabel}>Customer</Text>
          <TouchableOpacity
            style={[styles.selectorBtn, selectedParty ? styles.selectorBtnFilled : {}]}
            onPress={() => setShowPartyPicker(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="person-outline" size={18} color={selectedParty ? colors.textPrimary : colors.textMuted} style={styles.selectorIcon} />
            <Text style={selectedParty ? styles.selectorValueText : styles.selectorPlaceholder}>
              {selectedParty ? selectedParty.name : "Select customer..."}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>

          {/* Dates */}
          <Text style={styles.sectionLabel}>Dates</Text>
          <View style={styles.datesRow}>
            <View style={styles.dateCard}>
              <DatePickerField
                label="Quotation Date"
                value={invoiceDate}
                onChange={setInvoiceDate}
              />
            </View>
            <View style={styles.dateCard}>
              <DatePickerField
                label="Valid Until"
                value={dueDate}
                onChange={setDueDate}
                minimumDate={invoiceDate}
              />
            </View>
          </View>

          {/* Line Items */}
          <View style={styles.lineItemsHeader}>
            <Text style={styles.sectionLabel}>Items</Text>
            <Text style={styles.lineCount}>{lineItems.length} {lineItems.length === 1 ? "item" : "items"}</Text>
          </View>

          {lineItems.map((li, idx) => (
            <LineItemRow
              key={idx}
              item={li}
              index={idx}
              onChange={handleLineChange}
              onRemove={handleRemoveLine}
              onPickItem={handlePickItemForLine}
            />
          ))}

          <TouchableOpacity style={styles.addItemBtn} onPress={() => setLineItems((p) => [...p, newLineItem()])} activeOpacity={0.7}>
            <Ionicons name="add-circle-outline" size={18} color={colors.brand} />
            <Text style={styles.addItemBtnText}>Add Item</Text>
          </TouchableOpacity>

          {/* Notes */}
          <Text style={styles.sectionLabel}>Notes (optional)</Text>
          <TextInput
            style={styles.notesInput}
            value={notes}
            onChangeText={setNotes}
            placeholder="Terms, delivery info, etc."
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />

          {/* Totals */}
          <Text style={styles.sectionLabel}>Summary</Text>
          <View style={styles.totalsCard}>
            {parseFloat(totals.lineDiscountTotal) > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Discount</Text>
                <Text style={[styles.totalValue, { color: colors.success }]}>-{formatCurrency(totals.lineDiscountTotal)}</Text>
              </View>
            )}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>{formatCurrency(totals.subtotal)}</Text>
            </View>
            {parseFloat(totals.taxTotal) > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Tax</Text>
                <Text style={styles.totalValue}>{formatCurrency(totals.taxTotal)}</Text>
              </View>
            )}
            <View style={styles.totalDivider} />
            <View style={styles.totalRow}>
              <Text style={styles.totalLabelBold}>Total</Text>
              <Text style={styles.totalValueBold}>{formatCurrency(totals.total)}</Text>
            </View>
          </View>

          <View style={{ height: 100 }} />
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.createBtn, createMutation.isPending && styles.createBtnDisabled]}
            onPress={handleCreate}
            activeOpacity={0.85}
            disabled={createMutation.isPending || !selectedParty || !lineItems.some((li) => li.itemName.trim() && li.unitPrice)}
          >
            {createMutation.isPending ? (
              <ActivityIndicator color={colors.textPrimary} size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={20} color={colors.textPrimary} />
                <Text style={styles.createBtnText}>Create Quotation</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <PartyPickerModal
        visible={showPartyPicker}
        onSelect={setSelectedParty}
        onClose={() => setShowPartyPicker(false)}
      />
      <ItemPickerModal
        visible={showItemPicker}
        onSelect={handleItemSelected}
        onClose={() => setShowItemPicker(false)}
      />
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  topBarTitle: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.textPrimary },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
  },
  selectorBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  selectorBtnFilled: { borderColor: colors.brand + "60" },
  selectorIcon: { marginRight: 10 },
  selectorValueText: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.textPrimary },
  selectorPlaceholder: { flex: 1, fontSize: 15, color: colors.textMuted },
  datesRow: { flexDirection: "row", gap: 10 },
  dateCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  dateLabel: { fontSize: 11, color: colors.textMuted, fontWeight: "500", marginBottom: 4 },
  dateValue: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  lineItemsHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 16, marginBottom: 8 },
  lineCount: { fontSize: 12, color: colors.textMuted },
  lineItemCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
  },
  lineItemHeader: { flexDirection: "row", alignItems: "center", marginBottom: 10, gap: 8 },
  descPickerBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  descText: { flex: 1, fontSize: 13, fontWeight: "600", color: colors.textPrimary },
  descPlaceholder: { flex: 1, fontSize: 13, color: colors.textMuted },
  removeBtn: { padding: 4 },
  descInput: {
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: colors.textPrimary,
    marginBottom: 10,
  },
  lineItemFields: { flexDirection: "row", gap: 8, marginBottom: 10 },
  lineField: { flex: 1 },
  fieldLabel: { fontSize: 10, color: colors.textMuted, fontWeight: "500", marginBottom: 4 },
  fieldInput: {
    backgroundColor: colors.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 7,
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
  lineTotalLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "500" },
  lineTotalValue: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  addItemBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.brand + "40",
    borderStyle: "dashed",
    paddingVertical: 14,
    gap: 8,
    marginBottom: 4,
  },
  addItemBtnText: { fontSize: 14, fontWeight: "600", color: colors.brand },
  notesInput: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.textPrimary,
    minHeight: 80,
  },
  totalsCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5 },
  totalLabel: { fontSize: 14, color: colors.textSecondary },
  totalValue: { fontSize: 14, color: colors.textPrimary, fontWeight: "500" },
  totalDivider: { height: 1, backgroundColor: colors.border, marginVertical: 8 },
  totalLabelBold: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  totalValueBold: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand,
    borderRadius: 16,
    paddingVertical: 16,
    gap: 10,
    shadowColor: colors.brand,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  createBtnDisabled: { opacity: 0.7 },
  createBtnText: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
}));

const useModalStyles = makeStyles((colors) => ({
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
  listItemContent: { flex: 1 },
  listItemName: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  listItemSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  emptyText: { textAlign: "center", paddingTop: 40, fontSize: 14, color: colors.textMuted },
}));
