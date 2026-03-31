import { useState, useMemo, useCallback, useEffect } from "react";
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
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../src/lib/trpc";
import { formatCurrency } from "../../../src/lib/utils";
import { calcInvoiceTotals } from "@hisaabo/shared";
import { colors } from "../../../src/lib/theme";
import { haptic } from "../../../src/lib/haptics";
import { QueryError, DatePickerField } from "../../../src/components/ui";

interface LineItem {
  itemId?: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxPercent: string;
  discountPercent: string;
}

function newLineItem(): LineItem {
  return {
    description: "",
    quantity: "1",
    unitPrice: "0",
    taxPercent: "0",
    discountPercent: "0",
  };
}

function safeNum(s: string) {
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// ── Party Picker Modal ──────────────────────────────────────────

interface PartyPickerProps {
  visible: boolean;
  type: "sale" | "purchase";
  onSelect: (party: { id: string; name: string }) => void;
  onClose: () => void;
}

function PartyPickerModal({ visible, type, onSelect, onClose }: PartyPickerProps) {
  const [search, setSearch] = useState("");
  const partyType = type === "sale" ? "customer" : "supplier";

  const { data } = trpc.party.list.useQuery(
    { type: partyType, page: 1, limit: 200 },
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
            <Text style={modalStyles.title}>
              Select {type === "sale" ? "Customer" : "Supplier"}
            </Text>
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
                onPress={() => {
                  onSelect(item);
                  onClose();
                }}
                activeOpacity={0.7}
              >
                <View style={modalStyles.listItemIcon}>
                  <Ionicons name="person-outline" size={16} color={colors.brand} />
                </View>
                <View>
                  <Text style={modalStyles.listItemName}>{item.name}</Text>
                  {item.phone && (
                    <Text style={modalStyles.listItemSub}>{item.phone}</Text>
                  )}
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={modalStyles.emptyText}>No parties found</Text>
            }
          />
        </View>
      </View>
    </Modal>
  );
}

// ── Item Picker Modal ──────────────────────────────────────────

interface ItemPickerProps {
  visible: boolean;
  invoiceType: "sale" | "purchase";
  onSelect: (item: {
    id: string;
    name: string;
    salePrice?: string | null;
    purchasePrice?: string | null;
    taxPercent: string;
  }) => void;
  onClose: () => void;
}

