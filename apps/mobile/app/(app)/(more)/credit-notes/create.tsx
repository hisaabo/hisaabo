import { useState, useMemo, useCallback, useEffect } from "react";
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
import { useRouter, useLocalSearchParams } from "expo-router";
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
  return { itemName: "", notes: "", quantity: "1", unitPrice: "0", taxPercent: "0", discountPercent: "0" };
}

function todayDate() { return new Date(); }
function safeNum(s: string) { const n = parseFloat(s); return isNaN(n) ? 0 : n; }

function PartyPickerModal({
  visible,
  onSelect,
  onClose,
}: {
  visible: boolean;
  onSelect: (p: { id: string; name: string }) => void;
  onClose: () => void;
}) {
  const ms = useMs();
  const colors = useColors();
  const [search, setSearch] = useState("");
  const { data } = trpc.party.list.useQuery({ page: 1, limit: 200 }, { enabled: visible });
  const parties = data?.data ?? [];
  const filtered = search ? parties.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())) : parties;

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={ms.overlay}>
        <View style={ms.sheet}>
          <View style={ms.header}>
            <Text style={ms.title}>Select Party</Text>
            <TouchableOpacity onPress={onClose} style={ms.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={ms.searchWrap}>
            <Ionicons name="search-outline" size={15} color={colors.textMuted} style={ms.searchIcon} />
            <TextInput style={ms.searchInput} placeholder="Search..." placeholderTextColor={colors.textMuted} value={search} onChangeText={setSearch} autoFocus />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={ms.listContent}
            renderItem={({ item }) => (
              <TouchableOpacity style={ms.listItem} onPress={() => { onSelect(item); onClose(); }} activeOpacity={0.7}>
                <View style={ms.listItemIcon}><Ionicons name="person-outline" size={16} color={colors.brand} /></View>
                <View>
                  <Text style={ms.listItemName}>{item.name}</Text>
                  {item.phone && <Text style={ms.listItemSub}>{item.phone}</Text>}
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={ms.emptyText}>No parties found</Text>}
          />
        </View>
      </View>
    </Modal>
  );
}

function ItemPickerModal({
  visible,
  onSelect,
  onClose,
}: {
  visible: boolean;
  onSelect: (i: { id: string; name: string; salePrice?: string | null; taxPercent: string }) => void;
  onClose: () => void;
}) {
  const ms = useMs();
  const colors = useColors();
  const [search, setSearch] = useState("");
  const { data } = trpc.item.list.useQuery({ page: 1, limit: 200 }, { enabled: visible });
  const items = data?.data ?? [];
  const filtered = search ? items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase())) : items;

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={ms.overlay}>
        <View style={ms.sheet}>
          <View style={ms.header}>
            <Text style={ms.title}>Select Item</Text>
            <TouchableOpacity onPress={onClose} style={ms.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={ms.searchWrap}>
            <Ionicons name="search-outline" size={15} color={colors.textMuted} style={ms.searchIcon} />
            <TextInput style={ms.searchInput} placeholder="Search items..." placeholderTextColor={colors.textMuted} value={search} onChangeText={setSearch} autoFocus />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={ms.listContent}
            renderItem={({ item }) => (
              <TouchableOpacity style={ms.listItem} onPress={() => { onSelect(item); onClose(); }} activeOpacity={0.7}>
                <View style={ms.listItemIcon}><Ionicons name="cube-outline" size={16} color={colors.brand} /></View>
                <View style={ms.listItemContent}>
                  <Text style={ms.listItemName}>{item.name}</Text>
                  <Text style={ms.listItemSub}>{item.salePrice ? formatCurrency(item.salePrice) : "No price"} · GST {item.taxPercent}%</Text>
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={ms.emptyText}>No items found</Text>}
          />
        </View>
      </View>
    </Modal>
  );
}

