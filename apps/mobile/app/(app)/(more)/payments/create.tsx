import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";
import { formatCurrency, formatDateShort } from "../../../../src/lib/utils";
import { makeStyles } from "../../../../src/lib/makeStyles";
import { useColors } from "../../../../src/contexts/ThemeContext";
import { haptic } from "../../../../src/lib/haptics";
import { DatePickerField } from "../../../../src/components/ui";
import { calculateGatewayCharge } from "@hisaabo/shared";
import type { GatewayChargeConfig } from "@hisaabo/shared";

// ── Helpers ──────────────────────────────────────────────────────────────────

type PaymentMode = "cash" | "bank" | "upi" | "cheque" | "other" | "credit_card" | "debit_card" | "net_banking" | "wallet";

const GATEWAY_PAYMENT_MODES: { value: PaymentMode; label: string }[] = [
  { value: "credit_card", label: "Credit Card" },
  { value: "debit_card", label: "Debit Card" },
  { value: "upi", label: "UPI" },
  { value: "net_banking", label: "Net Banking" },
  { value: "wallet", label: "Wallet" },
];

function accountTypeIcon(type: string): string {
  switch (type) {
    case "cash":            return "\u{1F4B5}";
    case "current":         return "\u{1F3E6}";
    case "savings":         return "\u{1F3E6}";
    case "upi":             return "\u{1F4F1}";
    case "credit_card":     return "\u{1F4B3}";
    case "payment_gateway": return "\u{1F310}";
    default:                return "\u{1F4B3}";
  }
}

function accountTypeLabel(type: string): string {
  switch (type) {
    case "savings":         return "Savings";
    case "current":         return "Current";
    case "cash":            return "Cash";
    case "upi":             return "UPI";
    case "credit_card":     return "Credit Card";
    case "payment_gateway": return "Gateway";
    default:                return type;
  }
}

function accountTypeToMode(type: string): PaymentMode {
  if (type === "cash") return "cash";
  if (type === "upi") return "upi";
  if (type === "payment_gateway") return "credit_card";
  return "bank";
}

interface SelectedParty {
  id: string;
  name: string;
}

// ── Chronological allocation ─────────────────────────────────────────────────

type AllocationStatus = "full" | "partial" | "none";

interface Allocation {
  invoiceId: string;
  amount: string;
  status: AllocationStatus;
}

