import { useState, useCallback } from "react";
import {
  View,
  Text,
  SafeAreaView,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
  FlatList,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";
import { formatCurrency, formatDateShort } from "../../../../src/lib/utils";

type PaymentMode = "cash" | "bank" | "upi" | "cheque" | "other";

const PAYMENT_MODES: { value: PaymentMode; label: string; color: string }[] = [
  { value: "cash", label: "Cash", color: "#22c55e" },
  { value: "upi", label: "UPI", color: "#a855f7" },
  { value: "bank", label: "Bank", color: "#3b82f6" },
  { value: "cheque", label: "Cheque", color: "#f59e0b" },
  { value: "other", label: "Other", color: "#9ca3af" },
];

interface SelectedParty {
  id: string;
  name: string;
}

interface AllocatedInvoice {
  invoiceId: string;
  amount: string;
}

export default function CreatePaymentScreen() {
  const router = useRouter();

  // Form state
  const [selectedParty, setSelectedParty] = useState<SelectedParty | null>(null);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().slice(0, 10)
  );

  // Allocations
  const [allocations, setAllocations] = useState<AllocatedInvoice[]>([]);

  // Party selector modal
  const [partyModalVisible, setPartyModalVisible] = useState(false);
  const [partySearch, setPartySearch] = useState("");

  // Party search query
  const { data: partiesData, isLoading: partiesLoading } = trpc.party.list.useQuery(
    { search: partySearch.length > 0 ? partySearch : undefined, page: 1, limit: 30 },
    { enabled: partyModalVisible }
  );

  // Unpaid invoices for selected party
  const { data: unpaidInvoices, isLoading: invoicesLoading } = trpc.payment.unpaidInvoices.useQuery(
    { partyId: selectedParty?.id ?? "" },
    { enabled: !!selectedParty }
  );

  const createPayment = trpc.payment.create.useMutation({
    onSuccess: () => {
      Alert.alert("Success", "Payment recorded successfully", [
        { text: "OK", onPress: () => router.back() },
      ]);
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to create payment");
    },
  });

  const handlePartySelect = useCallback((party: SelectedParty) => {
    setSelectedParty(party);
    setAllocations([]);
    setPartyModalVisible(false);
    setPartySearch("");
  }, []);

  const toggleAllocation = useCallback(
    (invoiceId: string, balance: string) => {
      setAllocations((prev) => {
        const exists = prev.find((a) => a.invoiceId === invoiceId);
        if (exists) {
          return prev.filter((a) => a.invoiceId !== invoiceId);
        }
        return [...prev, { invoiceId, amount: balance }];
      });
    },
    []
  );

  const updateAllocationAmount = useCallback((invoiceId: string, newAmount: string) => {
    setAllocations((prev) =>
      prev.map((a) => (a.invoiceId === invoiceId ? { ...a, amount: newAmount } : a))
    );
  }, []);

  const handleSubmit = useCallback(() => {
    if (!selectedParty) {
      Alert.alert("Validation", "Please select a party");
      return;
    }
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      Alert.alert("Validation", "Please enter a valid amount");
      return;
    }

    const dateStr = new Date(paymentDate + "T00:00:00.000Z").toISOString();

    createPayment.mutate({
      partyId: selectedParty.id,
      amount: parseFloat(amount).toFixed(2),
      mode,
      referenceNumber: referenceNumber.trim() || undefined,
      notes: notes.trim() || undefined,
      paymentDate: dateStr,
      allocations: allocations.length > 0
        ? allocations.map((a) => ({
            invoiceId: a.invoiceId,
            amount: parseFloat(a.amount || "0").toFixed(2),
          }))
        : undefined,
    });
  }, [selectedParty, amount, mode, referenceNumber, notes, paymentDate, allocations, createPayment]);

  const parties = partiesData?.data ?? [];

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.title}>Record Payment</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Party Selector */}
        <View style={styles.section}>
          <Text style={styles.label}>Party *</Text>
          <TouchableOpacity
            style={styles.selectorBtn}
            onPress={() => setPartyModalVisible(true)}
            activeOpacity={0.7}
          >
            <Text style={selectedParty ? styles.selectorTextSelected : styles.selectorTextPlaceholder}>
              {selectedParty?.name ?? "Select party..."}
            </Text>
            <Ionicons name="chevron-down" size={18} color="#6b7280" />
          </TouchableOpacity>
        </View>

        {/* Amount */}
        <View style={styles.section}>
          <Text style={styles.label}>Amount *</Text>
          <TextInput
            style={styles.input}
            placeholder="0.00"
            placeholderTextColor="#6b7280"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />
        </View>

        {/* Payment Mode */}
        <View style={styles.section}>
          <Text style={styles.label}>Payment Mode *</Text>
          <View style={styles.modeRow}>
            {PAYMENT_MODES.map((m) => (
              <TouchableOpacity
                key={m.value}
                style={[
                  styles.modeChip,
                  mode === m.value && { backgroundColor: m.color + "22", borderColor: m.color },
                ]}
                onPress={() => setMode(m.value)}
                activeOpacity={0.7}
              >
                <Text style={[styles.modeChipText, mode === m.value && { color: m.color }]}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Date */}
        <View style={styles.section}>
          <Text style={styles.label}>Date</Text>
          <TextInput
            style={styles.input}
            value={paymentDate}
            onChangeText={setPaymentDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#6b7280"
          />
        </View>

        {/* Reference Number */}
        <View style={styles.section}>
          <Text style={styles.label}>Reference Number (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="Cheque no., UTR, etc."
            placeholderTextColor="#6b7280"
            value={referenceNumber}
            onChangeText={setReferenceNumber}
          />
        </View>

        {/* Notes */}
        <View style={styles.section}>
          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Additional notes..."
            placeholderTextColor="#6b7280"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        {/* Allocate to Invoices */}
        {selectedParty && (
          <View style={styles.section}>
            <Text style={styles.label}>Allocate to Invoices</Text>
            {invoicesLoading ? (
              <ActivityIndicator color="#6366f1" style={{ marginTop: 8 }} />
            ) : !unpaidInvoices || unpaidInvoices.length === 0 ? (
              <Text style={styles.emptyInvoices}>No unpaid invoices for this party</Text>
            ) : (
              unpaidInvoices.map((inv) => {
                const allocated = allocations.find((a) => a.invoiceId === inv.id);
                const isSelected = !!allocated;
                return (
                  <View key={inv.id} style={styles.invoiceRow}>
                    <TouchableOpacity
                      style={[styles.checkbox, isSelected && styles.checkboxChecked]}
                      onPress={() => toggleAllocation(inv.id, inv.balance)}
                    >
                      {isSelected && <Ionicons name="checkmark" size={14} color="#ffffff" />}
                    </TouchableOpacity>
                    <View style={styles.invoiceInfo}>
                      <Text style={styles.invoiceNumber}>{inv.invoiceNumber}</Text>
                      <Text style={styles.invoiceBalance}>
                        Balance: {formatCurrency(inv.balance)}
                      </Text>
                    </View>
                    {isSelected && (
                      <TextInput
                        style={styles.allocationInput}
                        value={allocated.amount}
                        onChangeText={(v) => updateAllocationAmount(inv.id, v)}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor="#6b7280"
                      />
                    )}
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* Submit Button */}
        <TouchableOpacity
          style={[styles.submitBtn, createPayment.isPending && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={createPayment.isPending}
          activeOpacity={0.85}
        >
          {createPayment.isPending ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Text style={styles.submitBtnText}>Record Payment</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* Party Selector Modal */}
      <Modal visible={partyModalVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Party</Text>
            <TouchableOpacity onPress={() => { setPartyModalVisible(false); setPartySearch(""); }}>
              <Ionicons name="close" size={24} color="#ffffff" />
            </TouchableOpacity>
          </View>
          <View style={styles.searchWrapper}>
            <Ionicons name="search-outline" size={18} color="#6b7280" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search parties..."
              placeholderTextColor="#6b7280"
              value={partySearch}
              onChangeText={setPartySearch}
              autoFocus
            />
          </View>
          {partiesLoading ? (
            <ActivityIndicator color="#6366f1" style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={parties}
              keyExtractor={(p) => p.id}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
              ListEmptyComponent={
                <Text style={[styles.emptyInvoices, { textAlign: "center", marginTop: 40 }]}>
                  No parties found
                </Text>
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.partyItem}
                  onPress={() => handlePartySelect({ id: item.id, name: item.name })}
                  activeOpacity={0.7}
                >
                  <View style={styles.partyAvatar}>
                    <Text style={styles.partyAvatarText}>{item.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.partyName}>{item.name}</Text>
                    {item.phone && <Text style={styles.partyPhone}>{item.phone}</Text>}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#6b7280" />
                </TouchableOpacity>
              )}
            />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f1a" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#2d2d44",
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "700", color: "#ffffff" },
  content: { padding: 16, paddingBottom: 40 },
  section: { marginBottom: 20 },
  label: { fontSize: 12, fontWeight: "600", color: "#9ca3af", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  input: {
    backgroundColor: "#1a1a2e",
    borderWidth: 1,
    borderColor: "#2d2d44",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#ffffff",
    fontSize: 15,
  },
  textArea: { minHeight: 80, paddingTop: 12 },
  selectorBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1a1a2e",
    borderWidth: 1,
    borderColor: "#2d2d44",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  selectorTextSelected: { color: "#ffffff", fontSize: 15, flex: 1 },
  selectorTextPlaceholder: { color: "#6b7280", fontSize: 15, flex: 1 },
  modeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  modeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#2d2d44",
    backgroundColor: "#1a1a2e",
  },
  modeChipText: { fontSize: 13, fontWeight: "600", color: "#9ca3af" },
  emptyInvoices: { color: "#6b7280", fontSize: 13, marginTop: 8 },
  invoiceRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a2e",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2d2d44",
    padding: 12,
    marginTop: 8,
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#2d2d44",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: { backgroundColor: "#6366f1", borderColor: "#6366f1" },
  invoiceInfo: { flex: 1 },
  invoiceNumber: { fontSize: 14, fontWeight: "600", color: "#ffffff" },
  invoiceBalance: { fontSize: 12, color: "#9ca3af", marginTop: 2 },
  allocationInput: {
    width: 90,
    backgroundColor: "#0f0f1a",
    borderWidth: 1,
    borderColor: "#6366f1",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: "#ffffff",
    fontSize: 13,
    textAlign: "right",
  },
  submitBtn: {
    backgroundColor: "#6366f1",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: "#ffffff", fontSize: 16, fontWeight: "700" },

  // Modal
  modal: { flex: 1, backgroundColor: "#0f0f1a" },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#2d2d44",
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#ffffff" },
  searchWrapper: {
    flexDirection: "row",
    alignItems: "center",
    margin: 16,
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2d2d44",
    paddingHorizontal: 12,
    height: 44,
  },
  searchInput: { flex: 1, color: "#ffffff", fontSize: 14, height: "100%" },
  partyItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1e1e32",
    gap: 12,
  },
  partyAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(99,102,241,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  partyAvatarText: { fontSize: 16, fontWeight: "700", color: "#6366f1" },
  partyName: { fontSize: 15, fontWeight: "600", color: "#ffffff" },
  partyPhone: { fontSize: 12, color: "#6b7280", marginTop: 2 },
});