function LineItemRow({ item, index, onChange, onRemove, onPickItem }: {
  item: LineItem; index: number;
  onChange: (i: number, f: keyof LineItem, v: string) => void;
  onRemove: (i: number) => void; onPickItem: (i: number) => void;
}) {
  const s = useS();
  const colors = useColors();
  const lineTotal = useMemo(() => {
    const q = safeNum(item.quantity), p = safeNum(item.unitPrice), t = safeNum(item.taxPercent), d = safeNum(item.discountPercent);
    const after = q * p * (1 - d / 100);
    return after + after * (t / 100);
  }, [item]);

  return (
    <View style={s.lineItemCard}>
      <View style={s.lineItemHeader}>
        <TouchableOpacity style={s.descPickerBtn} onPress={() => onPickItem(index)} activeOpacity={0.7}>
          <Text style={item.itemName ? s.descText : s.descPlaceholder} numberOfLines={1}>{item.itemName || "Tap to select item..."}</Text>
          <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onRemove(index)} style={s.removeBtn}>
          <Ionicons name="close-circle" size={20} color={colors.danger} />
        </TouchableOpacity>
      </View>
      {item.itemName ? (
        <LineItemNotesField value={item.notes} onChange={(v) => onChange(index, "notes", v)} />
      ) : null}
      <View style={s.lineItemFields}>
        {(["quantity", "unitPrice", "taxPercent", "discountPercent"] as const).map((field, fi) => (
          <View style={s.lineField} key={field}>
            <Text style={s.fieldLabel}>{["Qty", "Rate (₹)", "GST %", "Disc %"][fi]}</Text>
            <TextInput style={s.fieldInput} value={item[field]} onChangeText={(v) => onChange(index, field, v)} keyboardType="decimal-pad" placeholderTextColor={colors.textMuted} />
          </View>
        ))}
      </View>
      <View style={s.lineTotalRow}>
        <Text style={s.lineTotalLabel}>Amount</Text>
        <Text style={s.lineTotalValue}>{formatCurrency(lineTotal)}</Text>
      </View>
    </View>
  );
}

