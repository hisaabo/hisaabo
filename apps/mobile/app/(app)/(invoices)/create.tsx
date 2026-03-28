import { useState, useMemo, useCallback, useRef, useEffect } from "react";
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
  TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../src/lib/trpc";
import { formatCurrency } from "../../../src/lib/utils";
import { calcInvoiceTotals } from "@hisaabo/shared";
import { colors } from "../../../src/lib/theme";
import { haptic } from "../../../src/lib/haptics";

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
  return new Date().toISOString().slice(0, 10);
}

function in30daysISO() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

function safeNum(s: string) {
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/** Simple debounce hook */
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
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
  const debouncedSearch = useDebounce(search, 300);
  const partyType = type === "sale" ? "customer" : "supplier";

  const { data, isLoading } = trpc.party.list.useQuery(
    { type: partyType, search: debouncedSearch || undefined, page: 1, limit: 50 },
    { enabled: visible }
  );

  const parties = data?.data ?? [];

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
              returnKeyType="search"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch("")}>
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {isLoading ? (
            <ActivityIndicator style={{ marginTop: 32 }} color={colors.brand} />
          ) : (
            <FlatList
              data={parties}
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
                <Text style={modalStyles.emptyText}>
                  {debouncedSearch ? "No parties found" : "Start typing to search"}
                </Text>
              }
            />
          )}
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
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading } = trpc.item.list.useQuery(
    { search: debouncedSearch || undefined, page: 1, limit: 50 },
    { enabled: visible }
  );

  const items = data?.data ?? [];

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
              returnKeyType="search"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch("")}>
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {isLoading ? (
            <ActivityIndicator style={{ marginTop: 32 }} color={colors.brand} />
          ) : (
            <FlatList
              data={items}
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
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Line Item Row ──────────────────────────────────────────────
// Stacked 2-row layout per line item:
//   Row 1: Item name (full width)
//   Row 2: [Qty] [Rate] [GST%] [Disc%]  — two per row at 44pt minHeight
//   Row 3: Amount (computed, right-aligned)

interface LineItemRowProps {
  item: LineItem;
  index: number;
  invoiceType: InvoiceType;
  onChange: (index: number, field: keyof LineItem, value: string) => void;
  onRemove: (index: number) => void;
  onPickItem: (index: number) => void;
}

function LineItemRow({ item, index, onChange, onRemove, onPickItem }: LineItemRowProps) {
  const qtyRef = useRef<TextInput>(null);
  const rateRef = useRef<TextInput>(null);
  const gstRef = useRef<TextInput>(null);
  const discRef = useRef<TextInput>(null);

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
      {/* Row 1: Item picker + remove */}
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

      {/* Optional description edit when an item is selected */}
      {item.description ? (
        <TextInput
          style={styles.descInput}
          value={item.description}
          onChangeText={(v) => onChange(index, "description", v)}
          placeholder="Description"
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={2}
          returnKeyType="next"
          onSubmitEditing={() => qtyRef.current?.focus()}
        />
      ) : null}

      {/* Row 2a: Qty + Rate */}
      <View style={styles.lineItemFieldsRow}>
        <View style={styles.lineFieldHalf}>
          <Text style={styles.fieldLabel}>Qty</Text>
          <TextInput
            ref={qtyRef}
            style={styles.fieldInput}
            value={item.quantity}
            onChangeText={(v) => onChange(index, "quantity", v)}
            keyboardType="decimal-pad"
            placeholder="1"
            placeholderTextColor={colors.textMuted}
            returnKeyType="next"
            onSubmitEditing={() => rateRef.current?.focus()}
          />
        </View>
        <View style={styles.lineFieldHalf}>
          <Text style={styles.fieldLabel}>Rate (₹)</Text>
          <TextInput
            ref={rateRef}
            style={styles.fieldInput}
            value={item.unitPrice}
            onChangeText={(v) => onChange(index, "unitPrice", v)}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.textMuted}
            returnKeyType="next"
            onSubmitEditing={() => gstRef.current?.focus()}
          />
        </View>
      </View>

      {/* Row 2b: GST % + Disc % */}
      <View style={[styles.lineItemFieldsRow, { marginBottom: 10 }]}>
        <View style={styles.lineFieldHalf}>
          <Text style={styles.fieldLabel}>GST %</Text>
          <TextInput
            ref={gstRef}
            style={styles.fieldInput}
            value={item.taxPercent}
            onChangeText={(v) => onChange(index, "taxPercent", v)}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.textMuted}
            returnKeyType="next"
            onSubmitEditing={() => discRef.current?.focus()}
          />
        </View>
        <View style={styles.lineFieldHalf}>
          <Text style={styles.fieldLabel}>Disc %</Text>
          <TextInput
            ref={discRef}
            style={styles.fieldInput}
            value={item.discountPercent}
            onChangeText={(v) => onChange(index, "discountPercent", v)}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.textMuted}
            returnKeyType="done"
          />
        </View>
      </View>

      {/* Row 3: computed amount */}
      <View style={styles.lineTotalRow}>
        <Text style={styles.lineTotalLabel}>Amount</Text>
        <Text style={styles.lineTotalValue}>{formatCurrency(lineTotal)}</Text>
      </View>
    </View>
  );
}

// ── Date Input ─────────────────────────────────────────────────
// Simple text input for YYYY-MM-DD dates with basic validation

interface DateInputProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  nextRef?: React.RefObject<TextInput>;
}