function ItemPickerModal({ visible, invoiceType, onSelect, onClose }: ItemPickerProps) {
  const [search, setSearch] = useState("");

  const { data } = trpc.item.list.useQuery(
    { page: 1, limit: 200 },
    { enabled: visible }
  );

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
            renderItem={({ item }) => {
              const price =
                invoiceType === "purchase"
                  ? item.purchasePrice ?? item.salePrice
                  : item.salePrice;
              return (
                <TouchableOpacity
                  style={modalStyles.listItem}
                  onPress={() => {
                    onSelect(item);
                    onClose();
                  }}
                  activeOpacity={0.7}
                >
                  <View style={modalStyles.listItemIcon}>
                    <Ionicons name="cube-outline" size={16} color={colors.brand} />
                  </View>
                  <View style={modalStyles.listItemContent}>
                    <Text style={modalStyles.listItemName}>{item.name}</Text>
                    <Text style={modalStyles.listItemSub}>
                      {price ? formatCurrency(price) : "No price"} · GST {item.taxPercent}%
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <Text style={modalStyles.emptyText}>No items found</Text>
            }
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
  const lineTotal = useMemo(() => {
    const qty = safeNum(item.quantity);
    const price = safeNum(item.unitPrice);
    const tax = safeNum(item.taxPercent);
    const disc = safeNum(item.discountPercent);
    const subtotal = qty * price;
    const afterDiscount = subtotal * (1 - disc / 100);
    const taxAmt = afterDiscount * (tax / 100);
    return afterDiscount + taxAmt;
  }, [item]);

  return (
    <View style={styles.lineItemCard}>
      <View style={styles.lineItemHeader}>
        <TouchableOpacity
          style={styles.descPickerBtn}
          onPress={() => onPickItem(index)}
          activeOpacity={0.7}
        >
          <Text
            style={item.description ? styles.descText : styles.descPlaceholder}
            numberOfLines={1}
          >
            {item.description || "Tap to select item..."}
          </Text>
          <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onRemove(index)} style={styles.removeBtn}>
          <Ionicons name="close-circle" size={20} color={colors.danger} />
        </TouchableOpacity>
      </View>

      {item.description ? (
        <TextInput
          style={styles.descInput}
          value={item.description}
          onChangeText={(v) => onChange(index, "description", v)}
          placeholder="Description"
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={2}
        />
      ) : null}

      <View style={styles.lineItemFields}>
        <View style={styles.lineField}>
          <Text style={styles.fieldLabel}>Qty</Text>
          <TextInput
            style={styles.fieldInput}
            value={item.quantity}
            onChangeText={(v) => onChange(index, "quantity", v)}
            keyboardType="decimal-pad"
            placeholder="1"
            placeholderTextColor={colors.textMuted}
          />
        </View>
        <View style={styles.lineField}>
          <Text style={styles.fieldLabel}>Rate (₹)</Text>
          <TextInput
            style={styles.fieldInput}
            value={item.unitPrice}
            onChangeText={(v) => onChange(index, "unitPrice", v)}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.textMuted}
          />
        </View>
        <View style={styles.lineField}>
          <Text style={styles.fieldLabel}>GST %</Text>
          <TextInput
            style={styles.fieldInput}
            value={item.taxPercent}
            onChangeText={(v) => onChange(index, "taxPercent", v)}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.textMuted}
          />
        </View>
        <View style={styles.lineField}>
          <Text style={styles.fieldLabel}>Disc %</Text>
          <TextInput
            style={styles.fieldInput}
            value={item.discountPercent}
            onChangeText={(v) => onChange(index, "discountPercent", v)}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.textMuted}
          />
        </View>
      </View>

      <View style={styles.lineTotalRow}>
        <Text style={styles.lineTotalLabel}>Amount</Text>
        <Text style={styles.lineTotalValue}>{formatCurrency(lineTotal)}</Text>
      </View>
    </View>
  );
}

// ── Main Edit Screen ──────────────────────────────────────────