export default function CreditNoteCreateScreen() {
  const s = useS();
  const colors = useColors();
  const router = useRouter();
  const { prefillFromInvoiceId } = useLocalSearchParams<{ prefillFromInvoiceId?: string }>();
  const [selectedParty, setSelectedParty] = useState<{ id: string; name: string } | null>(null);
  const [invoiceDate, setInvoiceDate] = useState(todayDate());
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([newLineItem()]);
  const [showPartyPicker, setShowPartyPicker] = useState(false);
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [activeLineIndex, setActiveLineIndex] = useState(0);
  const [referenceDocumentId, setReferenceDocumentId] = useState<string | undefined>(undefined);

  const { data: sourceInvoice } = trpc.invoice.getById.useQuery(
    { id: prefillFromInvoiceId! },
    { enabled: !!prefillFromInvoiceId }
  );

  useEffect(() => {
    if (!sourceInvoice) return;
    setReferenceDocumentId(sourceInvoice.id);
    if (sourceInvoice.party) {
      setSelectedParty({ id: sourceInvoice.partyId, name: sourceInvoice.party.name });
    }
    if (sourceInvoice.lineItems && sourceInvoice.lineItems.length > 0) {
      setLineItems(
        sourceInvoice.lineItems.map((li) => ({
          itemId: li.itemId ?? undefined,
          itemName: li.itemName,
          notes: li.description ?? "",
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          taxPercent: li.taxPercent ?? "0",
          discountPercent: li.discountPercent ?? "0",
        }))
      );
    }
    setInvoiceDate(todayDate());
  }, [sourceInvoice]);

  const utils = trpc.useUtils();

  const createMutation = trpc.creditNote.create.useMutation({
    onSuccess: () => {
      // Invalidate related caches so the list behind reflects the new
      // credit note when the user navigates back (matches web UX).
      utils.creditNote.list.invalidate();
      utils.invoice.list.invalidate();
      utils.dashboard.summary.invalidate();
      utils.party.list.invalidate();
      utils.item.list.invalidate();
      haptic.success();
      router.back();
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const totals = useMemo(() => {
    const validItems = lineItems.filter((li) => li.itemName.trim().length > 0);
    if (validItems.length === 0) return { subtotal: "0", taxTotal: "0", lineDiscountTotal: "0", invoiceDiscountAmount: "0", chargesTotal: "0", roundOff: "0", total: "0" };
    return calcInvoiceTotals({ lineItems: validItems.map((li) => ({ quantity: li.quantity || "1", unitPrice: li.unitPrice || "0", taxPercent: li.taxPercent || "0", discountPercent: li.discountPercent || "0" })) });
  }, [lineItems]);

  const handleLineChange = useCallback((index: number, field: keyof LineItem, value: string) => {
    setLineItems((prev) => { const next = [...prev]; next[index] = { ...next[index], [field]: value }; return next; });
  }, []);

  const handleRemoveLine = useCallback((index: number) => {
    setLineItems((prev) => (prev.length === 1 ? [newLineItem()] : prev.filter((_, i) => i !== index)));
  }, []);

  const handlePickItemForLine = useCallback((index: number) => { setActiveLineIndex(index); setShowItemPicker(true); }, []);

  const handleItemSelected = useCallback((item: { id: string; name: string; salePrice?: string | null; taxPercent: string }) => {
    setLineItems((prev) => { const next = [...prev]; next[activeLineIndex] = { ...next[activeLineIndex], itemId: item.id, itemName: item.name, unitPrice: item.salePrice ?? "0", taxPercent: item.taxPercent }; return next; });
  }, [activeLineIndex]);

  const handleCreate = useCallback(() => {
    if (!selectedParty) { Alert.alert("Validation", "Please select a party."); return; }
    const validItems = lineItems.filter((li) => li.itemName.trim().length > 0 && parseFloat(li.quantity) > 0);
    if (validItems.length === 0) { Alert.alert("Validation", "Add at least one item."); return; }
    createMutation.mutate({
      partyId: selectedParty.id, type: "sale", documentType: "credit_note",
      invoiceDate: invoiceDate.toISOString(), notes: notes.trim() || undefined,
      additionalCharges: "0", invoiceDiscount: "0", invoiceDiscountType: "amount", roundOff: "0",
      referenceDocumentId: referenceDocumentId,
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
  }, [selectedParty, lineItems, invoiceDate, notes, referenceDocumentId, createMutation]);

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <View style={s.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={s.topBarTitle}>New Credit Note</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={s.infoBox}>
        <Ionicons name="information-circle-outline" size={16} color={colors.info} />
        <Text style={s.infoText}>Credit notes reduce the party's outstanding balance without affecting stock.</Text>
      </View>

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={s.sectionLabel}>Party</Text>
          <TouchableOpacity style={[s.selectorBtn, selectedParty ? s.selectorBtnFilled : {}]} onPress={() => setShowPartyPicker(true)} activeOpacity={0.7}>
            <Ionicons name="person-outline" size={18} color={selectedParty ? colors.textPrimary : colors.textMuted} style={s.selectorIcon} />
            <Text style={selectedParty ? s.selectorValueText : s.selectorPlaceholder}>{selectedParty ? selectedParty.name : "Select party..."}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>

          <Text style={s.sectionLabel}>Date</Text>
          <View style={s.dateCard}>
            <DatePickerField
              label="Credit Note Date"
              value={invoiceDate}
              onChange={setInvoiceDate}
            />
          </View>

          <View style={s.lineItemsHeader}>
            <Text style={s.sectionLabel}>Items (Returned)</Text>
            <Text style={s.lineCount}>{lineItems.length} {lineItems.length === 1 ? "item" : "items"}</Text>
          </View>

          {lineItems.map((li, idx) => (
            <LineItemRow key={idx} item={li} index={idx} onChange={handleLineChange} onRemove={handleRemoveLine} onPickItem={handlePickItemForLine} />
          ))}

          <TouchableOpacity style={s.addItemBtn} onPress={() => setLineItems((p) => [...p, newLineItem()])} activeOpacity={0.7}>
            <Ionicons name="add-circle-outline" size={18} color={colors.brand} />
            <Text style={s.addItemBtnText}>Add Item</Text>
          </TouchableOpacity>

          <Text style={s.sectionLabel}>Notes (optional)</Text>
          <TextInput style={s.notesInput} value={notes} onChangeText={setNotes} placeholder="Reason for credit note..." placeholderTextColor={colors.textMuted} multiline numberOfLines={3} textAlignVertical="top" />

          <Text style={s.sectionLabel}>Summary</Text>
          <View style={s.totalsCard}>
            {parseFloat(totals.lineDiscountTotal) > 0 && (
              <View style={s.totalRow}><Text style={s.totalLabel}>Discount</Text><Text style={[s.totalValue, { color: colors.success }]}>-{formatCurrency(totals.lineDiscountTotal)}</Text></View>
            )}
            <View style={s.totalRow}><Text style={s.totalLabel}>Subtotal</Text><Text style={s.totalValue}>{formatCurrency(totals.subtotal)}</Text></View>
            {parseFloat(totals.taxTotal) > 0 && (
              <View style={s.totalRow}><Text style={s.totalLabel}>Tax</Text><Text style={s.totalValue}>{formatCurrency(totals.taxTotal)}</Text></View>
            )}
            <View style={s.totalDivider} />
            <View style={s.totalRow}><Text style={s.totalLabelBold}>Total</Text><Text style={s.totalValueBold}>{formatCurrency(totals.total)}</Text></View>
          </View>

          <View style={{ height: 100 }} />
        </ScrollView>

        <View style={s.footer}>
          <TouchableOpacity style={[s.createBtn, (createMutation.isPending || !selectedParty || !lineItems.some((li) => li.itemName.trim() && li.unitPrice)) && s.createBtnDisabled]} onPress={handleCreate} activeOpacity={0.85} disabled={createMutation.isPending || !selectedParty || !lineItems.some((li) => li.itemName.trim() && li.unitPrice)}>
            {createMutation.isPending ? <ActivityIndicator color={colors.textPrimary} size="small" /> : (
              <>
                <Ionicons name="checkmark-circle-outline" size={20} color={colors.textPrimary} />
                <Text style={s.createBtnText}>Create Credit Note</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <PartyPickerModal visible={showPartyPicker} onSelect={setSelectedParty} onClose={() => setShowPartyPicker(false)} />
      <ItemPickerModal visible={showItemPicker} onSelect={handleItemSelected} onClose={() => setShowItemPicker(false)} />
    </SafeAreaView>
  );
}

const useS = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  topBarTitle: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.textPrimary },
  infoBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.infoBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginHorizontal: 16, marginBottom: 4, borderWidth: 1, borderColor: colors.info + "30" },
  infoText: { fontSize: 12, color: colors.info, flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16 },
  sectionLabel: { fontSize: 11, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 16, marginBottom: 8 },
  selectorBtn: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 14 },
  selectorBtnFilled: { borderColor: colors.brand + "60" },
  selectorIcon: { marginRight: 10 },
  selectorValueText: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.textPrimary },
  selectorPlaceholder: { flex: 1, fontSize: 15, color: colors.textMuted },
  dateCard: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14 },
  dateLabel: { fontSize: 11, color: colors.textMuted, fontWeight: "500", marginBottom: 4 },
  dateValue: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  lineItemsHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 16, marginBottom: 8 },
  lineCount: { fontSize: 12, color: colors.textMuted },
  lineItemCard: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 },
  lineItemHeader: { flexDirection: "row", alignItems: "center", marginBottom: 10, gap: 8 },
  descPickerBtn: { flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
  descText: { flex: 1, fontSize: 13, fontWeight: "600", color: colors.textPrimary },
  descPlaceholder: { flex: 1, fontSize: 13, color: colors.textMuted },
  removeBtn: { padding: 4 },
  descInput: { backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: colors.textPrimary, marginBottom: 10 },
  lineItemFields: { flexDirection: "row", gap: 8, marginBottom: 10 },
  lineField: { flex: 1 },
  fieldLabel: { fontSize: 10, color: colors.textMuted, fontWeight: "500", marginBottom: 4 },
  fieldInput: { backgroundColor: colors.bg, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 8, paddingVertical: 7, fontSize: 13, color: colors.textPrimary, textAlign: "center" },
  lineTotalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  lineTotalLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "500" },
  lineTotalValue: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  addItemBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.brand + "40", borderStyle: "dashed", paddingVertical: 14, gap: 8, marginBottom: 4 },
  addItemBtnText: { fontSize: 14, fontWeight: "600", color: colors.brand },
  notesInput: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: colors.textPrimary, minHeight: 80 },
  totalsCard: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5 },
  totalLabel: { fontSize: 14, color: colors.textSecondary },
  totalValue: { fontSize: 14, color: colors.textPrimary, fontWeight: "500" },
  totalDivider: { height: 1, backgroundColor: colors.border, marginVertical: 8 },
  totalLabelBold: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  totalValueBold: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  footer: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },
  createBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: colors.brand, borderRadius: 16, paddingVertical: 16, gap: 10, shadowColor: colors.brand, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 6 },
  createBtnDisabled: { opacity: 0.7 },
  createBtnText: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
}));

const useMs = makeStyles((colors) => ({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border, maxHeight: "80%", paddingBottom: 32 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
  title: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.textPrimary },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  searchWrap: { flexDirection: "row", alignItems: "center", backgroundColor: colors.bg, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginHorizontal: 16, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: colors.textPrimary, padding: 0 },
  listContent: { paddingHorizontal: 16, paddingTop: 4 },
  listItem: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 12 },
  listItemIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.brand + "20", alignItems: "center", justifyContent: "center" },
  listItemContent: { flex: 1 },
  listItemName: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  listItemSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  emptyText: { textAlign: "center", paddingTop: 40, fontSize: 14, color: colors.textMuted },
}));
