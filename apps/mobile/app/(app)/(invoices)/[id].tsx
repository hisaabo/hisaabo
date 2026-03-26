import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { trpc } from "../../../src/lib/trpc";
import { useBusinessStore } from "../../../src/stores/business";
import { getTokenSync } from "../../../src/lib/auth";
import { getApiUrl } from "../../../src/lib/api-url";
import { formatCurrency, formatDate } from "../../../src/lib/utils";

const C = {
  bg: "#0f0f1a",
  surface: "#1a1a2e",
  border: "#2d2d44",
  brand: "#6366f1",
  textPrimary: "#ffffff",
  textSecondary: "#9ca3af",
  textMuted: "#6b7280",
  success: "#10b981",
  danger: "#ef4444",
  warning: "#f59e0b",
  info: "#3b82f6",
};

type StatusKey = "draft" | "unfulfilled" | "sent" | "paid" | "partial" | "overdue" | "cancelled";

const STATUS_COLORS: Record<StatusKey, { bg: string; text: string }> = {
  draft: { bg: "#374151", text: "#d1d5db" },
  unfulfilled: { bg: "#374151", text: "#d1d5db" },
  sent: { bg: "#1e3a5f", text: "#60a5fa" },
  paid: { bg: "#064e3b", text: "#34d399" },
  partial: { bg: "#451a03", text: "#fbbf24" },
  overdue: { bg: "#450a0a", text: "#f87171" },
  cancelled: { bg: "#374151", text: "#9ca3af" },
};

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status as StatusKey] ?? { bg: "#374151", text: "#d1d5db" };
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <Text style={[styles.badgeText, { color: colors.text }]}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Text>
    </View>
  );
}

async function sharePDF(
  invoiceId: string,
  invoiceNumber: string,
  businessId: string | null,
  format: "a4" | "thermal" = "a4"
) {
  const token = getTokenSync();
  const url = `${getApiUrl()}/api/invoices/${invoiceId}/pdf?format=${format}`;
  const safeNumber = invoiceNumber.replace(/[^a-zA-Z0-9-_]/g, "_");
  const fileUri = `${FileSystem.cacheDirectory}${safeNumber}_${format}.pdf`;

  await FileSystem.downloadAsync(url, fileUri, {
    headers: {
      Authorization: token ? `Bearer ${token}` : "",
      "x-business-id": businessId ?? "",
    },
  });

  await Sharing.shareAsync(fileUri, {
    mimeType: "application/pdf",
    dialogTitle: `Share ${invoiceNumber}`,
  });
}

type NextStatus = { label: string; status: StatusKey; color: string };

