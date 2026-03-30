import { useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";
import { formatCurrency, formatDate } from "../../../../src/lib/utils";
import { colors } from "../../../../src/lib/theme";
import { StatusBadge } from "../../../../src/components/ui";

export default function DeliveryChallanDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const utils = trpc.useUtils();

  const { data: challan, isLoading, isError, refetch } = trpc.deliveryChallan.getById.useQuery(
    { id: id! },
    { enabled: !!id }
  );

  const updateMutation = trpc.deliveryChallan.updateStatus.useMutation({
    onSuccess: () => {
      utils.deliveryChallan.list.invalidate();
      utils.deliveryChallan.getById.invalidate({ id: id! });
    },
    onError: (err: { message: string }) => Alert.alert("Error", err.message),
  });

  const convertMutation = trpc.document.convert.useMutation({
    onSuccess: (result) => {
      utils.deliveryChallan.list.invalidate();
      utils.deliveryChallan.getById.invalidate({ id: id! });
      Alert.alert("Converted", `Invoice created: ${result.invoiceNumber}`, [{ text: "OK" }]);
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const handleMarkSent = useCallback(() => {
    if (!challan) return;
    Alert.alert("Mark as Sent", "Mark this challan as sent to the customer?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Mark Sent",
        onPress: () => updateMutation.mutate({ id: challan.id, status: "sent" }),
      },
    ]);
  }, [challan, updateMutation]);

  const handleMarkDelivered = useCallback(() => {
    if (!challan) return;
    Alert.alert("Mark as Delivered", "Confirm delivery of this challan?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Confirm",
        onPress: () => updateMutation.mutate({ id: challan.id, status: "delivered" }),
      },
    ]);
  }, [challan, updateMutation]);

  const handleConvert = useCallback(() => {
    if (!challan) return;
    Alert.alert(
      "Convert to Invoice",
      `Convert challan ${challan.invoiceNumber} into a sales invoice?\n\nNote: Stock will not be deducted again.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Convert",
          onPress: () =>
            convertMutation.mutate({
              sourceDocumentId: challan.id,
              targetDocumentType: "invoice",
            }),
        },
      ]
    );
  }, [challan, convertMutation]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.headerBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.screenTitle}>Delivery Challan</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  if (isError || !challan) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.headerBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.screenTitle}>Delivery Challan</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.danger} />
          <Text style={styles.errorText}>Failed to load challan</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isMutating = updateMutation.isPending || convertMutation.isPending;
  const canConvert = challan.status !== "cancelled";

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Delivery Challan</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header card */}
        <View style={styles.docCard}>
          <View style={styles.docCardTop}>
            <View style={styles.docNumberWrap}>
              <Ionicons name="car-outline" size={18} color={colors.brand} style={styles.docIcon} />
              <Text style={styles.docNumber}>{challan.invoiceNumber}</Text>
            </View>
            <StatusBadge status={challan.status} />
          </View>
          <Text style={styles.partyName}>{challan.party?.name}</Text>
          <Text style={styles.docDate}>{formatDate(challan.invoiceDate)}</Text>
        </View>

        {/* Info box */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={16} color={colors.warning} />
          <Text style={styles.infoText}>Stock was decremented when this challan was created.</Text>
        </View>

        {/* Amount summary */}
        <Text style={styles.sectionLabel}>Summary</Text>
        <View style={styles.totalsCard}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{formatCurrency(challan.subtotal)}</Text>
          </View>
          {parseFloat(challan.totalAmount) - parseFloat(challan.subtotal) > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Tax</Text>
              <Text style={styles.totalValue}>{formatCurrency(parseFloat(challan.totalAmount) - parseFloat(challan.subtotal))}</Text>
            </View>
          )}
          <View style={styles.totalDivider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabelBold}>Total</Text>
            <Text style={styles.totalValueBold}>{formatCurrency(challan.totalAmount)}</Text>
          </View>
        </View>

        {/* Line items */}
        {challan.lineItems && challan.lineItems.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Items</Text>
            <View style={styles.lineItemsCard}>
              {challan.lineItems.map((li: any, idx: number) => (
                <View key={li.id ?? idx} style={[styles.lineItem, idx < challan.lineItems.length - 1 && styles.lineItemBorder]}>
                  <View style={styles.lineItemLeft}>
                    <Text style={styles.lineItemName} numberOfLines={2}>{li.description}</Text>
                    <Text style={styles.lineItemMeta}>
                      {li.quantity} x {formatCurrency(li.unitPrice)}
                      {parseFloat(li.taxPercent ?? "0") > 0 ? ` + ${li.taxPercent}% GST` : ""}
                    </Text>
                  </View>
                  <Text style={styles.lineItemAmount}>{formatCurrency(li.amount)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Notes */}
        {challan.notes ? (
          <>
            <Text style={styles.sectionLabel}>Notes</Text>
            <View style={styles.notesCard}>
              <Text style={styles.notesText}>{challan.notes}</Text>
            </View>
          </>
        ) : null}

        {/* Actions */}
        <Text style={styles.sectionLabel}>Actions</Text>
        <View style={styles.actionsCard}>
          {challan.status === "draft" && (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={handleMarkSent}
              activeOpacity={0.7}
              disabled={isMutating}
            >
              <Ionicons name="send-outline" size={18} color={colors.brand} />
              <Text style={styles.actionBtnText}>Mark as Sent</Text>
              {updateMutation.isPending && <ActivityIndicator size="small" color={colors.brand} style={styles.actionSpinner} />}
            </TouchableOpacity>
          )}

          {(challan.status === "draft" || challan.status === "sent") && (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={handleMarkDelivered}
              activeOpacity={0.7}
              disabled={isMutating}
            >
              <Ionicons name="checkmark-done-outline" size={18} color={colors.success} />
              <Text style={[styles.actionBtnText, { color: colors.success }]}>Mark as Delivered</Text>
              {updateMutation.isPending && <ActivityIndicator size="small" color={colors.success} style={styles.actionSpinner} />}
            </TouchableOpacity>
          )}

          {canConvert && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnConvert]}
              onPress={handleConvert}
              activeOpacity={0.7}
              disabled={isMutating}
            >
              {convertMutation.isPending ? (
                <ActivityIndicator size="small" color={colors.textPrimary} />
              ) : (
                <>
                  <Ionicons name="swap-horizontal-outline" size={18} color={colors.textPrimary} />
                  <Text style={styles.actionBtnConvertText}>Convert to Invoice</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 32 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 12,
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
  screenTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
    textAlign: "center",
  },
  errorText: { fontSize: 16, color: colors.textSecondary, textAlign: "center" },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: colors.brand,
    borderRadius: 12,
  },
  retryBtnText: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
  },
  docCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 6,
  },
  docCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  docNumberWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  docIcon: {},
  docNumber: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  partyName: { fontSize: 15, fontWeight: "600", color: colors.textSecondary },
  docDate: { fontSize: 12, color: colors.textMuted },
  infoBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.warningBg,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.warning + "30",
  },
  infoText: { fontSize: 12, color: colors.warning, flex: 1 },
  totalsCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5 },
  totalLabel: { fontSize: 14, color: colors.textSecondary },
  totalValue: { fontSize: 14, color: colors.textPrimary, fontWeight: "500" },
  totalDivider: { height: 1, backgroundColor: colors.border, marginVertical: 8 },
  totalLabelBold: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  totalValueBold: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  lineItemsCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  lineItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  lineItemBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  lineItemLeft: { flex: 1, paddingRight: 12 },
  lineItemName: { fontSize: 13, fontWeight: "600", color: colors.textPrimary },
  lineItemMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  lineItemAmount: { fontSize: 13, fontWeight: "700", color: colors.textPrimary },
  notesCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  notesText: { fontSize: 13, color: colors.textSecondary, lineHeight: 20 },
  actionsCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  actionBtnText: { fontSize: 14, fontWeight: "600", color: colors.brand, flex: 1 },
  actionSpinner: { marginLeft: "auto" },
  actionBtnConvert: {
    backgroundColor: colors.brand,
    borderBottomWidth: 0,
    justifyContent: "center",
  },
  actionBtnConvertText: { fontSize: 14, fontWeight: "700", color: colors.textPrimary, flex: 1 },
});
