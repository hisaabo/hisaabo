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
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../src/lib/trpc";
import { formatCurrency } from "../../../src/lib/utils";
import { calcInvoiceTotals } from "@hisaabo/shared";

const C = {
  bg: "#0f0f1a",
  surface: "#1a1a2e",
  surfaceAlt: "#16162a",
  border: "#2d2d44",
  brand: "#6366f1",
  textPrimary: "#ffffff",
  textSecondary: "#9ca3af",
  textMuted: "#6b7280",
  success: "#10b981",
  danger: "#ef4444",
  warning: "#f59e0b",
};

type InvoiceType = "sale" | "purchase";

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

// ── Helpers ────────────────────────────────────────────────────

function todayISO() {
  return new Date().toISOString();
}

function in30daysISO() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString();
}

function safeNum(s: string) {
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// ── Party Picker Modal ──────────────────────────────────────────

interface PartyPickerProps {
  visible: boolean;
  type: InvoiceType;
  onSelect: (party: { id: string; name: string; phone?: string | null }) => void;
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
              <Ionicons name="close" size={22} color={C.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={modalStyles.searchWrap}>
            <Ionicons name="search-outline" size={15} color={C.textMuted} style={modalStyles.searchIcon} />
            <TextInput
              style={modalStyles.searchInput}
              placeholder="Search..."
              placeholderTextColor={C.textMuted}
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
                  <Ionicons name="person-outline" size={16} color={C.brand} />
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
  invoiceType: InvoiceType;
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
              <Ionicons name="close" size={22} color={C.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={modalStyles.searchWrap}>
            <Ionicons name="search-outline" size={15} color={C.textMuted} style={modalStyles.searchIcon} />
            <TextInput
              style={modalStyles.searchInput}
              placeholder="Search items..."
              placeholderTextColor={C.textMuted}
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
                    <Ionicons name="cube-outline" size={16} color={C.brand} />
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
  invoiceType: InvoiceType;
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
          <Ionicons name="chevron-down" size={14} color={C.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onRemove(index)} style={styles.removeBtn}>
          <Ionicons name="close-circle" size={20} color={C.danger} />
        </TouchableOpacity>
      </View>

      {item.description ? (
        <TextInput
          style={styles.descInput}
          value={item.description}
          onChangeText={(v) => onChange(index, "description", v)}
          placeholder="Description"
          placeholderTextColor={C.textMuted}
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
            placeholderTextColor={C.textMuted}
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
            placeholderTextColor={C.textMuted}
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
            placeholderTextColor={C.textMuted}
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
            placeholderTextColor={C.textMuted}
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

// ── Main Create Screen ────────────────────────────────────────

export default function InvoiceCreateScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string }>();
  const [invoiceType, setInvoiceType] = useState<InvoiceType>(
    (params.type as InvoiceType) ?? "sale"
  );

  const [selectedParty, setSelectedParty] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [invoiceDate] = useState(todayISO());
  const [dueDate] = useState(in30daysISO());
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([newLineItem()]);
  const [showPartyPicker, setShowPartyPicker] = useState(false);
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [activeLineIndex, setActiveLineIndex] = useState(0);

  const createMutation = trpc.invoice.create.useMutation({
    onSuccess: (data) => {
      router.replace(`/(invoices)/${data.id}` as never);
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
    [invoiceType, activeLineIndex]
  );

  const handleAddLine = useCallback(() => {
    setLineItems((prev) => [...prev, newLineItem()]);
  }, []);

  const handleCreate = useCallback(() => {
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

    for (const li of validItems) {
      if (parseFloat(li.unitPrice) < 0) {
        Alert.alert("Validation", "Item prices cannot be negative.");
        return;
      }
    }

    createMutation.mutate({
      partyId: selectedParty.id,
      type: invoiceType,
      documentType: "invoice",
      invoiceDate,
      dueDate,
      notes: notes.trim() || undefined,
      additionalCharges: "0",
      invoiceDiscount: "0",
      invoiceDiscountType: "amount",
      roundOff: "0",
      lineItems: validItems.map((li) => ({
        itemId: li.itemId,
        description: li.description.trim(),
        quantity: li.quantity || "1",
        unitPrice: li.unitPrice || "0",
        taxPercent: li.taxPercent || "0",
        discountPercent: li.discountPercent || "0",
      })),
    });
  }, [selectedParty, lineItems, invoiceType, invoiceDate, dueDate, notes, createMutation]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Header */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>New Invoice</Text>
        <View style={styles.typeToggle}>
          <TouchableOpacity
            style={[styles.typeBtn, invoiceType === "sale" && styles.typeBtnActive]}
            onPress={() => setInvoiceType("sale")}
          >
            <Text style={[styles.typeBtnText, invoiceType === "sale" && styles.typeBtnTextActive]}>
              Sale
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.typeBtn, invoiceType === "purchase" && styles.typeBtnActive]}
            onPress={() => setInvoiceType("purchase")}
          >
            <Text
              style={[
                styles.typeBtnText,
                invoiceType === "purchase" && styles.typeBtnTextActive,
              ]}
            >
              Purchase
            </Text>
          </TouchableOpacity>
        </View>
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
              color={selectedParty ? C.textPrimary : C.textMuted}
              style={styles.selectorIcon}
            />
            <Text style={selectedParty ? styles.selectorValueText : styles.selectorPlaceholder}>
              {selectedParty ? selectedParty.name : "Select party..."}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
          </TouchableOpacity>

          {/* Dates */}
          <Text style={styles.sectionLabel}>Dates</Text>
          <View style={styles.datesRow}>
            <View style={styles.dateCard}>
              <Text style={styles.dateLabel}>Invoice Date</Text>
              <Text style={styles.dateValue}>
                {new Date(invoiceDate).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </Text>
            </View>
            <View style={styles.dateCard}>
              <Text style={styles.dateLabel}>Due Date</Text>
              <Text style={styles.dateValue}>
                {new Date(dueDate).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </Text>
            </View>
          </View>

          {/* Line Items */}
          <View style={styles.lineItemsHeader}>
            <Text style={styles.sectionLabel}>Items</Text>
            <Text style={styles.lineCount}>
              {lineItems.length} {lineItems.length === 1 ? "item" : "items"}
            </Text>
          </View>

          {lineItems.map((li, idx) => (
            <LineItemRow
              key={idx}
              item={li}
              index={idx}
              invoiceType={invoiceType}
              onChange={handleLineChange}
              onRemove={handleRemoveLine}
              onPickItem={handlePickItemForLine}
            />
          ))}

          <TouchableOpacity style={styles.addItemBtn} onPress={handleAddLine} activeOpacity={0.7}>
            <Ionicons name="add-circle-outline" size={18} color={C.brand} />
            <Text style={styles.addItemBtnText}>Add Item</Text>
          </TouchableOpacity>

          {/* Notes */}
          <Text style={styles.sectionLabel}>Notes (optional)</Text>
          <TextInput
            style={styles.notesInput}
            value={notes}
            onChangeText={setNotes}
            placeholder="Payment terms, delivery notes, etc."
            placeholderTextColor={C.textMuted}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />

          {/* Totals Summary */}
          <Text style={styles.sectionLabel}>Summary</Text>
          <View style={styles.totalsCard}>
            {parseFloat(totals.lineDiscountTotal) > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Discount</Text>
                <Text style={[styles.totalValue, { color: C.success }]}>
                  -{formatCurrency(totals.lineDiscountTotal)}
                </Text>
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

          {/* Bottom spacer for footer */}
          <View style={{ height: 100 }} />
        </ScrollView>

        {/* Sticky Create Button */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.createBtn, createMutation.isPending && styles.createBtnDisabled]}
            onPress={handleCreate}
            activeOpacity={0.85}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={20} color="#ffffff" />
                <Text style={styles.createBtnText}>Create Invoice</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Party Picker Modal */}
      <PartyPickerModal
        visible={showPartyPicker}
        type={invoiceType}
        onSelect={setSelectedParty}
        onClose={() => setShowPartyPicker(false)}
      />

      {/* Item Picker Modal */}
      <ItemPickerModal
        visible={showItemPicker}
        invoiceType={invoiceType}
        onSelect={handleItemSelected}
        onClose={() => setShowItemPicker(false)}
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  flex: {
    flex: 1,
  },
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
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  topBarTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    color: C.textPrimary,
  },
  typeToggle: {
    flexDirection: "row",
    backgroundColor: C.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    padding: 3,
  },
  typeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
  },
  typeBtnActive: {
    backgroundColor: C.brand,
  },
  typeBtnText: {
    fontSize: 11,
    fontWeight: "600",
    color: C.textMuted,
  },
  typeBtnTextActive: {
    color: "#ffffff",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: C.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
  },
  selectorBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  selectorBtnFilled: {
    borderColor: C.brand + "60",
  },
  selectorIcon: {
    marginRight: 10,
  },
  selectorValueText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: C.textPrimary,
  },
  selectorPlaceholder: {
    flex: 1,
    fontSize: 15,
    color: C.textMuted,
  },
  datesRow: {
    flexDirection: "row",
    gap: 10,
  },
  dateCard: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
  },
  dateLabel: {
    fontSize: 11,
    color: C.textMuted,
    fontWeight: "500",
    marginBottom: 4,
  },
  dateValue: {
    fontSize: 14,
    fontWeight: "600",
    color: C.textPrimary,
  },
  lineItemsHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: 16,
    marginBottom: 8,
  },
  lineCount: {
    fontSize: 12,
    color: C.textMuted,
  },
  lineItemCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 10,
  },
  lineItemHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    gap: 8,
  },
  descPickerBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  descText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: C.textPrimary,
  },
  descPlaceholder: {
    flex: 1,
    fontSize: 13,
    color: C.textMuted,
  },
  removeBtn: {
    padding: 4,
  },
  descInput: {
    backgroundColor: C.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: C.textPrimary,
    marginBottom: 10,
  },
  lineItemFields: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  lineField: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: 10,
    color: C.textMuted,
    fontWeight: "500",
    marginBottom: 4,
  },
  fieldInput: {
    backgroundColor: C.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 8,
    paddingVertical: 7,
    fontSize: 13,
    color: C.textPrimary,
    textAlign: "center",
  },
  lineTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  lineTotalLabel: {
    fontSize: 12,
    color: C.textMuted,
    fontWeight: "500",
  },
  lineTotalValue: {
    fontSize: 15,
    fontWeight: "700",
    color: C.textPrimary,
  },
  addItemBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.brand + "40",
    borderStyle: "dashed",
    paddingVertical: 14,
    gap: 8,
    marginBottom: 4,
  },
  addItemBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: C.brand,
  },
  notesInput: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: C.textPrimary,
    minHeight: 80,
  },
  totalsCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 5,
  },
  totalLabel: {
    fontSize: 14,
    color: C.textSecondary,
  },
  totalValue: {
    fontSize: 14,
    color: C.textPrimary,
    fontWeight: "500",
  },
  totalDivider: {
    height: 1,
    backgroundColor: C.border,
    marginVertical: 8,
  },
  totalLabelBold: {
    fontSize: 16,
    fontWeight: "700",
    color: C.textPrimary,
  },
  totalValueBold: {
    fontSize: 18,
    fontWeight: "700",
    color: C.textPrimary,
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.bg,
  },
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.brand,
    borderRadius: 16,
    paddingVertical: 16,
    gap: 10,
    shadowColor: C.brand,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  createBtnDisabled: {
    opacity: 0.7,
  },
  createBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
  },
});

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: C.border,
    maxHeight: "80%",
    paddingBottom: 32,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    color: C.textPrimary,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: C.textPrimary,
    padding: 0,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 12,
  },
  listItemIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.brand + "20",
    alignItems: "center",
    justifyContent: "center",
  },
  listItemContent: {
    flex: 1,
  },
  listItemName: {
    fontSize: 14,
    fontWeight: "600",
    color: C.textPrimary,
  },
  listItemSub: {
    fontSize: 12,
    color: C.textMuted,
    marginTop: 2,
  },
  emptyText: {
    textAlign: "center",
    paddingTop: 40,
    fontSize: 14,
    color: C.textMuted,
  },
});
