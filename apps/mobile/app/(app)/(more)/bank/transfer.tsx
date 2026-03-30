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
  Modal,
  FlatList,
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

type AccountType = "savings" | "current" | "cash" | "upi" | "credit" | "other";

const ACCOUNT_TYPE_CONFIG: Record<AccountType, { label: string; color: string; icon: string }> = {
  savings: { label: "Savings", color: "#3b82f6", icon: "card-outline" },
  current: { label: "Current", color: "#6366f1", icon: "business-outline" },
  cash: { label: "Cash", color: "#22c55e", icon: "cash-outline" },
  upi: { label: "UPI", color: "#a855f7", icon: "phone-portrait-outline" },
  credit: { label: "Credit Card", color: "#f59e0b", icon: "wallet-outline" },
  other: { label: "Other", color: "#9ca3af", icon: "ellipsis-horizontal-outline" },
};

interface Account {
  id: string;
  accountName: string;
  accountType: string;
  currentBalance: string;
  bankName?: string | null;
}

function AccountPickerModal({
  visible,
  accounts,
  onSelect,
  onClose,
  title,
  excludeId,
}: {
  visible: boolean;
  accounts: Account[];
  onSelect: (account: Account) => void;
  onClose: () => void;
  title: string;
  excludeId?: string;
}) {
  const filtered = excludeId ? accounts.filter((a) => a.id !== excludeId) : accounts;

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={ms.overlay}>
        <View style={ms.sheet}>
          <View style={ms.header}>
            <Text style={ms.title}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={ms.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={ms.listContent}
            renderItem={({ item }) => {
              const config = ACCOUNT_TYPE_CONFIG[item.accountType as AccountType] ?? ACCOUNT_TYPE_CONFIG.other;
              const balance = parseFloat(item.currentBalance || "0");
              return (
                <TouchableOpacity
                  style={ms.listItem}
                  onPress={() => { onSelect(item); onClose(); }}
                  activeOpacity={0.7}
                >
                  <View style={[ms.listItemIcon, { backgroundColor: config.color + "20" }]}>
                    <Ionicons name={config.icon as any} size={18} color={config.color} />
                  </View>
                  <View style={ms.listItemBody}>
                    <Text style={ms.listItemName}>{item.accountName}</Text>
                    {item.bankName ? <Text style={ms.listItemSub}>{item.bankName}</Text> : null}
                  </View>
                  <Text style={ms.listItemBalance}>{formatCurrency(balance)}</Text>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={<Text style={ms.emptyText}>No accounts available</Text>}
          />
        </View>
      </View>
    </Modal>
  );
}

function todayDate() { return new Date(); }

export default function BankTransferScreen() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [fromAccount, setFromAccount] = useState<Account | null>(null);
  const [toAccount, setToAccount] = useState<Account | null>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [txDate, setTxDate] = useState(todayDate());
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);

  const { data: accounts } = trpc.bankAccount.list.useQuery();
  const accountList: Account[] = accounts ?? [];

  const transferMutation = trpc.bankAccount.transfer.useMutation({
    onSuccess: () => {
      haptic.success();
      utils.bankAccount.list.invalidate();
      utils.bankAccount.summary.invalidate();
      utils.bankAccount.listTransactions.invalidate();
      router.back();
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const handleTransfer = () => {
    if (!fromAccount) { Alert.alert("Validation", "Select a source account."); return; }
    if (!toAccount) { Alert.alert("Validation", "Select a destination account."); return; }
    if (fromAccount.id === toAccount.id) { Alert.alert("Validation", "Source and destination cannot be the same."); return; }
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt <= 0) { Alert.alert("Validation", "Enter a valid amount."); return; }
    const fromBalance = parseFloat(fromAccount.currentBalance || "0");
    if (amt > fromBalance) {
      Alert.alert(
        "Insufficient Balance",
        `${fromAccount.accountName} has only ${formatCurrency(fromBalance)}. Transfer anyway?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Transfer", onPress: () => doTransfer(amt) },
        ]
      );
      return;
    }
    doTransfer(amt);
  };

  const doTransfer = (amt: number) => {
    transferMutation.mutate({
      fromAccountId: fromAccount!.id,
      toAccountId: toAccount!.id,
      amount: amt.toFixed(2),
      description: description.trim() || undefined,
      transactionDate: txDate.toISOString(),
    });
  };

  const AccountSelector = ({
    label,
    account,
    onPress,
  }: {
    label: string;
    account: Account | null;
    onPress: () => void;
  }) => {
    const config = account ? (ACCOUNT_TYPE_CONFIG[account.accountType as AccountType] ?? ACCOUNT_TYPE_CONFIG.other) : null;
    return (
      <TouchableOpacity
        style={[s.accountSelector, account ? s.accountSelectorFilled : {}]}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {account && config ? (
          <>
            <View style={[s.selectorIcon, { backgroundColor: config.color + "20" }]}>
              <Ionicons name={config.icon as any} size={20} color={config.color} />
            </View>
            <View style={s.selectorBody}>
              <Text style={s.selectorAccountName}>{account.accountName}</Text>
              {account.bankName ? <Text style={s.selectorBankName}>{account.bankName}</Text> : null}
              <Text style={s.selectorBalance}>{formatCurrency(parseFloat(account.currentBalance || "0"))}</Text>
            </View>
          </>
        ) : (
          <>
            <View style={[s.selectorIcon, { backgroundColor: colors.border }]}>
              <Ionicons name="wallet-outline" size={20} color={colors.textMuted} />
            </View>
            <Text style={s.selectorPlaceholder}>{label}</Text>
          </>
        )}
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <View style={s.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={s.topBarTitle}>Transfer Funds</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* From Account */}
          <Text style={s.sectionLabel}>From Account</Text>
          <AccountSelector label="Select source account..." account={fromAccount} onPress={() => setShowFromPicker(true)} />

          {/* Arrow */}
          <View style={s.arrowRow}>
            <View style={s.arrowLine} />
            <View style={s.arrowCircle}>
              <Ionicons name="arrow-down" size={18} color={colors.brand} />
            </View>
            <View style={s.arrowLine} />
          </View>

          {/* To Account */}
          <Text style={s.sectionLabel}>To Account</Text>
          <AccountSelector label="Select destination account..." account={toAccount} onPress={() => setShowToPicker(true)} />

          {/* Amount */}
          <Text style={s.sectionLabel}>Amount (₹)</Text>
          <TextInput
            style={s.input}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={colors.textMuted}
            returnKeyType="done"
          />

          {/* Description */}
          <Text style={s.sectionLabel}>Description (optional)</Text>
          <TextInput
            style={[s.input, s.inputMulti]}
            value={description}
            onChangeText={setDescription}
            placeholder="Reason for transfer..."
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={2}
            textAlignVertical="top"
          />

          {/* Date */}
          <Text style={s.sectionLabel}>Date</Text>
          <DatePickerField
            label="Transfer Date"
            value={txDate}
            onChange={setTxDate}
          />

          <View style={{ height: 100 }} />
        </ScrollView>

        <View style={s.footer}>
          <TouchableOpacity
            style={[s.transferBtn, transferMutation.isPending && s.transferBtnDisabled]}
            onPress={handleTransfer}
            activeOpacity={0.85}
            disabled={transferMutation.isPending}
          >
            {transferMutation.isPending ? (
              <ActivityIndicator color={colors.textPrimary} size="small" />
            ) : (
              <>
                <Ionicons name="swap-horizontal-outline" size={20} color={colors.textPrimary} />
                <Text style={s.transferBtnText}>Transfer Funds</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <AccountPickerModal
        visible={showFromPicker}
        accounts={accountList}
        onSelect={setFromAccount}
        onClose={() => setShowFromPicker(false)}
        title="From Account"
        excludeId={toAccount?.id}
      />
      <AccountPickerModal
        visible={showToPicker}
        accounts={accountList}
        onSelect={setToAccount}
        onClose={() => setShowToPicker(false)}
        title="To Account"
        excludeId={fromAccount?.id}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  topBarTitle: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.textPrimary },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16 },
  sectionLabel: { fontSize: 11, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 16, marginBottom: 8 },
  accountSelector: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 12,
  },
  accountSelectorFilled: { borderColor: colors.brand + "60" },
  selectorIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  selectorBody: { flex: 1, gap: 1 },
  selectorAccountName: { fontSize: 15, fontWeight: "600", color: colors.textPrimary },
  selectorBankName: { fontSize: 12, color: colors.textSecondary },
  selectorBalance: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  selectorPlaceholder: { flex: 1, fontSize: 15, color: colors.textMuted },
  arrowRow: { flexDirection: "row", alignItems: "center", marginVertical: 8 },
  arrowLine: { flex: 1, height: 1, backgroundColor: colors.border },
  arrowCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.brand + "40",
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: colors.textPrimary,
  },
  inputMulti: { minHeight: 60, textAlignVertical: "top", fontSize: 14 },
  datePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  datePillText: { fontSize: 14, color: colors.textSecondary },
  footer: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },
  transferBtn: {
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
  transferBtnDisabled: { opacity: 0.7 },
  transferBtnText: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
});

const ms = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
    maxHeight: "70%",
    paddingBottom: 32,
  },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
  title: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.textPrimary },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  listContent: { paddingHorizontal: 16, paddingTop: 4 },
  listItem: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 12 },
  listItemIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  listItemBody: { flex: 1, gap: 2 },
  listItemName: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  listItemSub: { fontSize: 12, color: colors.textMuted },
  listItemBalance: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  emptyText: { textAlign: "center", paddingTop: 40, fontSize: 14, color: colors.textMuted },
});