function allocateChronologically(
  checkedInvoiceIds: string[],
  invoices: Array<{ id: string; balance: string }>,
  totalAmount: number
): Allocation[] {
  const result: Allocation[] = [];
  let remaining = totalAmount;

  // Process in list order (oldest first -- the API returns them sorted)
  for (const inv of invoices) {
    if (!checkedInvoiceIds.includes(inv.id)) continue;

    const balance = parseFloat(inv.balance);
    if (remaining >= balance) {
      result.push({ invoiceId: inv.id, amount: balance.toFixed(2), status: "full" });
      remaining -= balance;
    } else if (remaining > 0) {
      result.push({ invoiceId: inv.id, amount: remaining.toFixed(2), status: "partial" });
      remaining = 0;
    } else {
      result.push({ invoiceId: inv.id, amount: "0", status: "none" });
    }
  }

  return result;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CreatePaymentScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const utils = trpc.useUtils();

  // Form state
  const [selectedParty, setSelectedParty] = useState<SelectedParty | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date());

  // Simplified allocation state
  const [checkedInvoices, setCheckedInvoices] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState("");
  const amountManuallyEdited = useRef(false);

  // Gateway payment mode (only used when selected account is a gateway)
  const [gatewayMode, setGatewayMode] = useState<PaymentMode>("credit_card");

  // Party selector modal
  const [partyModalVisible, setPartyModalVisible] = useState(false);
  const [partySearch, setPartySearch] = useState("");

  // ── Data fetching ────────────────────────────────────────────────────────

  const { data: partiesData, isLoading: partiesLoading } = trpc.party.list.useQuery(
    { search: partySearch.length > 0 ? partySearch : undefined, page: 1, limit: 30 },
    { enabled: partyModalVisible }
  );

  const { data: bankAccountsData, isLoading: accountsLoading } = trpc.bankAccount.list.useQuery(
    undefined
  );

  const { data: defaultAccountData } = trpc.payment.defaultAccount.useQuery(undefined);

  const { data: unpaidInvoices, isLoading: invoicesLoading } = trpc.payment.unpaidInvoices.useQuery(
    { partyId: selectedParty?.id ?? "" },
    { enabled: !!selectedParty }
  );

  // ── Auto-select default account ──────────────────────────────────────────

  useEffect(() => {
    if (selectedAccountId) return;
    if (defaultAccountData) {
      setSelectedAccountId(defaultAccountData.id);
    } else if (bankAccountsData && bankAccountsData.length > 0) {
      setSelectedAccountId(bankAccountsData[0].id);
    }
  }, [defaultAccountData, bankAccountsData, selectedAccountId]);

  // ── Auto-fill amount when invoices are checked ─────────────────────────

  useEffect(() => {
    if (amountManuallyEdited.current) return;
    const total = unpaidInvoices
      ?.filter((inv) => checkedInvoices.has(inv.id))
      .reduce((sum, inv) => sum + parseFloat(inv.balance), 0) ?? 0;
    setAmount(total > 0 ? total.toFixed(2) : "");
  }, [checkedInvoices, unpaidInvoices]);

  // ── Compute allocations from amount (for display AND submit) ──────────

  const computedAllocations = useMemo(() => {
    if (!unpaidInvoices) return [];
    return allocateChronologically(
      [...checkedInvoices],
      unpaidInvoices.map((inv) => ({ id: inv.id, balance: inv.balance })),
      parseFloat(amount) || 0
    );
  }, [checkedInvoices, unpaidInvoices, amount]);

  // Build a lookup map for quick access in render
  const allocationMap = useMemo(() => {
    const map = new Map<string, Allocation>();
    for (const a of computedAllocations) {
      map.set(a.invoiceId, a);
    }
    return map;
  }, [computedAllocations]);

  // ── Resolve selected account ─────────────────────────────────────────────

  const selectedAccount = bankAccountsData?.find((a) => a.id === selectedAccountId) ?? null;
  const isGatewayAccount = selectedAccount?.accountType === "payment_gateway";

  // ── Gateway config + charge preview ─────────────────────────────────────

  const { data: gatewayConfig } = trpc.bankAccount.getGatewayConfig.useQuery(
    { bankAccountId: selectedAccountId! },
    { enabled: isGatewayAccount && !!selectedAccountId }
  );

  const gatewayCharge = useMemo(() => {
    if (!isGatewayAccount || !gatewayConfig?.chargeConfig || !amount) return null;
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return null;
    return calculateGatewayCharge(
      parsed.toFixed(2),
      gatewayConfig.chargeConfig as GatewayChargeConfig,
      gatewayMode,
    );
  }, [isGatewayAccount, gatewayConfig, amount, gatewayMode]);

  // ── Mutation ─────────────────────────────────────────────────────────────

  const createPayment = trpc.payment.create.useMutation({
    onSuccess: () => {
      utils.payment.list.invalidate();
      utils.payment.unpaidInvoices.invalidate();
      utils.payment.defaultAccount.invalidate();
      utils.invoice.list.invalidate();
      utils.dashboard.summary.invalidate();
      utils.bankAccount.list.invalidate();
      utils.party.list.invalidate();
      Alert.alert("Success", "Payment recorded successfully", [
        { text: "OK", onPress: () => router.back() },
      ]);
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to create payment");
    },
  });

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handlePartySelect = useCallback((party: SelectedParty) => {
    setSelectedParty(party);
    setCheckedInvoices(new Set());
    setAmount("");
    amountManuallyEdited.current = false;
    setPartyModalVisible(false);
    setPartySearch("");
  }, []);

  const toggleInvoice = useCallback((invoiceId: string) => {
    amountManuallyEdited.current = false;
    setCheckedInvoices((prev) => {
      const next = new Set(prev);
      if (next.has(invoiceId)) {
        next.delete(invoiceId);
      } else {
        next.add(invoiceId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (!unpaidInvoices) return;
    amountManuallyEdited.current = false;
    setCheckedInvoices(new Set(unpaidInvoices.map((inv) => inv.id)));
  }, [unpaidInvoices]);

  const handleClearAll = useCallback(() => {
    amountManuallyEdited.current = false;
    setCheckedInvoices(new Set());
  }, []);

  const handleAmountChange = useCallback((value: string) => {
    amountManuallyEdited.current = true;
    setAmount(value);
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

    const mode: PaymentMode = isGatewayAccount
      ? gatewayMode
      : selectedAccount
        ? accountTypeToMode(selectedAccount.accountType)
        : "cash";

    const activeAllocations = computedAllocations
      .filter((a) => parseFloat(a.amount) > 0)
      .map((a) => ({ invoiceId: a.invoiceId, amount: a.amount }));

    haptic.success();
    createPayment.mutate({
      partyId: selectedParty.id,
      amount: parseFloat(amount).toFixed(2),
      discount: "0",
      mode,
      bankAccountId: selectedAccountId ?? undefined,
      referenceNumber: referenceNumber.trim() || undefined,
      notes: notes.trim() || undefined,
      paymentDate: paymentDate.toISOString(),
      allocations: activeAllocations.length > 0 ? activeAllocations : undefined,
    });
  }, [selectedParty, amount, selectedAccount, selectedAccountId, isGatewayAccount, gatewayMode, computedAllocations, referenceNumber, notes, paymentDate, createPayment]);

  const parties = partiesData?.data ?? [];
  const bankAccounts = bankAccountsData ?? [];

  const canSubmit =
    !!selectedParty &&
    !!amount &&
    parseFloat(amount) > 0 &&
    !createPayment.isPending;

  const allChecked =
    unpaidInvoices &&
    unpaidInvoices.length > 0 &&
    checkedInvoices.size === unpaidInvoices.length;

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
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
            <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Payment Account (bank account pills) */}
        <View style={styles.section}>
          <Text style={styles.label}>Payment Account</Text>
          {accountsLoading ? (
            <ActivityIndicator color={colors.brand} style={{ marginTop: 8 }} />
          ) : bankAccounts.length === 0 ? (
            <Text style={styles.emptyText}>No accounts set up yet</Text>
          ) : (
            <View style={styles.accountRow}>
              {bankAccounts.map((account) => {
                const isSelected = selectedAccountId === account.id;
                return (
                  <TouchableOpacity
                    key={account.id}
                    style={[
                      styles.accountChip,
                      isSelected && styles.accountChipSelected,
                    ]}
                    onPress={() => setSelectedAccountId(account.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.accountIcon}>
                      {accountTypeIcon(account.accountType)}
                    </Text>
                    <View style={styles.accountChipInfo}>
                      <Text
                        style={[
                          styles.accountName,
                          isSelected && styles.accountNameSelected,
                        ]}
                        numberOfLines={1}
                      >
                        {account.accountName}
                      </Text>
                      <Text style={styles.accountType}>
                        {accountTypeLabel(account.accountType)}
                      </Text>
                    </View>
                    {account.isDefault && (
                      <View style={styles.defaultBadge}>
                        <Text style={styles.defaultBadgeText}>Default</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* Gateway Payment Mode Selector */}
        {isGatewayAccount && (
          <View style={styles.section}>
            <Text style={styles.label}>Payment Mode</Text>
            <View style={styles.gatewayModeRow}>
              {GATEWAY_PAYMENT_MODES.map((m) => {
                const isActive = gatewayMode === m.value;
                return (
                  <TouchableOpacity
                    key={m.value}
                    style={[styles.gatewayModeChip, isActive && styles.gatewayModeChipActive]}
                    onPress={() => setGatewayMode(m.value)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.gatewayModeText, isActive && styles.gatewayModeTextActive]}>
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Charge Preview */}
            {gatewayCharge && parseFloat(gatewayCharge.chargeAmount) > 0 && (
              <View style={styles.chargePreview}>
                <View style={styles.chargeRow}>
                  <Text style={styles.chargeLabel}>Gateway charge</Text>
                  <Text style={styles.chargeValue}>
                    {formatCurrency(gatewayCharge.chargeAmount)}
                  </Text>
                </View>
                <View style={styles.chargeRow}>
                  <Text style={styles.chargeLabel}>Net settlement</Text>
                  <Text style={styles.chargeNet}>
                    {formatCurrency(gatewayCharge.netSettlement)}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Unpaid Invoices with chronological allocation */}
        {selectedParty && (
          <View style={styles.section}>
            <View style={styles.invoiceListHeader}>
              <Text style={styles.label}>
                Unpaid Invoices{unpaidInvoices && unpaidInvoices.length > 0 ? ` (${unpaidInvoices.length})` : ""}
              </Text>
              {unpaidInvoices && unpaidInvoices.length > 0 && (
                <TouchableOpacity
                  onPress={allChecked ? handleClearAll : handleSelectAll}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.selectAllText}>
                    {allChecked ? "Clear All" : "Select All"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            {invoicesLoading ? (
              <ActivityIndicator color={colors.brand} style={{ marginTop: 8 }} />
            ) : !unpaidInvoices || unpaidInvoices.length === 0 ? (
              <Text style={styles.emptyText}>No unpaid invoices for this party</Text>
            ) : (
              <>
                {unpaidInvoices.map((inv) => {
                  const isChecked = checkedInvoices.has(inv.id);
                  const allocation = allocationMap.get(inv.id);
                  const allocAmt = allocation ? parseFloat(allocation.amount) : 0;
                  const status: AllocationStatus = allocation?.status ?? "none";
                  const balance = parseFloat(inv.balance);

                  // Progress bar calculation
                  const existingPaid = parseFloat(inv.amountPaid);
                  const totalAmt = parseFloat(inv.totalAmount);
                  const projectedPaid = isChecked ? existingPaid + allocAmt : existingPaid;
                  const progressPct = Math.min((projectedPaid / totalAmt) * 100, 100);

                  return (
                    <TouchableOpacity
                      key={inv.id}
                      style={[
                        styles.invoiceRow,
                        isChecked && styles.invoiceRowChecked,
                      ]}
                      onPress={() => toggleInvoice(inv.id)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.invoiceTop}>
                        {/* Checkbox */}
                        <View
                          style={[
                            styles.checkbox,
                            isChecked && (status === "full"
                              ? styles.checkboxFull
                              : status === "partial"
                                ? styles.checkboxPartial
                                : styles.checkboxNone),
                          ]}
                        >
                          {isChecked && status === "full" && (
                            <Ionicons name="checkmark" size={14} color="#ffffff" />
                          )}
                          {isChecked && status === "partial" && (
                            <Ionicons name="remove" size={14} color={colors.warning} />
                          )}
                          {isChecked && status === "none" && (
                            <Ionicons name="close" size={12} color={colors.textMuted} />
                          )}
                        </View>

                        {/* Invoice info */}
                        <View style={styles.invoiceInfo}>
                          <View style={styles.invoiceHeader}>
                            <Text style={styles.invoiceNumber}>{inv.invoiceNumber}</Text>
                            <Text style={styles.invoiceBalance}>
                              {formatCurrency(inv.balance)}
                            </Text>
                          </View>
                          <View style={styles.invoiceSubRow}>
                            <Text style={styles.invoiceDate} numberOfLines={1}>
                              {formatDateShort(inv.invoiceDate)}
                            </Text>
                            {/* Allocation status indicator */}
                            {isChecked && status === "full" && (
                              <View style={styles.statusRow}>
                                <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                                <Text style={styles.statusTextFull}>Fully paid</Text>
                              </View>
                            )}
                            {isChecked && status === "partial" && (
                              <View style={styles.statusRow}>
                                <Ionicons name="ellipse-outline" size={14} color={colors.warning} />
                                <Text style={styles.statusTextPartial}>
                                  {formatCurrency(allocAmt)} of {formatCurrency(balance)}
                                </Text>
                              </View>
                            )}
                            {isChecked && status === "none" && (
                              <View style={styles.statusRow}>
                                <Ionicons name="ellipse-outline" size={14} color={colors.textMuted} />
                                <Text style={styles.statusTextNone}>Not covered</Text>
                              </View>
                            )}
                          </View>
                        </View>
                      </View>

                      {/* Progress bar */}
                      <View style={styles.progressTrack}>
                        <View
                          style={[
                            styles.progressBar,
                            {
                              width: `${progressPct}%`,
                              backgroundColor:
                                status === "full" || projectedPaid >= totalAmt
                                  ? colors.success
                                  : projectedPaid > existingPaid
                                    ? colors.warning
                                    : existingPaid > 0
                                      ? colors.textMuted
                                      : "transparent",
                            } as any,
                          ]}
                        />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </>
            )}
          </View>
        )}

        {/* Amount */}
        <View style={styles.section}>
          <Text style={styles.label}>Amount *</Text>
          <TextInput
            style={styles.input}
            placeholder="0.00"
            placeholderTextColor={colors.textMuted}
            value={amount}
            onChangeText={handleAmountChange}
            keyboardType="decimal-pad"
            returnKeyType="done"
          />
          {checkedInvoices.size > 0 && !amountManuallyEdited.current && (
            <Text style={styles.autoCalcHint}>Auto-calculated from selected invoices</Text>
          )}
        </View>

        {/* Date */}
        <View style={styles.section}>
          <DatePickerField
            label="Date"
            value={paymentDate}
            onChange={setPaymentDate}
          />
        </View>

        {/* Reference Number */}
        <View style={styles.section}>
          <Text style={styles.label}>Reference Number (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="Transaction ID, cheque no., UTR..."
            placeholderTextColor={colors.textMuted}
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
            placeholderTextColor={colors.textMuted}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit}
          activeOpacity={0.85}
        >
          {createPayment.isPending ? (
            <ActivityIndicator color={colors.textPrimary} size="small" />
          ) : (
            <Text style={styles.submitBtnText}>
              {amount && parseFloat(amount) > 0
                ? `Record ${formatCurrency(amount)}`
                : "Record Payment"}
            </Text>
          )}
        </TouchableOpacity>

        {/* Selection summary */}
        {checkedInvoices.size > 0 && (
          <Text style={styles.selectionSummary}>
            {checkedInvoices.size} invoice{checkedInvoices.size > 1 ? "s" : ""} selected
          </Text>
        )}
      </ScrollView>

      {/* Party Selector Modal */}
      <Modal visible={partyModalVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Party</Text>
            <TouchableOpacity onPress={() => { setPartyModalVisible(false); setPartySearch(""); }}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <View style={styles.searchWrapper}>
            <Ionicons name="search-outline" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search parties..."
              placeholderTextColor={colors.textMuted}
              value={partySearch}
              onChangeText={setPartySearch}
              autoFocus
            />
          </View>
          {partiesLoading ? (
            <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={parties}
              keyExtractor={(p) => p.id}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
              ListEmptyComponent={
                <Text style={[styles.emptyText, { textAlign: "center", marginTop: 40 }]}>
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
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles((colors) => ({
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
  selectorBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  selectorTextSelected: { color: colors.textPrimary, fontSize: 15, flex: 1 },
  selectorTextPlaceholder: { color: colors.textMuted, fontSize: 15, flex: 1 },
  emptyText: { color: colors.textMuted, fontSize: 13, marginTop: 8 },
  autoCalcHint: { color: colors.textMuted, fontSize: 11, marginTop: 6 },
  selectionSummary: {
    color: colors.textSecondary,
    fontSize: 12,
    textAlign: "center",
    marginTop: 8,
  },

  // ── Invoice list header ─────────────────────────────────────────────────

  invoiceListHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 0,
  },
  selectAllText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.brand,
    marginBottom: 8,
  },

  // ── Account pills ────────────────────────────────────────────────────────

  accountRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  accountChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 8,
    minWidth: 120,
  },
  accountChipSelected: {
    borderColor: colors.brand,
    backgroundColor: "rgba(99, 102, 241, 0.08)",
  },
  accountIcon: { fontSize: 18 },
  accountChipInfo: { flexShrink: 1 },
  accountName: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  accountNameSelected: {
    color: colors.brand,
  },
  accountType: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 1,
  },
  defaultBadge: {
    backgroundColor: colors.brandLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: "auto",
  },
  defaultBadgeText: {
    fontSize: 9,
    fontWeight: "600",
    color: colors.brand,
  },

  // ── Gateway payment mode ────────────────────────────────────────────────

  gatewayModeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gatewayModeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  gatewayModeChipActive: {
    borderColor: "#ec4899",
    backgroundColor: "rgba(236,72,153,0.12)",
  },
  gatewayModeText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  gatewayModeTextActive: {
    color: "#ec4899",
  },
  chargePreview: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginTop: 10,
    gap: 6,
  },
  chargeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  chargeLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  chargeValue: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.warning,
  },
  chargeNet: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.success,
  },

  // ── Invoice rows ─────────────────────────────────────────────────────────

  invoiceRow: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginTop: 8,
  },
  invoiceRowChecked: {
    borderColor: colors.brand,
    backgroundColor: "rgba(99, 102, 241, 0.06)",
  },
  invoiceTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkboxFull: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  checkboxPartial: {
    backgroundColor: colors.warningBg,
    borderColor: colors.warning,
  },
  checkboxNone: {
    backgroundColor: "rgba(107, 114, 128, 0.15)",
    borderColor: colors.textMuted,
  },
  invoiceInfo: { flex: 1 },
  invoiceHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  invoiceNumber: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textPrimary,
    fontFamily: "monospace",
  },
  invoiceDate: {
    fontSize: 11,
    color: colors.textMuted,
  },
  invoiceBalance: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  invoiceSubRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },

  // ── Allocation status indicators ──────────────────────────────────────────

  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statusTextFull: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.success,
  },
  statusTextPartial: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.warning,
  },
  statusTextNone: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.textMuted,
  },

  // ── Progress bar ─────────────────────────────────────────────────────────

  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceHover,
    marginTop: 8,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    borderRadius: 2,
  },

  // ── Submit ───────────────────────────────────────────────────────────────

  submitBtn: {
    backgroundColor: colors.brand,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: colors.textPrimary, fontSize: 16, fontWeight: "700" },

  // ── Modal ────────────────────────────────────────────────────────────────

  modal: { flex: 1, backgroundColor: colors.bg },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  searchWrapper: {
    flexDirection: "row",
    alignItems: "center",
    margin: 16,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    height: 44,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 14, height: "100%" as any },
  partyItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
    gap: 12,
  },
  partyAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  partyAvatarText: { fontSize: 16, fontWeight: "700", color: colors.brand },
  partyName: { fontSize: 15, fontWeight: "600", color: colors.textPrimary },
  partyPhone: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
}));
