import { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";
import { usePermissions } from "../../../../src/hooks/usePermissions";
import { formatCurrency, formatDate } from "../../../../src/lib/utils";
import { makeStyles } from "../../../../src/lib/makeStyles";
import { useColors } from "../../../../src/contexts/ThemeContext";
import { haptic } from "../../../../src/lib/haptics";
import { QueryError, DatePickerField } from "../../../../src/components/ui";

type PaymentMode = "cash" | "bank" | "upi" | "cheque" | "other";

const MODE_COLORS: Record<PaymentMode, { bg: string; text: string }> = {
  cash: { bg: "rgba(34, 197, 94, 0.15)", text: "#22c55e" },
  upi: { bg: "rgba(168, 85, 247, 0.15)", text: "#a855f7" },
  bank: { bg: "rgba(59, 130, 246, 0.15)", text: "#3b82f6" },
  cheque: { bg: "rgba(245, 158, 11, 0.15)", text: "#f59e0b" },
  other: { bg: "rgba(156, 163, 175, 0.15)", text: "#9ca3af" },
};

const PAYMENT_MODES: { value: PaymentMode; label: string; color: string }[] = [
  { value: "cash", label: "Cash", color: "#22c55e" },
  { value: "upi", label: "UPI", color: "#a855f7" },
  { value: "bank", label: "Bank", color: "#3b82f6" },
  { value: "cheque", label: "Cheque", color: "#f59e0b" },
  { value: "other", label: "Other", color: "#9ca3af" },
];

const COMMON_CATEGORIES = [
  "Rent", "Utilities", "Salaries", "Office Supplies", "Travel", "Marketing",
  "Maintenance", "Insurance", "Fuel", "Food & Entertainment",
];

export default function ExpenseDetailScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { can } = usePermissions();
  const utils = trpc.useUtils();

  const [isEditing, setIsEditing] = useState(false);
  const [editCategory, setEditCategory] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editMode, setEditMode] = useState<PaymentMode>("cash");
  const [editDate, setEditDate] = useState(new Date());
  const [editReferenceNumber, setEditReferenceNumber] = useState("");
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);

  // The expense router does not expose a getById endpoint. We use expense.list and find by id.
  // The list is cached, so this is typically free after the list screen loads.
  const { data: expenseData, isLoading: expenseLoading, refetch: refetchExpense, isRefetching: isRefetchingExpense } =
    trpc.expense.list.useQuery(
      { page: 1, limit: 200 },
      { enabled: !!id }
    );

  const expenseItem = expenseData?.data.find((e) => e.id === id);

  const updateExpense = trpc.expense.update.useMutation({
    onSuccess: () => {
      utils.expense.list.invalidate();
      utils.dashboard.summary.invalidate();
      utils.bankAccount.list.invalidate();
      setIsEditing(false);
      refetchExpense();
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to update expense");
    },
  });

  const deleteExpense = trpc.expense.delete.useMutation({
    onSuccess: () => {
      utils.expense.list.invalidate();
      utils.dashboard.summary.invalidate();
      utils.bankAccount.list.invalidate();
      router.back();
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to delete expense");
    },
  });

  const handleStartEdit = useCallback(() => {
    if (!expenseItem) return;
    setEditCategory(expenseItem.category ?? "");
    setEditDescription(expenseItem.description ?? "");
    setEditAmount(expenseItem.amount ?? "");
    setEditMode((expenseItem.mode as PaymentMode) ?? "cash");
    setEditDate(
      expenseItem.expenseDate
        ? new Date(expenseItem.expenseDate)
        : new Date()
    );
    setEditReferenceNumber(expenseItem.referenceNumber ?? "");
    setIsEditing(true);
  }, [expenseItem]);

  const handleSave = useCallback(() => {
    if (!expenseItem) return;
    if (!editCategory.trim()) {
      Alert.alert("Validation", "Category is required");
      return;
    }
    if (!editAmount || isNaN(parseFloat(editAmount)) || parseFloat(editAmount) <= 0) {
      Alert.alert("Validation", "Enter a valid amount");
      return;
    }
    haptic.success();
    updateExpense.mutate({
      id: expenseItem.id,
      data: {
        category: editCategory.trim(),
        description: editDescription.trim() || undefined,
        amount: parseFloat(editAmount).toFixed(2),
        mode: editMode,
        expenseDate: editDate.toISOString(),
        referenceNumber: editReferenceNumber.trim() || undefined,
      },
    });
  }, [expenseItem, editCategory, editDescription, editAmount, editMode, editDate, editReferenceNumber, updateExpense]);

  const handleDelete = useCallback(() => {
    if (!expenseItem) return;
    Alert.alert(
      "Delete Expense",
      `Delete this ${expenseItem.category} expense? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            haptic.error();
            deleteExpense.mutate({ id: expenseItem.id });
          },
        },
      ]
    );
  }, [expenseItem, deleteExpense]);

  const filteredCategories = COMMON_CATEGORIES.filter((c) =>
    c.toLowerCase().includes(editCategory.toLowerCase())
  );

  if (expenseLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!expenseItem) {
    return (
      <SafeAreaView style={styles.container}>
        <QueryError message="Expense not found" onRetry={() => refetchExpense()} />
      </SafeAreaView>
    );
  }

  const modeColors = MODE_COLORS[expenseItem.mode as PaymentMode] ?? MODE_COLORS.other;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {isEditing ? editCategory || "Edit Expense" : expenseItem.category}
          </Text>
        </View>
        <View style={styles.headerActions}>
          {!isEditing && (
            <>
              {can("update", "Expense") && (
                <TouchableOpacity onPress={handleStartEdit} style={styles.editBtn}>
                  <Ionicons name="create-outline" size={20} color={colors.brand} />
                </TouchableOpacity>
              )}
              {can("delete", "Expense") && (
                <TouchableOpacity onPress={handleDelete} style={styles.deleteBtn}>
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                </TouchableOpacity>
              )}
            </>
          )}
          {isEditing && (
            <>
              <TouchableOpacity onPress={() => setIsEditing(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSave}
                style={[styles.saveBtn, updateExpense.isPending && styles.saveBtnDisabled]}
                disabled={updateExpense.isPending}
              >
                {updateExpense.isPending ? (
                  <ActivityIndicator size="small" color={colors.textPrimary} />
                ) : (
                  <Text style={styles.saveBtnText}>Save</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={isRefetchingExpense}
            onRefresh={refetchExpense}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
      >
        {/* Amount Card */}
        <View style={styles.amountCard}>
          <Text style={styles.amountLabel}>Amount</Text>
          {isEditing ? (
            <TextInput
              style={styles.amountInput}
              value={editAmount}
              onChangeText={setEditAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.textMuted}
            />
          ) : (
            <Text style={styles.amountValue}>{formatCurrency(expenseItem.amount)}</Text>
          )}
        </View>

        {/* Details Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Expense Details</Text>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Category</Text>
            {isEditing ? (
              <View style={{ flex: 1 }}>
                <TextInput
                  style={styles.inlineInput}
                  value={editCategory}
                  onChangeText={(v) => { setEditCategory(v); setShowCategorySuggestions(true); }}
                  onFocus={() => setShowCategorySuggestions(true)}
                  onBlur={() => setTimeout(() => setShowCategorySuggestions(false), 150)}
                  placeholder="e.g. Rent, Utilities..."
                  placeholderTextColor={colors.textMuted}
                />
                {showCategorySuggestions && filteredCategories.length > 0 && (
                  <View style={styles.suggestions}>
                    {filteredCategories.slice(0, 4).map((cat) => (
                      <TouchableOpacity
                        key={cat}
                        style={styles.suggestionItem}
                        onPress={() => { setEditCategory(cat); setShowCategorySuggestions(false); }}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.suggestionText}>{cat}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            ) : (
              <Text style={styles.detailValue}>{expenseItem.category}</Text>
            )}
          </View>

          <View style={styles.detailDivider} />

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Description</Text>
            {isEditing ? (
              <TextInput
                style={[styles.inlineInput, styles.notesInput]}
                value={editDescription}
                onChangeText={setEditDescription}
                placeholder="Describe the expense..."
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={2}
                textAlignVertical="top"
              />
            ) : (
              <Text style={styles.detailValue}>{expenseItem.description ?? "—"}</Text>
            )}
          </View>

          <View style={styles.detailDivider} />

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Mode</Text>
            {isEditing ? (
              <View style={styles.modeRow}>
                {PAYMENT_MODES.map((m) => (
                  <TouchableOpacity
                    key={m.value}
                    style={[
                      styles.modeChip,
                      editMode === m.value && { backgroundColor: m.color + "22", borderColor: m.color },
                    ]}
                    onPress={() => setEditMode(m.value)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.modeChipText, editMode === m.value && { color: m.color }]}>
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View style={[styles.modeBadge, { backgroundColor: modeColors.bg }]}>
                <Text style={[styles.modeBadgeText, { color: modeColors.text }]}>
                  {expenseItem.mode.charAt(0).toUpperCase() + expenseItem.mode.slice(1)}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.detailDivider} />

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Date</Text>
            {isEditing ? (
              <View style={{ flex: 1 }}>
                <DatePickerField
                  label=""
                  value={editDate}
                  onChange={setEditDate}
                />
              </View>
            ) : (
              <Text style={styles.detailValue}>
                {expenseItem.expenseDate ? formatDate(expenseItem.expenseDate) : "—"}
              </Text>
            )}
          </View>

          <View style={styles.detailDivider} />

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Reference</Text>
            {isEditing ? (
              <TextInput
                style={styles.inlineInput}
                value={editReferenceNumber}
                onChangeText={setEditReferenceNumber}
                placeholder="Bill no., receipt no., etc."
                placeholderTextColor={colors.textMuted}
              />
            ) : (
              <Text style={styles.detailValue}>{expenseItem.referenceNumber ?? "—"}</Text>
            )}
          </View>
        </View>

        {/* Delete Button */}
        {!isEditing && can("delete", "Expense") && (
          <TouchableOpacity
            style={styles.deleteBtnFull}
            onPress={handleDelete}
            activeOpacity={0.8}
          >
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
            <Text style={styles.deleteBtnText}>Delete Expense</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: "700", color: colors.textPrimary },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  editBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(239,68,68,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelBtnText: { fontSize: 14, color: colors.textSecondary, fontWeight: "600" },
  saveBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.brand,
    minWidth: 60,
    alignItems: "center",
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  content: { padding: 16, paddingBottom: 40 },
  amountCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    marginBottom: 12,
    alignItems: "center",
  },
  amountLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },
  amountValue: { fontSize: 36, fontWeight: "800", color: colors.danger },
  amountInput: {
    fontSize: 32,
    fontWeight: "700",
    color: colors.textPrimary,
    textAlign: "center",
    borderBottomWidth: 2,
    borderBottomColor: colors.brand,
    paddingBottom: 4,
    minWidth: 120,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingVertical: 10,
    gap: 12,
  },
  detailLabel: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: "600",
    minWidth: 90,
  },
  detailValue: {
    fontSize: 14,
    color: colors.textPrimary,
    flex: 1,
    textAlign: "right",
  },
  detailDivider: { height: 1, backgroundColor: colors.border },
  modeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  modeBadgeText: { fontSize: 13, fontWeight: "600", textTransform: "capitalize" },
  modeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, flex: 1, justifyContent: "flex-end" },
  modeChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  modeChipText: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
  inlineInput: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    textAlign: "right",
    borderBottomWidth: 1,
    borderBottomColor: colors.brand,
    paddingBottom: 2,
  },
  notesInput: {
    minHeight: 48,
    textAlign: "left",
    textAlignVertical: "top",
  },
  suggestions: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    marginTop: 4,
    overflow: "hidden",
  },
  suggestionItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  suggestionText: { fontSize: 13, color: colors.textPrimary },
  deleteBtnFull: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(239,68,68,0.08)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 4,
  },
  deleteBtnText: { fontSize: 15, fontWeight: "600", color: colors.danger },
}));
