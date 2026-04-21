import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";
import { makeStyles } from "../../../../src/lib/makeStyles";
import { useColors } from "../../../../src/contexts/ThemeContext";
import { haptic } from "../../../../src/lib/haptics";

type AccountType = "savings" | "current" | "cash" | "upi" | "credit_card" | "payment_gateway";

const ACCOUNT_TYPES: { value: AccountType; label: string; icon: string }[] = [
  { value: "savings", label: "Savings", icon: "card-outline" },
  { value: "current", label: "Current", icon: "business-outline" },
  { value: "cash", label: "Cash", icon: "cash-outline" },
  { value: "upi", label: "UPI", icon: "phone-portrait-outline" },
  { value: "credit_card", label: "Credit Card", icon: "wallet-outline" },
  { value: "payment_gateway", label: "Gateway", icon: "globe-outline" },
];

const GATEWAY_MODES = [
  { key: "credit_card", label: "Credit Card" },
  { key: "debit_card", label: "Debit Card" },
  { key: "upi", label: "UPI" },
  { key: "net_banking", label: "Net Banking" },
  { key: "wallet", label: "Wallet" },
] as const;

type GatewayModeKey = (typeof GATEWAY_MODES)[number]["key"];

export default function BankAccountCreateScreen() {
  const s = useS();
  const colors = useColors();
  const router = useRouter();
  const utils = trpc.useUtils();

  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("savings");
  const [openingBalance, setOpeningBalance] = useState("0");
  const [isDefault, setIsDefault] = useState(false);

  // Gateway-specific state
  const [settlementAccountId, setSettlementAccountId] = useState<string | null>(null);
  const [expenseCategory, setExpenseCategory] = useState("Payment Gateway Charges");
  const [chargeRates, setChargeRates] = useState<Record<GatewayModeKey, string>>({
    credit_card: "",
    debit_card: "",
    upi: "",
    net_banking: "",
    wallet: "",
  });

  const isGateway = accountType === "payment_gateway";

  // Fetch bank accounts for settlement picker (only non-gateway accounts)
  const { data: bankAccountsData } = trpc.bankAccount.list.useQuery(undefined, {
    enabled: isGateway,
  });
  const settlementAccounts = (bankAccountsData ?? []).filter(
    (a) => a.accountType !== "payment_gateway"
  );

  const createMutation = trpc.bankAccount.create.useMutation({
    onSuccess: (data) => {
      if (isGateway && data?.id) {
        // Build chargeConfig from non-empty rates
        const chargeConfig: Record<string, { type: "percentage"; value: string }> = {};
        for (const mode of GATEWAY_MODES) {
          const val = chargeRates[mode.key].trim();
          if (val && parseFloat(val) > 0) {
            chargeConfig[mode.key] = { type: "percentage", value: parseFloat(val).toFixed(2) };
          }
        }

        upsertGatewayConfig.mutate({
          bankAccountId: data.id,
          settlementAccountId: settlementAccountId!,
          chargeConfig,
          expenseCategory: expenseCategory.trim() || "Payment Gateway Charges",
          autoSettle: true,
        });
      } else {
        haptic.success();
        utils.bankAccount.list.invalidate();
        utils.bankAccount.summary.invalidate();
        router.back();
      }
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const upsertGatewayConfig = trpc.bankAccount.upsertGatewayConfig.useMutation({
    onSuccess: () => {
      haptic.success();
      utils.bankAccount.list.invalidate();
      utils.bankAccount.summary.invalidate();
      router.back();
    },
    onError: (err) => Alert.alert("Error", `Account created but gateway config failed: ${err.message}`),
  });

  const isPending = createMutation.isPending || upsertGatewayConfig.isPending;

  const handleCreate = () => {
    if (!accountName.trim()) {
      Alert.alert("Validation", "Account name is required.");
      return;
    }

    if (isGateway) {
      if (!settlementAccountId) {
        Alert.alert("Validation", "Please select a settlement bank account.");
        return;
      }
      // At least one charge rate should be set
      const hasRate = GATEWAY_MODES.some((m) => {
        const val = chargeRates[m.key].trim();
        return val && parseFloat(val) > 0;
      });
      if (!hasRate) {
        Alert.alert("Validation", "Please set at least one charge rate.");
        return;
      }
    }

    const bal = parseFloat(openingBalance);
    if (isNaN(bal)) {
      Alert.alert("Validation", "Enter a valid opening balance.");
      return;
    }

    createMutation.mutate({
      accountName: accountName.trim(),
      accountNumber: isGateway ? undefined : accountNumber.trim() || undefined,
      ifsc: isGateway ? undefined : ifsc.trim().toUpperCase() || undefined,
      bankName: isGateway ? bankName.trim() || undefined : bankName.trim() || undefined,
      accountType,
      openingBalance: Math.abs(bal).toFixed(2),
      isDefault,
    });
  };

  const updateChargeRate = (key: GatewayModeKey, value: string) => {
    setChargeRates((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <View style={s.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={s.topBarTitle}>New Bank Account</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Account Type */}
          <Text style={s.sectionLabel}>Account Type</Text>
          <View style={s.typeGrid}>
            {ACCOUNT_TYPES.map((t) => (
              <TouchableOpacity
                key={t.value}
                style={[s.typeOption, accountType === t.value && s.typeOptionActive]}
                onPress={() => setAccountType(t.value)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={t.icon as any}
                  size={20}
                  color={accountType === t.value ? colors.textPrimary : colors.textMuted}
                />
                <Text style={[s.typeOptionText, accountType === t.value && s.typeOptionTextActive]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Account Name */}
          <Text style={s.sectionLabel}>
            {isGateway ? "Gateway Name *" : "Account Name *"}
          </Text>
          <TextInput
            style={s.input}
            value={accountName}
            onChangeText={setAccountName}
            placeholder={isGateway ? "e.g. Razorpay, PhonePe Business" : "e.g. HDFC Savings, Petty Cash"}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="words"
          />

          {/* Bank Name (shown for all types) */}
          <Text style={s.sectionLabel}>
            {isGateway ? "Provider Name" : "Bank Name"}
          </Text>
          <TextInput
            style={s.input}
            value={bankName}
            onChangeText={setBankName}
            placeholder={isGateway ? "e.g. Razorpay, Stripe, PayU" : "e.g. HDFC Bank, SBI"}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="words"
          />

          {/* Account Number & IFSC -- hidden for gateway */}
          {!isGateway && (
            <>
              <Text style={s.sectionLabel}>Account Number</Text>
              <TextInput
                style={s.input}
                value={accountNumber}
                onChangeText={setAccountNumber}
                placeholder="e.g. 1234567890"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
              />

              <Text style={s.sectionLabel}>IFSC Code</Text>
              <TextInput
                style={s.input}
                value={ifsc}
                onChangeText={setIfsc}
                placeholder="e.g. HDFC0001234"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="characters"
              />
            </>
          )}

          {/* ── Gateway-specific fields ─────────────────────────────── */}
          {isGateway && (
            <>
              {/* Settlement Account Picker */}
              <Text style={s.sectionLabel}>Settlement Bank Account *</Text>
              {settlementAccounts.length === 0 ? (
                <Text style={s.gatewayHint}>
                  No bank accounts available. Create a bank account first to use as settlement.
                </Text>
              ) : (
                <View style={s.typeGrid}>
                  {settlementAccounts.map((acc) => {
                    const selected = settlementAccountId === acc.id;
                    return (
                      <TouchableOpacity
                        key={acc.id}
                        style={[s.settlementChip, selected && s.settlementChipActive]}
                        onPress={() => setSettlementAccountId(acc.id)}
                        activeOpacity={0.7}
                      >
                        <Text style={[s.settlementChipText, selected && s.settlementChipTextActive]} numberOfLines={1}>
                          {acc.accountName}
                        </Text>
                        {acc.bankName ? (
                          <Text style={s.settlementChipSub} numberOfLines={1}>{acc.bankName}</Text>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* Charge Rates per Mode */}
              <Text style={s.sectionLabel}>Charge Rates (%)</Text>
              <Text style={s.gatewayHint}>
                Enter the gateway charge percentage for each payment mode
              </Text>
              {GATEWAY_MODES.map((mode) => (
                <View key={mode.key} style={s.chargeRateRow}>
                  <Text style={s.chargeRateLabel}>{mode.label}</Text>
                  <View style={s.chargeRateInputWrapper}>
                    <TextInput
                      style={s.chargeRateInput}
                      value={chargeRates[mode.key]}
                      onChangeText={(v) => updateChargeRate(mode.key, v)}
                      placeholder="0.00"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="decimal-pad"
                      returnKeyType="done"
                    />
                    <Text style={s.chargeRatePercent}>%</Text>
                  </View>
                </View>
              ))}

              {/* Expense Category */}
              <Text style={s.sectionLabel}>Expense Category</Text>
              <TextInput
                style={s.input}
                value={expenseCategory}
                onChangeText={setExpenseCategory}
                placeholder="Payment Gateway Charges"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="words"
              />
            </>
          )}

          {/* Opening Balance */}
          <Text style={s.sectionLabel}>Opening Balance (₹)</Text>
          <TextInput
            style={s.input}
            value={openingBalance}
            onChangeText={setOpeningBalance}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={colors.textMuted}
            returnKeyType="done"
          />

          {/* Is Default */}
          <View style={s.switchRow}>
            <View style={s.switchLabel}>
              <Text style={s.switchTitle}>Set as Default</Text>
              <Text style={s.switchSubtitle}>Use this account by default in transactions</Text>
            </View>
            <Switch
              value={isDefault}
              onValueChange={setIsDefault}
              trackColor={{ false: colors.border, true: colors.brand }}
              thumbColor={colors.textPrimary}
            />
          </View>

          <View style={{ height: 100 }} />
        </ScrollView>

        <View style={s.footer}>
          <TouchableOpacity
            style={[s.createBtn, isPending && s.createBtnDisabled]}
            onPress={handleCreate}
            activeOpacity={0.85}
            disabled={isPending}
          >
            {isPending ? (
              <ActivityIndicator color={colors.textPrimary} size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={20} color={colors.textPrimary} />
                <Text style={s.createBtnText}>Create Account</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useS = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  topBarTitle: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.textPrimary },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16 },
  sectionLabel: { fontSize: 11, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 16, marginBottom: 8 },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  typeOptionActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  typeOptionText: { fontSize: 12, fontWeight: "600", color: colors.textMuted },
  typeOptionTextActive: { color: colors.textPrimary },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: colors.textPrimary,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 16,
  },
  switchLabel: { flex: 1, marginRight: 12 },
  switchTitle: { fontSize: 15, fontWeight: "600", color: colors.textPrimary },
  switchSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },

  // Gateway-specific styles
  gatewayHint: { fontSize: 12, color: colors.textMuted, marginBottom: 10, lineHeight: 18 },
  settlementChip: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 110,
  },
  settlementChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  settlementChipText: { fontSize: 12, fontWeight: "600", color: colors.textPrimary },
  settlementChipTextActive: { color: colors.textPrimary },
  settlementChipSub: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  chargeRateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 6,
  },
  chargeRateLabel: { fontSize: 13, fontWeight: "600", color: colors.textPrimary, flex: 1 },
  chargeRateInputWrapper: { flexDirection: "row", alignItems: "center", gap: 4 },
  chargeRateInput: {
    width: 70,
    textAlign: "right",
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: colors.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  chargeRatePercent: { fontSize: 13, color: colors.textMuted, fontWeight: "600" },

  footer: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },
  createBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: colors.brand, borderRadius: 16, paddingVertical: 16, gap: 10, shadowColor: colors.brand, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 6 },
  createBtnDisabled: { opacity: 0.7 },
  createBtnText: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
}));
