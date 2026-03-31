import { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";
import { formatCurrency, formatDate } from "../../../../src/lib/utils";
import { colors } from "../../../../src/lib/theme";
import { haptic } from "../../../../src/lib/haptics";
import { DatePickerField } from "../../../../src/components/ui";

type AccountType = "savings" | "current" | "cash" | "upi" | "credit" | "other";
type TxType = "deposit" | "withdrawal";

const ACCOUNT_TYPE_CONFIG: Record<AccountType, { label: string; color: string; bg: string; icon: string }> = {
  savings: { label: "Savings", color: "#3b82f6", bg: "rgba(59,130,246,0.15)", icon: "card-outline" },
  current: { label: "Current", color: "#6366f1", bg: "rgba(99,102,241,0.15)", icon: "business-outline" },
  cash: { label: "Cash", color: "#22c55e", bg: "rgba(34,197,94,0.15)", icon: "cash-outline" },
  upi: { label: "UPI", color: "#a855f7", bg: "rgba(168,85,247,0.15)", icon: "phone-portrait-outline" },
  credit: { label: "Credit Card", color: "#f59e0b", bg: "rgba(245,158,11,0.15)", icon: "wallet-outline" },
  other: { label: "Other", color: "#9ca3af", bg: "rgba(156,163,175,0.15)", icon: "ellipsis-horizontal-outline" },
};

function todayDate() { return new Date(); }

interface AddTransactionModalProps {
  visible: boolean;
  accountId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function AddTransactionModal({ visible, accountId, onClose, onSuccess }: AddTransactionModalProps) {
  const [txType, setTxType] = useState<TxType>("deposit");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [txDate, setTxDate] = useState(todayDate());

  const mutation = trpc.bankAccount.addTransaction.useMutation({
    onSuccess: () => {
      haptic.success();
      setAmount("");
      setDescription("");
      onSuccess();
      onClose();
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const handleSubmit = () => {
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt <= 0) {
      Alert.alert("Validation", "Enter a valid amount.");
      return;
    }
    mutation.mutate({
      bankAccountId: accountId,
      type: txType,
      amount: amt.toFixed(2),
      description: description.trim() || undefined,
      transactionDate: txDate.toISOString(),
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={ms.overlay}>
        <View style={ms.sheet}>
          <View style={ms.header}>
            <Text style={ms.title}>Add Transaction</Text>
            <TouchableOpacity onPress={onClose} style={ms.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Type Toggle */}
          <View style={ms.typeToggle}>
            <TouchableOpacity
              style={[ms.typeBtn, txType === "deposit" && ms.typeBtnDeposit]}
              onPress={() => setTxType("deposit")}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-down-circle-outline" size={16} color={txType === "deposit" ? colors.textPrimary : colors.textMuted} />
              <Text style={[ms.typeBtnText, txType === "deposit" && ms.typeBtnTextActive]}>Deposit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[ms.typeBtn, txType === "withdrawal" && ms.typeBtnWithdrawal]}
              onPress={() => setTxType("withdrawal")}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-up-circle-outline" size={16} color={txType === "withdrawal" ? colors.textPrimary : colors.textMuted} />
              <Text style={[ms.typeBtnText, txType === "withdrawal" && ms.typeBtnTextActive]}>Withdrawal</Text>
            </TouchableOpacity>
          </View>

          <Text style={ms.fieldLabel}>Amount (₹)</Text>
          <TextInput
            style={ms.input}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={colors.textMuted}
            returnKeyType="done"
          />

          <Text style={ms.fieldLabel}>Description (optional)</Text>
          <TextInput
            style={[ms.input, ms.inputMulti]}
            value={description}
            onChangeText={setDescription}
            placeholder="e.g. Cash sales, Rent payment..."
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={2}
            textAlignVertical="top"
          />

          <DatePickerField
            label="Date"
            value={txDate}
            onChange={setTxDate}
          />

          <TouchableOpacity
            style={[ms.submitBtn, mutation.isPending && ms.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={mutation.isPending}
            activeOpacity={0.85}
          >
            {mutation.isPending ? (
              <ActivityIndicator color={colors.textPrimary} size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={18} color={colors.textPrimary} />
                <Text style={ms.submitBtnText}>Add Transaction</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const PAGE_SIZE = 30;

export default function BankAccountDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [page, setPage] = useState(1);
  const [showAddTx, setShowAddTx] = useState(false);
  const utils = trpc.useUtils();

  const setDefaultMutation = trpc.bankAccount.update.useMutation({
    onSuccess: () => {
      haptic.success();
      utils.bankAccount.getById.invalidate({ id: id! });
      utils.bankAccount.list.invalidate();
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const deleteMutation = trpc.bankAccount.delete.useMutation({
    onSuccess: () => {
      haptic.success();
      utils.bankAccount.list.invalidate();
      utils.bankAccount.summary.invalidate();
      router.replace("/(more)/bank" as never);
    },
    onError: (err) => Alert.alert("Cannot Delete", err.message),
  });

  const handleSetDefault = () => {
    setDefaultMutation.mutate({ id: id!, data: { isDefault: true } });
  };

  const handleDelete = () => {
    Alert.alert(
      "Delete Account",
      "Delete this account? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteMutation.mutate({ id: id! }),
        },
      ]
    );
  };

  const { data: account, isLoading: accountLoading } = trpc.bankAccount.getById.useQuery(
    { id: id! },
    { enabled: !!id }
  );

  const { data: txData, isLoading: txLoading } = trpc.bankAccount.listTransactions.useQuery(
    { bankAccountId: id!, page, limit: PAGE_SIZE },
    { enabled: !!id }
  );

  const invalidate = () => {
    utils.bankAccount.getById.invalidate({ id: id! });
    utils.bankAccount.listTransactions.invalidate({ bankAccountId: id! });
    utils.bankAccount.list.invalidate();
    utils.bankAccount.summary.invalidate();
  };

  if (accountLoading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!account) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Account Not Found</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centered}>
          <Text style={styles.notFoundText}>This account could not be found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const config = ACCOUNT_TYPE_CONFIG[account.accountType as AccountType] ?? ACCOUNT_TYPE_CONFIG.other;
  const balance = parseFloat(account.currentBalance || "0");
  const isNegative = balance < 0;
  const transactions = txData?.data ?? [];
  const total = txData?.total ?? 0;
  const hasMore = total > page * PAGE_SIZE;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{account.accountName}</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerIconBtn}
            onPress={() => router.push(`/(more)/bank/edit?id=${id}` as never)}
            activeOpacity={0.7}
          >
            <Ionicons name="create-outline" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.headerIconBtn, styles.headerIconBtnDanger]}
            onPress={handleDelete}
            disabled={deleteMutation.isPending}
            activeOpacity={0.7}
          >
            {deleteMutation.isPending ? (
              <ActivityIndicator size={16} color={colors.danger} />
            ) : (
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={transactions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            {/* Account Info Card */}
            <View style={styles.accountCard}>
              <View style={[styles.accountIconWrapper, { backgroundColor: config.bg }]}>
                <Ionicons name={config.icon as any} size={28} color={config.color} />
              </View>
              <View style={styles.accountCardBody}>
                <View style={styles.accountNameRow}>
                  <Text style={styles.accountName}>{account.accountName}</Text>
                  {account.isDefault && (
                    <View style={styles.defaultBadge}>
                      <Ionicons name="star" size={10} color={colors.brand} />
                      <Text style={styles.defaultBadgeText}>Default</Text>
                    </View>
                  )}
                </View>
                {account.bankName ? <Text style={styles.bankName}>{account.bankName}</Text> : null}
                {account.accountNumber ? (
                  <Text style={styles.accountNumber}>Account: {account.accountNumber}</Text>
                ) : null}
                {account.ifsc ? (
                  <Text style={styles.ifsc}>IFSC: {account.ifsc}</Text>
                ) : null}
              </View>
              <View style={styles.accountCardRight}>
                <View style={[styles.typeBadge, { backgroundColor: config.bg }]}>
                  <Text style={[styles.typeBadgeText, { color: config.color }]}>{config.label}</Text>
                </View>
                <Text style={[styles.currentBalance, isNegative && styles.balanceNeg]}>
                  {isNegative ? "-" : ""}{formatCurrency(Math.abs(balance))}
                </Text>
                <Text style={styles.balanceLabel}>Current Balance</Text>
              </View>
            </View>

            {/* Set as Default (only when not already default) */}
            {!account.isDefault && (
              <TouchableOpacity
                style={styles.setDefaultBtn}
                onPress={handleSetDefault}
                disabled={setDefaultMutation.isPending}
                activeOpacity={0.8}
              >
                {setDefaultMutation.isPending ? (
                  <ActivityIndicator size={16} color={colors.brand} />
                ) : (
                  <Ionicons name="star-outline" size={16} color={colors.brand} />
                )}
                <Text style={styles.setDefaultBtnText}>Set as Default</Text>
              </TouchableOpacity>
            )}

            {/* Add Transaction Button */}
            <TouchableOpacity
              style={styles.addTxBtn}
              onPress={() => setShowAddTx(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="add-circle-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.addTxBtnText}>Add Transaction</Text>
            </TouchableOpacity>

            {/* Transactions Header */}
            <View style={styles.txHeader}>
              <Text style={styles.sectionLabel}>Transactions</Text>
              {!txLoading && <Text style={styles.txCount}>{total} total</Text>}
            </View>
          </View>
        }
        renderItem={({ item }) => {
          const isDeposit = item.type === "deposit";
          const amt = parseFloat(item.amount || "0");
          const balanceAfter = item.balanceAfter ? parseFloat(item.balanceAfter) : null;

          return (
            <View style={styles.txRow}>
              <View style={[styles.txIcon, { backgroundColor: isDeposit ? colors.successBg : colors.dangerBg }]}>
                <Ionicons
                  name={isDeposit ? "arrow-down-circle-outline" : "arrow-up-circle-outline"}
                  size={20}
                  color={isDeposit ? colors.success : colors.danger}
                />
              </View>
              <View style={styles.txBody}>
                <Text style={styles.txDesc} numberOfLines={1}>
                  {item.description || (isDeposit ? "Deposit" : "Withdrawal")}
                </Text>
                <Text style={styles.txDate}>{formatDate(item.transactionDate)}</Text>
                {item.referenceType && item.referenceType !== "transfer" ? (
                  <Text style={styles.txRef}>{item.referenceType}</Text>
                ) : null}
              </View>
              <View style={styles.txRight}>
                <Text style={[styles.txAmount, { color: isDeposit ? colors.success : colors.danger }]}>
                  {isDeposit ? "+" : "-"}{formatCurrency(amt)}
                </Text>
                {balanceAfter !== null ? (
                  <Text style={styles.txBalance}>{formatCurrency(Math.abs(balanceAfter))}</Text>
                ) : null}
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          txLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.brand} size="small" />
            </View>
          ) : (
            <View style={styles.emptyTx}>
              <Ionicons name="receipt-outline" size={32} color={colors.textMuted} />
              <Text style={styles.emptyTxText}>No transactions yet</Text>
            </View>
          )
        }
        ListFooterComponent={
          hasMore ? (
            <TouchableOpacity style={styles.loadMoreBtn} onPress={() => setPage((p) => p + 1)}>
              <Text style={styles.loadMoreText}>Load more</Text>
            </TouchableOpacity>
          ) : null
        }
        showsVerticalScrollIndicator={false}
      />

      <AddTransactionModal
        visible={showAddTx}
        accountId={id!}
        onClose={() => setShowAddTx(false)}
        onSuccess={invalidate}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  notFoundText: { fontSize: 15, color: colors.textMuted },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
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
  headerTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  headerActions: { flexDirection: "row", gap: 8 },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  headerIconBtnDanger: { borderColor: colors.dangerBg },
  listContent: { paddingHorizontal: 16, paddingBottom: 60 },
  accountCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginTop: 16,
    marginBottom: 12,
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  accountIconWrapper: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  accountCardBody: { flex: 1, gap: 2 },
  accountNameRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  accountName: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  defaultBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.brandLight,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  defaultBadgeText: { fontSize: 10, fontWeight: "700", color: colors.brand },
  bankName: { fontSize: 13, color: colors.textSecondary },
  accountNumber: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  ifsc: { fontSize: 12, color: colors.textMuted },
  accountCardRight: { alignItems: "flex-end", gap: 4 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  typeBadgeText: { fontSize: 10, fontWeight: "700" },
  currentBalance: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
  balanceNeg: { color: colors.danger },
  balanceLabel: { fontSize: 10, color: colors.textMuted },
  setDefaultBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandLight,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.brand + "40",
    paddingVertical: 11,
    gap: 7,
    marginBottom: 10,
  },
  setDefaultBtnText: { fontSize: 13, fontWeight: "600", color: colors.brand },
  addTxBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand,
    borderRadius: 14,
    paddingVertical: 13,
    gap: 8,
    marginBottom: 16,
    shadowColor: colors.brand,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  addTxBtnText: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  txHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 },
  sectionLabel: { fontSize: 11, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  txCount: { fontSize: 12, color: colors.textMuted },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  txIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  txBody: { flex: 1, gap: 2 },
  txDesc: { fontSize: 13, fontWeight: "600", color: colors.textPrimary },
  txDate: { fontSize: 11, color: colors.textMuted },
  txRef: { fontSize: 11, color: colors.brand },
  txRight: { alignItems: "flex-end", gap: 2 },
  txAmount: { fontSize: 14, fontWeight: "700" },
  txBalance: { fontSize: 11, color: colors.textMuted },
  emptyTx: { alignItems: "center", paddingTop: 40, gap: 8 },
  emptyTxText: { fontSize: 14, color: colors.textMuted },
  loadMoreBtn: {
    marginTop: 4,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  loadMoreText: { fontSize: 14, fontWeight: "600", color: colors.brand },
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
    padding: 24,
    paddingBottom: 40,
  },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 20 },
  title: { flex: 1, fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  typeToggle: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 4,
  },
  typeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 9,
    gap: 6,
  },
  typeBtnDeposit: { backgroundColor: colors.successBg },
  typeBtnWithdrawal: { backgroundColor: colors.dangerBg },
  typeBtnText: { fontSize: 13, fontWeight: "600", color: colors.textMuted },
  typeBtnTextActive: { color: colors.textPrimary },
  fieldLabel: { fontSize: 11, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.textPrimary,
  },
  inputMulti: { minHeight: 60, textAlignVertical: "top" },
  datePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  datePillText: { fontSize: 14, color: colors.textSecondary },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 20,
    gap: 8,
    shadowColor: colors.brand,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  submitBtnDisabled: { opacity: 0.7 },
  submitBtnText: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
});