export default function InvoiceEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const utils = trpc.useUtils();

  const { data: invoice, isLoading } = trpc.invoice.getById.useQuery(
    { id: id ?? "" },
    { enabled: !!id }
  );

  const [selectedParty, setSelectedParty] = useState<{ id: string; name: string } | null>(null);
  const [invoiceDate, setInvoiceDate] = useState(new Date());
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([newLineItem()]);
  const [showPartyPicker, setShowPartyPicker] = useState(false);
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [activeLineIndex, setActiveLineIndex] = useState(0);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (invoice && !initialized) {
      if (invoice.party) {
        setSelectedParty({ id: invoice.partyId, name: invoice.party.name });
      }
      setInvoiceDate(
        invoice.invoiceDate
          ? new Date(invoice.invoiceDate)
          : new Date()
      );
      setDueDate(
        invoice.dueDate
          ? new Date(invoice.dueDate)
          : null
      );
      setNotes(invoice.notes ?? "");
      if (invoice.lineItems && invoice.lineItems.length > 0) {
        setLineItems(
          invoice.lineItems.map((li) => ({
            itemId: li.itemId ?? undefined,
            description: li.description ?? "",
            quantity: li.quantity ?? "1",
            unitPrice: li.unitPrice ?? "0",
            taxPercent: li.taxPercent ?? "0",
            discountPercent: li.discountPercent ?? "0",
          }))
        );
      }
      setInitialized(true);
    }
  }, [invoice, initialized]);

  const updateMutation = trpc.invoice.update.useMutation({
    onSuccess: (_data) => {
      utils.invoice.list.invalidate();
      utils.invoice.getById.invalidate({ id: id ?? "" });
      router.back();
    },
    onError: (err) => {
      Alert.alert("Error", err.message);
    },
  });

  const totals = useMemo(() => {
    const validItems = lineItems.filter((li) => li.description.trim().length > 0);
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

  const handleLineChange = useCallback(
    (index: number, field: keyof LineItem, value: string) => {
      setLineItems((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], [field]: value };
        return next;
      });
    },
    []
  );

  const handleRemoveLine = useCallback((index: number) => {
    setLineItems((prev) => {
      if (prev.length === 1) return [newLineItem()];
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handlePickItemForLine = useCallback((index: number) => {
    setActiveLineIndex(index);
    setShowItemPicker(true);
  }, []);

  const handleItemSelected = useCallback(
    (item: {
      id: string;
      name: string;
      salePrice?: string | null;
      purchasePrice?: string | null;
      taxPercent: string;
    }) => {
      const invoiceType = invoice?.type ?? "sale";
      const price =
        invoiceType === "purchase"
          ? item.purchasePrice ?? item.salePrice ?? "0"
          : item.salePrice ?? "0";
      setLineItems((prev) => {
        const next = [...prev];
        next[activeLineIndex] = {
          ...next[activeLineIndex],
          itemId: item.id,
          description: item.name,
          unitPrice: price,
          taxPercent: item.taxPercent,
        };
        return next;
      });
    },
    [invoice?.type, activeLineIndex]
  );

  const handleAddLine = useCallback(() => {
    setLineItems((prev) => [newLineItem(), ...prev]); // prepend — new item at top
  }, []);

  const handleUpdate = useCallback(() => {
    if (!selectedParty) {
      Alert.alert("Validation", "Please select a party.");
      return;
    }

    const validItems = lineItems.filter(
      (li) => li.description.trim().length > 0 && parseFloat(li.quantity) > 0
    );

    if (validItems.length === 0) {
      Alert.alert("Validation", "Add at least one item with a description.");
      return;
    }

    haptic.success();
    updateMutation.mutate({
      id: id ?? "",
      partyId: selectedParty.id,
      invoiceDate: invoiceDate.toISOString(),
      dueDate: dueDate ? dueDate.toISOString() : null,
      notes: notes.trim() || null,
      lineItems: validItems.map((li) => ({
        itemId: li.itemId,
        description: li.description.trim(),
        quantity: li.quantity || "1",
        unitPrice: li.unitPrice || "0",
        taxPercent: li.taxPercent || "0",
        discountPercent: li.discountPercent || "0",
      })),
    });
  }, [selectedParty, lineItems, invoiceDate, dueDate, notes, id, updateMutation]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!invoice) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <QueryError message="Invoice not found" onRetry={() => {}} />
      </SafeAreaView>
    );
  }

  const invoiceType = invoice.type as "sale" | "purchase";

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Header */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.topBarCenter}>
          <Text style={styles.topBarTitle}>Edit Invoice</Text>
          <Text style={styles.topBarSub}>{invoice.invoiceNumber}</Text>
        </View>
        <TouchableOpacity
          style={[styles.saveBtn, updateMutation.isPending && styles.saveBtnDisabled]}
          onPress={handleUpdate}
          disabled={updateMutation.isPending}
          activeOpacity={0.8}
        >
          {updateMutation.isPending ? (
            <ActivityIndicator size="small" color={colors.textPrimary} />
          ) : (
            <Text style={styles.saveBtnText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Party */}
          <Text style={styles.sectionLabel}>
            {invoiceType === "sale" ? "Customer" : "Supplier"}
          </Text>
          <TouchableOpacity
            style={[styles.selectorBtn, selectedParty ? styles.selectorBtnFilled : {}]}
            onPress={() => setShowPartyPicker(true)}
            activeOpacity={0.7}
          >
            <Ionicons
              name="person-outline"
              size={18}
              color={selectedParty ? colors.textPrimary : colors.textMuted}
              style={styles.selectorIcon}
            />
            <Text style={selectedParty ? styles.selectorValueText : styles.selectorPlaceholder}>
              {selectedParty ? selectedParty.name : "Select party..."}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>

          {/* Dates */}
          <Text style={styles.sectionLabel}>Dates</Text>
          <View style={styles.datesRow}>
            <View style={styles.dateCard}>
              <DatePickerField
                label="Invoice Date"
                value={invoiceDate}
                onChange={setInvoiceDate}
              />
            </View>
            <View style={styles.dateCard}>
              <DatePickerField
                label="Due Date"
                value={dueDate ?? invoiceDate}
                onChange={setDueDate}
                minimumDate={invoiceDate}
              />
            </View>
          </View>

          {/* Line Items */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16, marginBottom: 12 }}>
            <Text style={styles.sectionLabel}>Items</Text>
            <TouchableOpacity
              style={styles.addLineBtn}
              onPress={handleAddLine}
              activeOpacity={0.7}
            >
              <Ionicons name="add-circle-outline" size={20} color={colors.brand} />
              <Text style={styles.addLineBtnText}>Add</Text>
            </TouchableOpacity>
          </View>
          {lineItems.map((li, index) => (
            <LineItemRow
              key={index}
              item={li}
              index={index}
              onChange={handleLineChange}
              onRemove={handleRemoveLine}
              onPickItem={handlePickItemForLine}
            />
          ))}

          {/* Summary */}
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Subtotal</Text>
              <Text style={styles.summaryValue}>{formatCurrency(totals.subtotal)}</Text>
            </View>
            {parseFloat(totals.taxTotal) > 0 && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Tax</Text>
                <Text style={styles.summaryValue}>{formatCurrency(totals.taxTotal)}</Text>
              </View>
            )}
            <View style={styles.summaryDivider} />
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabelBold}>Total</Text>
              <Text style={styles.summaryValueBold}>{formatCurrency(totals.total)}</Text>
            </View>
          </View>

          {/* Notes */}
          <Text style={styles.sectionLabel}>Notes</Text>
          <TextInput
            style={[styles.input, styles.notesInput]}
            placeholder="Optional notes..."
            placeholderTextColor={colors.textMuted}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      <PartyPickerModal
        visible={showPartyPicker}
        type={invoiceType}
        onSelect={setSelectedParty}
        onClose={() => setShowPartyPicker(false)}
      />

      <ItemPickerModal
        visible={showItemPicker}
        invoiceType={invoiceType}
        onSelect={handleItemSelected}
        onClose={() => setShowItemPicker(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
  topBarCenter: { flex: 1 },
  topBarTitle: { fontSize: 17, fontWeight: "700", color: colors.textPrimary },
  topBarSub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  saveBtn: {
    backgroundColor: colors.brand,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 10,
    minWidth: 68,
    alignItems: "center",
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 4,
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
    marginBottom: 16,
    gap: 10,
  },
  selectorBtnFilled: { borderColor: colors.brand + "60" },
  selectorIcon: {},
  selectorPlaceholder: { flex: 1, fontSize: 15, color: colors.textMuted },
  selectorValueText: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.textPrimary },
  datesRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  dateCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  dateLabel: { fontSize: 11, color: colors.textMuted, fontWeight: "600", marginBottom: 4 },
  dateInput: { fontSize: 14, color: colors.textPrimary, fontWeight: "600", padding: 0 },
  lineItemCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
  },
  lineItemHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  descPickerBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  descText: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  descPlaceholder: { flex: 1, fontSize: 14, color: colors.textMuted },
  removeBtn: { padding: 2 },
  descInput: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 8,
    padding: 0,
    minHeight: 32,
  },
  lineItemFields: {
    flexDirection: "row",
    gap: 6,
  },
  lineField: { flex: 1 },
  fieldLabel: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: "600",
    marginBottom: 4,
    textTransform: "uppercase",
  },
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
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  lineTotalLabel: { fontSize: 12, color: colors.textMuted },
  lineTotalValue: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  addLineBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.brand + "18",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 4,
  },
  addLineBtnText: { fontSize: 13, fontWeight: "700", color: colors.brand },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
    gap: 8,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryLabel: { fontSize: 14, color: colors.textSecondary },
  summaryValue: { fontSize: 14, color: colors.textPrimary, fontWeight: "600" },
  summaryDivider: { height: 1, backgroundColor: colors.border },
  summaryLabelBold: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  summaryValueBold: { fontSize: 18, fontWeight: "800", color: colors.textPrimary },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 15,
    marginBottom: 16,
  },
  notesInput: { minHeight: 80, paddingTop: 12 },
});

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: "75%",
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    margin: 16,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    height: 44,
    gap: 6,
  },
  searchIcon: {},
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 14, height: "100%" },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  listItemIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  listItemContent: { flex: 1 },
  listItemName: { fontSize: 15, fontWeight: "600", color: colors.textPrimary },
  listItemSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  emptyText: { textAlign: "center", color: colors.textMuted, paddingVertical: 40 },
});
