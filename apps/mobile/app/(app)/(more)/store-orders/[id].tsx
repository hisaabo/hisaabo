import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";
import { formatCurrency, formatDate } from "../../../../src/lib/utils";
import { colors } from "../../../../src/lib/theme";
import { StatusBadge } from "../../../../src/components/ui";
import { haptic } from "../../../../src/lib/haptics";

type OrderStatus = "pending" | "confirmed" | "preparing" | "ready" | "delivered" | "cancelled";

const STATUS_NEXT: Partial<Record<OrderStatus, { label: string; nextStatus: "preparing" | "ready" | "delivered" }>> = {
  confirmed: { label: "Mark Preparing", nextStatus: "preparing" },
  preparing: { label: "Mark Ready", nextStatus: "ready" },
  ready: { label: "Mark Delivered", nextStatus: "delivered" },
};

export default function StoreOrderDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [cancelReason, setCancelReason] = useState("");
  const [showCancelModal, setShowCancelModal] = useState(false);
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.store.getOrder.useQuery(
    { id: id! },
    { enabled: !!id }
  );

  const invalidate = () => {
    utils.store.getOrder.invalidate({ id: id! });
    utils.store.listOrders.invalidate();
  };

  const confirmMutation = trpc.store.confirmOrder.useMutation({
    onSuccess: () => { haptic.success(); invalidate(); },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const updateStatusMutation = trpc.store.updateOrderStatus.useMutation({
    onSuccess: () => { haptic.success(); invalidate(); },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const cancelMutation = trpc.store.cancelOrder.useMutation({
    onSuccess: () => { haptic.success(); invalidate(); setShowCancelModal(false); },
    onError: (err) => Alert.alert("Error", err.message),
  });

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!data) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Order Not Found</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centered}>
          <Text style={styles.notFoundText}>This order could not be found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const status = data.status as OrderStatus;
  const nextAction = STATUS_NEXT[status];
  const canCancel = status !== "delivered" && status !== "cancelled";

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{data.orderNumber}</Text>
        <StatusBadge status={data.status} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Customer Info */}
        <Text style={styles.sectionLabel}>Customer</Text>
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Ionicons name="person-outline" size={16} color={colors.textMuted} />
            <Text style={styles.infoText}>{data.customerName}</Text>
          </View>
          {data.customerPhone ? (
            <View style={styles.infoRow}>
              <Ionicons name="call-outline" size={16} color={colors.textMuted} />
              <Text style={styles.infoText}>{data.customerPhone}</Text>
            </View>
          ) : null}
          {data.customerEmail ? (
            <View style={styles.infoRow}>
              <Ionicons name="mail-outline" size={16} color={colors.textMuted} />
              <Text style={styles.infoText}>{data.customerEmail}</Text>
            </View>
          ) : null}
        </View>

        {/* Delivery Address */}
        {(data.deliveryAddress || data.deliveryCity || data.deliveryPincode) ? (
          <>
            <Text style={styles.sectionLabel}>Delivery Address</Text>
            <View style={styles.infoCard}>
              <View style={styles.infoRow}>
                <Ionicons name="location-outline" size={16} color={colors.textMuted} />
                <Text style={styles.infoText}>
                  {[data.deliveryAddress, data.deliveryCity, data.deliveryPincode].filter(Boolean).join(", ")}
                </Text>
              </View>
            </View>
          </>
        ) : null}

        {/* Order Meta */}
        <Text style={styles.sectionLabel}>Order Info</Text>
        <View style={styles.infoCard}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Order Date</Text>
            <Text style={styles.metaValue}>{formatDate(data.createdAt)}</Text>
          </View>
          {data.confirmedAt ? (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Confirmed At</Text>
              <Text style={styles.metaValue}>{formatDate(data.confirmedAt)}</Text>
            </View>
          ) : null}
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Items</Text>
            <Text style={styles.metaValue}>{data.itemCount}</Text>
          </View>
        </View>

        {/* Line Items */}
        {data.lineItems && data.lineItems.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>Items</Text>
            <View style={styles.lineItemsCard}>
              {data.lineItems.map((li, idx) => (
                <View key={li.id} style={[styles.lineItem, idx < data.lineItems.length - 1 && styles.lineItemBorder]}>
                  <View style={styles.lineItemLeft}>
                    <Text style={styles.lineItemDesc} numberOfLines={2}>{li.description}</Text>
                    <Text style={styles.lineItemMeta}>
                      {li.quantity} x {formatCurrency(li.unitPrice)}
                      {parseFloat(li.taxPercent) > 0 ? ` + ${li.taxPercent}% GST` : ""}
                    </Text>
                  </View>
                  <Text style={styles.lineItemAmount}>{formatCurrency(li.totalAmount)}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {/* Total */}
        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>Total Amount</Text>
          <Text style={styles.totalValue}>{formatCurrency(data.totalAmount)}</Text>
        </View>

        {/* Cancellation Reason */}
        {data.status === "cancelled" && data.cancellationReason ? (
          <View style={styles.cancelReasonBox}>
            <Ionicons name="close-circle-outline" size={16} color={colors.danger} />
            <View style={styles.cancelReasonContent}>
              <Text style={styles.cancelReasonLabel}>Cancellation Reason</Text>
              <Text style={styles.cancelReasonText}>{data.cancellationReason}</Text>
            </View>
          </View>
        ) : null}

        {/* Actions */}
        <Text style={styles.sectionLabel}>Actions</Text>
        <View style={styles.actionsCard}>
          {status === "pending" && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnPrimary]}
              onPress={() => {
                Alert.alert("Confirm Order", "Mark this order as confirmed?", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Confirm", onPress: () => confirmMutation.mutate({ orderId: data.id }) },
                ]);
              }}
              disabled={confirmMutation.isPending}
              activeOpacity={0.8}
            >
              {confirmMutation.isPending ? (
                <ActivityIndicator size="small" color={colors.textPrimary} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={18} color={colors.textPrimary} />
                  <Text style={styles.actionBtnPrimaryText}>Confirm Order</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {nextAction && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnPrimary]}
              onPress={() => {
                Alert.alert("Update Status", `${nextAction.label}?`, [
                  { text: "Cancel", style: "cancel" },
                  { text: "Update", onPress: () => updateStatusMutation.mutate({ orderId: data.id, status: nextAction.nextStatus }) },
                ]);
              }}
              disabled={updateStatusMutation.isPending}
              activeOpacity={0.8}
            >
              {updateStatusMutation.isPending ? (
                <ActivityIndicator size="small" color={colors.textPrimary} />
              ) : (
                <>
                  <Ionicons name="arrow-forward-circle-outline" size={18} color={colors.textPrimary} />
                  <Text style={styles.actionBtnPrimaryText}>{nextAction.label}</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {canCancel && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnDanger]}
              onPress={() => setShowCancelModal(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="close-circle-outline" size={18} color={colors.danger} />
              <Text style={styles.actionBtnDangerText}>Cancel Order</Text>
            </TouchableOpacity>
          )}

          {!canCancel && status !== "cancelled" && (
            <View style={styles.completedBox}>
              <Ionicons name="checkmark-done-circle" size={20} color={colors.success} />
              <Text style={styles.completedText}>Order Delivered</Text>
            </View>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Cancel Modal */}
      <Modal visible={showCancelModal} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Cancel Order</Text>
              <TouchableOpacity onPress={() => setShowCancelModal(false)} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>Provide a reason for cancellation (optional):</Text>
            <TextInput
              style={styles.cancelInput}
              value={cancelReason}
              onChangeText={setCancelReason}
              placeholder="e.g. Customer requested cancellation"
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowCancelModal(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.modalCancelBtnText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, cancelMutation.isPending && styles.btnDisabled]}
                onPress={() => cancelMutation.mutate({ orderId: data.id, reason: cancelReason.trim() || undefined })}
                disabled={cancelMutation.isPending}
                activeOpacity={0.8}
              >
                {cancelMutation.isPending ? (
                  <ActivityIndicator size="small" color={colors.textPrimary} />
                ) : (
                  <Text style={styles.modalConfirmBtnText}>Cancel Order</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
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
  scroll: { flex: 1 },
  scrollContent: { padding: 16 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 10,
  },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  infoText: { flex: 1, fontSize: 14, color: colors.textPrimary },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  metaLabel: { fontSize: 13, color: colors.textMuted },
  metaValue: { fontSize: 13, fontWeight: "600", color: colors.textPrimary },
  lineItemsCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  lineItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  lineItemBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  lineItemLeft: { flex: 1, gap: 2 },
  lineItemDesc: { fontSize: 13, fontWeight: "600", color: colors.textPrimary },
  lineItemMeta: { fontSize: 12, color: colors.textMuted },
  lineItemAmount: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  totalCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 8,
  },
  totalLabel: { fontSize: 15, fontWeight: "600", color: colors.textSecondary },
  totalValue: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
  cancelReasonBox: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: colors.dangerBg,
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.danger + "30",
  },
  cancelReasonContent: { flex: 1, gap: 4 },
  cancelReasonLabel: { fontSize: 11, fontWeight: "700", color: colors.danger, textTransform: "uppercase" },
  cancelReasonText: { fontSize: 13, color: colors.textSecondary },
  actionsCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 10,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    paddingVertical: 13,
    gap: 8,
  },
  actionBtnPrimary: {
    backgroundColor: colors.brand,
    shadowColor: colors.brand,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  actionBtnPrimaryText: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  actionBtnDanger: {
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.danger + "40",
  },
  actionBtnDangerText: { fontSize: 14, fontWeight: "700", color: colors.danger },
  completedBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 8,
  },
  completedText: { fontSize: 14, fontWeight: "600", color: colors.success },
  // Cancel Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  modalSheet: {
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
  modalHeader: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  modalTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  modalSubtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: 12 },
  cancelInput: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.textPrimary,
    minHeight: 80,
    marginBottom: 16,
  },
  modalActions: { flexDirection: "row", gap: 10 },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 13,
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  modalCancelBtnText: { fontSize: 14, fontWeight: "600", color: colors.textSecondary },
  modalConfirmBtn: {
    flex: 2,
    paddingVertical: 13,
    backgroundColor: colors.danger,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  modalConfirmBtnText: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  btnDisabled: { opacity: 0.7 },
});
