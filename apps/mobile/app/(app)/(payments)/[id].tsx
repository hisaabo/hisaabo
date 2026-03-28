import { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
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
import { trpc } from "../../../src/lib/trpc";
import { formatCurrency, formatDate } from "../../../src/lib/utils";
import { colors } from "../../../src/lib/theme";
import { haptic } from "../../../src/lib/haptics";
import { QueryError, DatePickerField } from "../../../src/components/ui";

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

export default function PaymentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();

  const [isEditing, setIsEditing] = useState(false);
  const [editAmount, setEditAmount] = useState("");
  const [editMode, setEditMode] = useState<PaymentMode>("cash");
  const [editReferenceNumber, setEditReferenceNumber] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editDate, setEditDate] = useState(new Date());

  const { data: payment, isLoading, refetch, isRefetching } = trpc.payment.getById.useQuery(
    { id: id ?? "" },
    { enabled: !!id }
  );

  const updatePayment = trpc.payment.update.useMutation({
    onSuccess: () => {
      utils.payment.list.invalidate();
      utils.payment.getById.invalidate({ id: id ?? "" });
      setIsEditing(false);
      refetch();
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to update payment");
    },
  });

  const deletePayment = trpc.payment.delete.useMutation({
    onSuccess: () => {
      utils.payment.list.invalidate();
      router.back();
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to delete payment");
    },
  });

  const handleStartEdit = useCallback(() => {
    if (!payment) return;
    setEditAmount(payment.amount ?? "");
    setEditMode((payment.mode as PaymentMode) ?? "cash");
    setEditReferenceNumber(payment.referenceNumber ?? "");
    setEditNotes(payment.notes ?? "");
    setEditDate(
      payment.paymentDate
        ? new Date(payment.paymentDate)
        : new Date()
    );
    setIsEditing(true);
  }, [payment]);

  const handleSave = useCallback(() => {
    if (!payment) return;
    if (!editAmount || isNaN(parseFloat(editAmount)) || parseFloat(editAmount) <= 0) {
      Alert.alert("Validation", "Enter a valid amount");
      return;
    }
    haptic.success();
    updatePayment.mutate({
      id: payment.id,
      amount: parseFloat(editAmount).toFixed(2),
      mode: editMode,
      referenceNumber: editReferenceNumber.trim() || null,
      notes: editNotes.trim() || null,
      paymentDate: editDate.toISOString(),
    });
  }, [payment, editAmount, editMode, editReferenceNumber, editNotes, editDate, updatePayment]);

  const handleDelete = useCallback(() => {
    if (!payment) return;
    Alert.alert(
      "Delete Payment",
      `Delete ${payment.paymentNumber}? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            haptic.error();
            deletePayment.mutate({ id: payment.id });
          },
        },
      ]
    );
  }, [payment, deletePayment]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!payment) {
    return (
      <SafeAreaView style={styles.container}>
        <QueryError message="Payment not found" onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  const modeColors = MODE_COLORS[payment.mode as PaymentMode] ?? MODE_COLORS.other;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{payment.paymentNumber}</Text>
        </View>
        <View style={styles.headerActions}>
          {!isEditing && (
            <>
              <TouchableOpacity onPress={handleStartEdit} style={styles.editBtn}>
                <Ionicons name="create-outline" size={20} color={colors.brand} />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleDelete} style={styles.deleteBtn}>
                <Ionicons name="trash-outline" size={20} color={colors.danger} />
              </TouchableOpacity>
            </>
          )}
          {isEditing && (
            <>
              <TouchableOpacity onPress={() => setIsEditing(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSave}
                style={[styles.saveBtn, updatePayment.isPending && styles.saveBtnDisabled]}
                disabled={updatePayment.isPending}
              >
                {updatePayment.isPending ? (
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
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
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
            <Text style={styles.amountValue}>{formatCurrency(payment.amount)}</Text>
          )}
        </View>

        {/* Details Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Payment Details</Text>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Party</Text>
            <Text style={styles.detailValue}>{payment.partyName}</Text>
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
                  {payment.mode.charAt(0).toUpperCase() + payment.mode.slice(1)}
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
                {payment.paymentDate ? formatDate(payment.paymentDate) : "—"}
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
                placeholder="Cheque no., UTR, etc."
                placeholderTextColor={colors.textMuted}
              />
            ) : (
              <Text style={styles.detailValue}>{payment.referenceNumber ?? "—"}</Text>
            )}
          </View>

          {(payment.notes || isEditing) && (
            <>
              <View style={styles.detailDivider} />
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Notes</Text>
                {isEditing ? (
                  <TextInput
                    style={[styles.inlineInput, styles.notesInput]}
                    value={editNotes}
                    onChangeText={setEditNotes}
                    placeholder="Additional notes..."
                    placeholderTextColor={colors.textMuted}
                    multiline
                    numberOfLines={2}
                    textAlignVertical="top"
                  />
                ) : (
                  <Text style={styles.detailValue}>{payment.notes}</Text>
                )}
              </View>
            </>
          )}
        </View>

        {/* Linked Invoices */}
        {payment.linkedInvoices && payment.linkedInvoices.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Allocated to Invoices</Text>
            {payment.linkedInvoices.map((inv, idx) => (
              <View key={inv.invoiceId ?? idx}>
                {idx > 0 && <View style={styles.detailDivider} />}
                <View style={styles.invoiceRow}>
                  <View style={styles.invoiceInfo}>
                    <Text style={styles.invoiceNumber}>{inv.invoiceNumber}</Text>
                    <Text style={styles.invoiceDate}>
                      {inv.invoiceDate ? formatDate(inv.invoiceDate) : ""}
                    </Text>
                  </View>
                  <View style={styles.invoiceAmounts}>
                    <Text style={styles.invoiceAlloc}>{formatCurrency(inv.amount)}</Text>
                    <Text style={styles.invoiceTotal}>of {formatCurrency(inv.totalAmount)}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Delete Button */}
        {!isEditing && (
          <TouchableOpacity
            style={styles.deleteBtnFull}
            onPress={handleDelete}
            activeOpacity={0.8}
          >
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
            <Text style={styles.deleteBtnText}>Delete Payment</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  amountLabel: { fontSize: 12, fontWeight: "600", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
  amountValue: { fontSize: 36, fontWeight: "800", color: colors.success },
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
  detailLabel: { fontSize: 13, color: colors.textMuted, fontWeight: "600", minWidth: 80 },
  detailValue: { fontSize: 14, color: colors.textPrimary, flex: 1, textAlign: "right" },
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
  notesInput: { minHeight: 48, textAlign: "left", textAlignVertical: "top" },
  invoiceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  invoiceInfo: { flex: 1 },
  invoiceNumber: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  invoiceDate: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  invoiceAmounts: { alignItems: "flex-end" },
  invoiceAlloc: { fontSize: 14, fontWeight: "700", color: colors.success },
  invoiceTotal: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
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
});