function DateInput({ label, value, onChange, nextRef }: DateInputProps) {
  const [raw, setRaw] = useState(value);

  const handleBlur = () => {
    // Accept YYYY-MM-DD; fallback to original if invalid
    const trimmed = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && !isNaN(Date.parse(trimmed))) {
      onChange(trimmed);
    } else {
      setRaw(value);
    }
  };

  useEffect(() => {
    setRaw(value);
  }, [value]);

  return (
    <View style={styles.dateCard}>
      <Text style={styles.dateLabel}>{label}</Text>
      <TextInput
        style={styles.dateInput}
        value={raw}
        onChangeText={setRaw}
        onBlur={handleBlur}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.textMuted}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        returnKeyType={nextRef ? "next" : "done"}
        onSubmitEditing={() => nextRef?.current?.focus()}
      />
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
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState(in30daysISO());
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([newLineItem()]);
  const [showPartyPicker, setShowPartyPicker] = useState(false);
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [activeLineIndex, setActiveLineIndex] = useState(0);

  const dueDateRef = useRef<TextInput>(null);

  const createMutation = trpc.invoice.create.useMutation({
    onSuccess: (data) => {
      router.replace(`/(invoices)/${data.id}` as never);
    },
    onError: (err) => {
      Alert.alert("Error", err.message, [
        {
          text: "Retry",
          onPress: () => {
            if (selectedParty) handleCreate();
          },
        },
        { text: "OK" },
      ]);
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

  const doCreate = useCallback(() => {
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

    haptic.success();
    createMutation.mutate({
      partyId: selectedParty.id,
      type: invoiceType,
      documentType: "invoice",
      invoiceDate: new Date(invoiceDate).toISOString(),
      dueDate: new Date(dueDate).toISOString(),
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

  const handleCreate = useCallback(() => {
    const total = parseFloat(totals.total);
    if (total === 0) {
      Alert.alert(
        "Zero-value Invoice",
        "This invoice has a total of ₹0. Are you sure you want to proceed?",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Create Anyway", onPress: doCreate },
        ]
      );
      return;
    }
    doCreate();
  }, [totals.total, doCreate]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Header */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
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
              color={selectedParty ? colors.textPrimary : colors.textMuted}
              style={styles.selectorIcon}
            />
            <Text style={selectedParty ? styles.selectorValueText : styles.selectorPlaceholder}>
              {selectedParty ? selectedParty.name : "Select party..."}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>

          {/* Dates — editable text inputs */}
          <Text style={styles.sectionLabel}>Dates</Text>
          <View style={styles.datesRow}>
            <DateInput
              label="Invoice Date"
              value={invoiceDate}
              onChange={setInvoiceDate}
              nextRef={dueDateRef}
            />
            <DateInput
              label="Due Date"
              value={dueDate}
              onChange={setDueDate}
            />
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
            <Ionicons name="add-circle-outline" size={18} color={colors.brand} />
            <Text style={styles.addItemBtnText}>Add Item</Text>
          </TouchableOpacity>

          {/* Notes */}
          <Text style={styles.sectionLabel}>Notes (optional)</Text>
          <TextInput
            style={styles.notesInput}
            value={notes}
            onChangeText={setNotes}
            placeholder="Payment terms, delivery notes, etc."
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            returnKeyType="done"
          />

          {/* Totals Summary */}
          <Text style={styles.sectionLabel}>Summary</Text>
          <View style={styles.totalsCard}>
            {parseFloat(totals.lineDiscountTotal) > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Discount</Text>
                <Text style={[styles.totalValue, { color: colors.success }]}>
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
              <ActivityIndicator color={colors.textPrimary} size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={20} color={colors.textPrimary} />
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
    backgroundColor: colors.bg,
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  topBarTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  typeToggle: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
  },
  typeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
  },
  typeBtnActive: {
    backgroundColor: colors.brand,
  },
  typeBtnText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.textMuted,
  },
  typeBtnTextActive: {
    color: colors.textPrimary,
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
    minHeight: 44,
  },
  selectorBtnFilled: {
    borderColor: colors.brand + "60",
  },
  selectorIcon: {
    marginRight: 10,
  },
  selectorValueText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  selectorPlaceholder: {
    flex: 1,
    fontSize: 15,
    color: colors.textMuted,
  },
  datesRow: {
    flexDirection: "row",
    gap: 10,
  },
  dateCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    minHeight: 44,
  },
  dateLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: "500",
    marginBottom: 4,
  },
  dateInput: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
    padding: 0,
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
    color: colors.textMuted,
  },
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
    marginBottom: 10,
    gap: 8,
  },
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
    minHeight: 44,
  },
  descText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  descPlaceholder: {
    flex: 1,
    fontSize: 13,
    color: colors.textMuted,
  },
  removeBtn: {
    padding: 4,
  },
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
  // 2-column row for line item numeric fields
  lineItemFieldsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  lineFieldHalf: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: "600",
    marginBottom: 4,
  },
  fieldInput: {
    backgroundColor: colors.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
    textAlign: "center",
    minHeight: 44,
  },
  lineTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  lineTotalLabel: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: "500",
  },
  lineTotalValue: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.textPrimary,
  },
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
  addItemBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.brand,
  },
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
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 5,
  },
  totalLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  totalValue: {
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: "500",
  },
  totalDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 8,
  },
  totalLabelBold: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  totalValueBold: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
  },
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
  createBtnDisabled: {
    opacity: 0.7,
  },
  createBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
});

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
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
    color: colors.textPrimary,
  },
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
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
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
  listItemContent: {
    flex: 1,
  },
  listItemName: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  listItemSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  emptyText: {
    textAlign: "center",
    paddingTop: 40,
    fontSize: 14,
    color: colors.textMuted,
  },
});