function getNextStatuses(current: string): NextStatus[] {
  switch (current) {
    case "draft":
      return [{ label: "Mark as Sent", status: "sent", color: C.info }];
    case "sent":
    case "unfulfilled":
      return [
        { label: "Mark as Paid", status: "paid", color: C.success },
        { label: "Mark as Partial", status: "partial", color: C.warning },
        { label: "Mark as Overdue", status: "overdue", color: C.danger },
      ];
    case "partial":
      return [
        { label: "Mark as Paid", status: "paid", color: C.success },
        { label: "Mark as Overdue", status: "overdue", color: C.danger },
      ];
    case "overdue":
      return [{ label: "Mark as Paid", status: "paid", color: C.success }];
    default:
      return [];
  }
}

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const businessId = useBusinessStore((s) => s.businessId);
  const [sharingPDF, setSharingPDF] = useState(false);

  const { data: invoice, isLoading, refetch } = trpc.invoice.getById.useQuery(
    { id: id ?? "" },
    { enabled: !!id }
  );

  const updateStatus = trpc.invoice.updateStatus.useMutation({
    onSuccess: () => refetch(),
    onError: (err) => Alert.alert("Error", err.message),
  });

  const deleteInvoice = trpc.invoice.delete.useMutation({
    onSuccess: () => router.back(),
    onError: (err) => Alert.alert("Error", err.message),
  });

  const handleStatusChange = (status: StatusKey) => {
    if (!invoice) return;
    Alert.alert(
      "Change Status",
      `Mark invoice as ${status}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: () => updateStatus.mutate({ id: invoice.id, status }),
        },
      ]
    );
  };

  const handleDelete = () => {
    if (!invoice) return;
    Alert.alert(
      "Delete Invoice",
      `Delete ${invoice.invoiceNumber}? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteInvoice.mutate({ id: invoice.id }),
        },
      ]
    );
  };

  const handleSharePDF = async (format: "a4" | "thermal") => {
    if (!invoice) return;
    setSharingPDF(true);
    try {
      await sharePDF(invoice.id, invoice.invoiceNumber, businessId, format);
    } catch {
      Alert.alert("Error", "Failed to generate or share PDF. Please try again.");
    } finally {
      setSharingPDF(false);
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </TouchableOpacity>
        </View>
        <View style={styles.centeredWrap}>
          <ActivityIndicator size="large" color={C.brand} />
        </View>
      </SafeAreaView>
    );
  }

  if (!invoice) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
          </TouchableOpacity>
        </View>
        <View style={styles.centeredWrap}>
          <Ionicons name="alert-circle-outline" size={48} color={C.textMuted} />
          <Text style={styles.notFoundText}>Invoice not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const nextStatuses = getNextStatuses(invoice.status);
  const subtotal = invoice.lineItems.reduce(
    (sum, li) => sum + parseFloat(li.totalAmount ?? "0"),
    0
  );
  const taxTotal = invoice.lineItems.reduce(
    (sum, li) => sum + parseFloat(li.taxAmount ?? "0"),
    0
  );
  const amountPaid = parseFloat(invoice.amountPaid ?? "0");
  const total = parseFloat(invoice.totalAmount ?? "0");
  const balance = total - amountPaid;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={C.textPrimary} />
        </TouchableOpacity>
        <View style={styles.topBarCenter}>
          <Text style={styles.topBarTitle}>{invoice.invoiceNumber}</Text>
        </View>
        <StatusBadge status={invoice.status} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Party Info Card */}
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <View style={styles.cardIconWrap}>
              <Ionicons name="person-outline" size={18} color={C.brand} />
            </View>
            <View style={styles.cardInfo}>
              <Text style={styles.cardLabel}>
                {invoice.type === "sale" ? "Customer" : "Supplier"}
              </Text>
              <Text style={styles.cardValue}>{invoice.party?.name ?? "—"}</Text>
              {invoice.party?.phone ? (
                <Text style={styles.cardSubValue}>{invoice.party.phone}</Text>
              ) : null}
            </View>
          </View>
        </View>

        {/* Dates Card */}
        <View style={styles.card}>
          <View style={styles.datesRow}>
            <View style={styles.dateItem}>
              <Text style={styles.dateLabel}>Invoice Date</Text>
              <Text style={styles.dateValue}>
                {invoice.invoiceDate ? formatDate(invoice.invoiceDate) : "—"}
              </Text>
            </View>
            <View style={styles.dateDivider} />
            <View style={styles.dateItem}>
              <Text style={styles.dateLabel}>Due Date</Text>
              <Text style={styles.dateValue}>
                {invoice.dueDate ? formatDate(invoice.dueDate) : "—"}
              </Text>
            </View>
          </View>
        </View>

        {/* Line Items */}
        <Text style={styles.sectionTitle}>Items</Text>
        <View style={styles.card}>
          {/* Table Header */}
          <View style={styles.tableHeader}>
            <Text style={[styles.tableCell, styles.tableDescCol]}>Description</Text>
            <Text style={[styles.tableCell, styles.tableNumCol, styles.textRight]}>Qty</Text>
            <Text style={[styles.tableCell, styles.tableNumCol, styles.textRight]}>Rate</Text>
            <Text style={[styles.tableCell, styles.tableNumCol, styles.textRight]}>Amount</Text>
          </View>
          <View style={styles.tableDivider} />
          {invoice.lineItems.map((li, idx) => (
            <View key={idx}>
              <View style={styles.tableRow}>
                <View style={styles.tableDescCol}>
                  <Text style={styles.lineDesc} numberOfLines={2}>
                    {li.description}
                  </Text>
                  {parseFloat(li.taxPercent ?? "0") > 0 && (
                    <Text style={styles.lineTax}>GST {li.taxPercent}%</Text>
                  )}
                </View>
                <Text style={[styles.tableCell, styles.tableNumCol, styles.textRight, styles.lineNum]}>
                  {li.quantity}
                </Text>
                <Text style={[styles.tableCell, styles.tableNumCol, styles.textRight, styles.lineNum]}>
                  {formatCurrency(li.unitPrice ?? "0")}
                </Text>
                <Text style={[styles.tableCell, styles.tableNumCol, styles.textRight, styles.lineNum]}>
                  {formatCurrency(li.totalAmount ?? "0")}
                </Text>
              </View>
              {idx < invoice.lineItems.length - 1 && (
                <View style={styles.rowDivider} />
              )}
            </View>
          ))}
        </View>

        {/* Totals */}
        <Text style={styles.sectionTitle}>Summary</Text>
        <View style={styles.card}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{formatCurrency(subtotal)}</Text>
          </View>
          {taxTotal > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Tax</Text>
              <Text style={styles.totalValue}>{formatCurrency(taxTotal)}</Text>
            </View>
          )}
          {parseFloat(invoice.discountAmount ?? "0") > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Discount</Text>
              <Text style={[styles.totalValue, { color: C.success }]}>
                -{formatCurrency(invoice.discountAmount ?? "0")}
              </Text>
            </View>
          )}
          <View style={styles.totalDivider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabelBold}>Total</Text>
            <Text style={styles.totalValueBold}>{formatCurrency(total)}</Text>
          </View>
          {amountPaid > 0 && (
            <>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Paid</Text>
                <Text style={[styles.totalValue, { color: C.success }]}>
                  {formatCurrency(amountPaid)}
                </Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Balance</Text>
                <Text style={[styles.totalValue, { color: balance > 0 ? C.warning : C.success }]}>
                  {formatCurrency(balance)}
                </Text>
              </View>
            </>
          )}
        </View>

        {/* Notes */}
        {invoice.notes ? (
          <>
            <Text style={styles.sectionTitle}>Notes</Text>
            <View style={styles.card}>
              <Text style={styles.notesText}>{invoice.notes}</Text>
            </View>
          </>
        ) : null}

        {/* Actions */}
        <Text style={styles.sectionTitle}>Actions</Text>

        {/* Status change buttons */}
        {nextStatuses.length > 0 && (
          <View style={styles.actionGroup}>
            {nextStatuses.map((ns) => (
              <TouchableOpacity
                key={ns.status}
                style={[styles.actionBtn, { borderColor: ns.color + "60" }]}
                onPress={() => handleStatusChange(ns.status)}
                activeOpacity={0.7}
                disabled={updateStatus.isPending}
              >
                <Ionicons
                  name="checkmark-circle-outline"
                  size={18}
                  color={ns.color}
                  style={styles.actionIcon}
                />
                <Text style={[styles.actionBtnText, { color: ns.color }]}>{ns.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* PDF Share */}
        <View style={styles.actionGroup}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => handleSharePDF("a4")}
            activeOpacity={0.7}
            disabled={sharingPDF}
          >
            {sharingPDF ? (
              <ActivityIndicator size="small" color={C.brand} style={styles.actionIcon} />
            ) : (
              <Ionicons
                name="share-outline"
                size={18}
                color={C.brand}
                style={styles.actionIcon}
              />
            )}
            <Text style={[styles.actionBtnText, { color: C.brand }]}>
              {sharingPDF ? "Generating PDF..." : "Share PDF (A4)"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => handleSharePDF("thermal")}
            activeOpacity={0.7}
            disabled={sharingPDF}
          >
            <Ionicons name="print-outline" size={18} color={C.brand} style={styles.actionIcon} />
            <Text style={[styles.actionBtnText, { color: C.brand }]}>Share PDF (Thermal)</Text>
          </TouchableOpacity>
        </View>

        {/* Delete */}
        <View style={[styles.actionGroup, styles.dangerGroup]}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.dangerBtn]}
            onPress={handleDelete}
            activeOpacity={0.7}
            disabled={deleteInvoice.isPending}
          >
            {deleteInvoice.isPending ? (
              <ActivityIndicator size="small" color={C.danger} style={styles.actionIcon} />
            ) : (
              <Ionicons
                name="trash-outline"
                size={18}
                color={C.danger}
                style={styles.actionIcon}
              />
            )}
            <Text style={[styles.actionBtnText, { color: C.danger }]}>Delete Invoice</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  topBarCenter: {
    flex: 1,
  },
  topBarTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: C.textPrimary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  centeredWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  notFoundText: {
    fontSize: 16,
    color: C.textMuted,
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 12,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  cardIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.brand + "20",
    alignItems: "center",
    justifyContent: "center",
  },
  cardInfo: {
    flex: 1,
    gap: 2,
  },
  cardLabel: {
    fontSize: 11,
    color: C.textMuted,
    fontWeight: "500",
  },
  cardValue: {
    fontSize: 16,
    fontWeight: "700",
    color: C.textPrimary,
  },
  cardSubValue: {
    fontSize: 13,
    color: C.textSecondary,
  },
  datesRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  dateItem: {
    flex: 1,
    gap: 4,
  },
  dateDivider: {
    width: 1,
    height: 40,
    backgroundColor: C.border,
    marginHorizontal: 16,
  },
  dateLabel: {
    fontSize: 11,
    color: C.textMuted,
    fontWeight: "500",
  },
  dateValue: {
    fontSize: 14,
    fontWeight: "600",
    color: C.textPrimary,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: C.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },
  tableHeader: {
    flexDirection: "row",
    paddingBottom: 8,
  },
  tableDivider: {
    height: 1,
    backgroundColor: C.border,
    marginBottom: 8,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 10,
  },
  rowDivider: {
    height: 1,
    backgroundColor: C.border + "60",
  },
  tableCell: {
    fontSize: 12,
    color: C.textSecondary,
  },
  tableDescCol: {
    flex: 2,
    paddingRight: 8,
  },
  tableNumCol: {
    flex: 1,
  },
  textRight: {
    textAlign: "right",
  },
  lineDesc: {
    fontSize: 13,
    fontWeight: "600",
    color: C.textPrimary,
  },
  lineTax: {
    fontSize: 10,
    color: C.textMuted,
    marginTop: 2,
  },
  lineNum: {
    fontSize: 13,
    color: C.textPrimary,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 5,
  },
  totalLabel: {
    fontSize: 14,
    color: C.textSecondary,
  },
  totalValue: {
    fontSize: 14,
    color: C.textPrimary,
    fontWeight: "500",
  },
  totalDivider: {
    height: 1,
    backgroundColor: C.border,
    marginVertical: 8,
  },
  totalLabelBold: {
    fontSize: 16,
    fontWeight: "700",
    color: C.textPrimary,
  },
  totalValueBold: {
    fontSize: 18,
    fontWeight: "700",
    color: C.textPrimary,
  },
  notesText: {
    fontSize: 14,
    color: C.textSecondary,
    lineHeight: 20,
  },
  actionGroup: {
    gap: 8,
    marginBottom: 12,
  },
  dangerGroup: {
    marginTop: 4,
    marginBottom: 0,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  dangerBtn: {
    borderColor: C.danger + "40",
  },
  actionIcon: {
    marginRight: 10,
  },
  actionBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  badge: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
});
