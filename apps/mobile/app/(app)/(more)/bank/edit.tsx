import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";
import { colors } from "../../../../src/lib/theme";
import { haptic } from "../../../../src/lib/haptics";

type AccountType = "savings" | "current" | "cash" | "upi" | "credit_card";

const ACCOUNT_TYPES: { value: AccountType; label: string; icon: string }[] = [
  { value: "savings", label: "Savings", icon: "card-outline" },
  { value: "current", label: "Current", icon: "business-outline" },
  { value: "cash", label: "Cash", icon: "cash-outline" },
  { value: "upi", label: "UPI", icon: "phone-portrait-outline" },
  { value: "credit_card", label: "Credit Card", icon: "wallet-outline" },
];

// Normalise the value coming from the DB (which may use "credit") to the
// create/update schema value "credit_card".
function normaliseType(raw: string): AccountType {
  if (raw === "credit") return "credit_card";
  const valid: AccountType[] = ["savings", "current", "cash", "upi", "credit_card"];
  return valid.includes(raw as AccountType) ? (raw as AccountType) : "savings";
}

export default function BankAccountEditScreen() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: account, isLoading: accountLoading } = trpc.bankAccount.getById.useQuery(
    { id: id! },
    { enabled: !!id }
  );

  // Local form state — initialised lazily once account data arrives
  const [accountName, setAccountName] = useState<string | null>(null);
  const [accountNumber, setAccountNumber] = useState<string | null>(null);
  const [ifsc, setIfsc] = useState<string | null>(null);
  const [bankName, setBankName] = useState<string | null>(null);
  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [isDefault, setIsDefault] = useState<boolean | null>(null);

  // Seed state from the fetched account the first time we get data
  if (account && accountName === null) {
    setAccountName(account.accountName ?? "");
    setAccountNumber(account.accountNumber ?? "");
    setIfsc(account.ifsc ?? "");
    setBankName(account.bankName ?? "");
    setAccountType(normaliseType(account.accountType ?? "savings"));
    setIsDefault(account.isDefault ?? false);
  }

  const updateMutation = trpc.bankAccount.update.useMutation({
    onSuccess: () => {
      haptic.success();
      utils.bankAccount.list.invalidate();
      utils.bankAccount.getById.invalidate({ id: id! });
      router.back();
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const handleSave = () => {
    const name = (accountName ?? "").trim();
    if (!name) {
      Alert.alert("Validation", "Account name is required.");
      return;
    }
    updateMutation.mutate({
      id: id!,
      data: {
        accountName: name,
        accountNumber: (accountNumber ?? "").trim() || undefined,
        ifsc: (ifsc ?? "").trim().toUpperCase() || undefined,
        bankName: (bankName ?? "").trim() || undefined,
        accountType: accountType ?? "savings",
        isDefault: isDefault ?? false,
      },
    });
  };

  if (accountLoading || accountName === null) {
    return (
      <SafeAreaView style={s.container} edges={["top"]}>
        <View style={s.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.topBarTitle}>Edit Account</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={s.centered}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!account) {
    return (
      <SafeAreaView style={s.container} edges={["top"]}>
        <View style={s.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.topBarTitle}>Edit Account</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={s.centered}>
          <Text style={s.notFoundText}>Account not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <View style={s.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={s.topBarTitle}>Edit Account</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
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
          <Text style={s.sectionLabel}>Account Name *</Text>
          <TextInput
            style={s.input}
            value={accountName ?? ""}
            onChangeText={setAccountName}
            placeholder="e.g. HDFC Savings, Petty Cash"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="words"
          />

          {/* Bank Name */}
          <Text style={s.sectionLabel}>Bank Name</Text>
          <TextInput
            style={s.input}
            value={bankName ?? ""}
            onChangeText={setBankName}
            placeholder="e.g. HDFC Bank, SBI"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="words"
          />

          {/* Account Number */}
          <Text style={s.sectionLabel}>Account Number</Text>
          <TextInput
            style={s.input}
            value={accountNumber ?? ""}
            onChangeText={setAccountNumber}
            placeholder="e.g. 1234567890"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
          />

          {/* IFSC */}
          <Text style={s.sectionLabel}>IFSC Code</Text>
          <TextInput
            style={s.input}
            value={ifsc ?? ""}
            onChangeText={setIfsc}
            placeholder="e.g. HDFC0001234"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
          />

          {/* Set as Default */}
          <View style={s.switchRow}>
            <View style={s.switchLabel}>
              <Text style={s.switchTitle}>Set as Default</Text>
              <Text style={s.switchSubtitle}>Use this account by default in transactions</Text>
            </View>
            <Switch
              value={isDefault ?? false}
              onValueChange={setIsDefault}
              trackColor={{ false: colors.border, true: colors.brand }}
              thumbColor={colors.textPrimary}
            />
          </View>

          <View style={{ height: 100 }} />
        </ScrollView>

        <View style={s.footer}>
          <TouchableOpacity
            style={[s.saveBtn, updateMutation.isPending && s.saveBtnDisabled]}
            onPress={handleSave}
            activeOpacity={0.85}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? (
              <ActivityIndicator color={colors.textPrimary} size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={20} color={colors.textPrimary} />
                <Text style={s.saveBtnText}>Save Changes</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  notFoundText: { fontSize: 15, color: colors.textMuted },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
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
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  saveBtn: {
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
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnText: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
});
