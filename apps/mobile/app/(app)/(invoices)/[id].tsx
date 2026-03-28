import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
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
import { colors } from "../../../src/lib/theme";
import { haptic } from "../../../src/lib/haptics";
import { StatusBadge, Card, QueryError, Skeleton } from "../../../src/components/ui";

// Alias for backward compatibility with inline color references
const C = colors;

type StatusKey = "draft" | "unfulfilled" | "sent" | "paid" | "partial" | "overdue" | "cancelled";

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
      return [{ label: "Mark as Sent", status: "sent", color: colors.info }];
    case "sent":
    case "unfulfilled":
      return [
        { label: "Mark as Paid", status: "paid", color: colors.success },
        { label: "Mark as Partial", status: "partial", color: colors.warning },
        { label: "Mark as Overdue", status: "overdue", color: colors.danger },
      ];
    case "partial":
      return [
        { label: "Mark as Paid", status: "paid", color: colors.success },
        { label: "Mark as Overdue", status: "overdue", color: colors.danger },
      ];
    case "overdue":
      return [{ label: "Mark as Paid", status: "paid", color: colors.success }];
    default:
      return [];
  }
}

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const businessId = useBusinessStore((s) => s.businessId);
  const [sharingPDF, setSharingPDF] = useState(false);

  const { data: invoice, isLoading, refetch, isRefetching } = trpc.invoice.getById.useQuery(
    { id: id ?? "" },
    { enabled: !!id }
  );

  const updateStatus = trpc.invoice.updateStatus.useMutation({
    onSuccess: () => refetch(),
    onError: (err) => Alert.alert("Error", err.message),
  });

  const utils = trpc.useUtils();

  const deleteInvoice = trpc.invoice.delete.useMutation({
    onSuccess: () => {
      utils.invoice.list.invalidate();
      router.back();
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const handleStatusChange = (status: StatusKey) => {
    if (!invoice) return;
    haptic.medium();
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
          onPress: () => {
            haptic.error();
            deleteInvoice.mutate({ id: invoice.id });
          },
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
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <View style={styles.scrollContent}>
          <Skeleton width="60%" height={20} borderRadius={8} style={{ marginBottom: 12 }} />
          <Skeleton width="100%" height={80} borderRadius={16} style={{ marginBottom: 12 }} />
          <Skeleton width="100%" height={80} borderRadius={16} style={{ marginBottom: 12 }} />
          <Skeleton width="100%" height={120} borderRadius={16} />
        </View>
      </SafeAreaView>
    );
  }

  if (!invoice) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <QueryError message="Invoice not found" onRetry={() => refetch()} />
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
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
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
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
      >
        {/* Party Info Card */}
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <View style={styles.cardIconWrap}>
              <Ionicons name="person-outline" size={18} color={colors.brand} />
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
              <Text style={[styles.totalValue, { color: colors.success }]}>
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
                <Text style={[styles.totalValue, { color: colors.success }]}>
                  {formatCurrency(amountPaid)}
                </Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Balance</Text>
                <Text style={[styles.totalValue, { color: balance > 0 ? colors.warning : colors.success }]}>
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

        {/* Edit Invoice (only for draft/sent) */}
        {(invoice.status === "draft" || invoice.status === "sent") && (
          <View style={styles.actionGroup}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => router.push({ pathname: "/(app)/(invoices)/edit", params: { id: invoice.id } } as never)}
              activeOpacity={0.7}
            >
              <Ionicons
                name="create-outline"
                size={18}
                color={colors.brand}
                style={styles.actionIcon}
              />
              <Text style={[styles.actionBtnText, { color: colors.brand }]}>Edit Invoice</Text>
            </TouchableOpacity>
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
              <ActivityIndicator size="small" color={colors.brand} style={styles.actionIcon} />
            ) : (
              <Ionicons
                name="share-outline"
                size={18}
                color={colors.brand}
                style={styles.actionIcon}
              />
            )}
            <Text style={[styles.actionBtnText, { color: colors.brand }]}>
              {sharingPDF ? "Generating PDF..." : "Share PDF (A4)"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => handleSharePDF("thermal")}
            activeOpacity={0.7}
            disabled={sharingPDF}
          >
            <Ionicons name="print-outline" size={18} color={colors.brand} style={styles.actionIcon} />
            <Text style={[styles.actionBtnText, { color: colors.brand }]}>Share PDF (Thermal)</Text>
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
              <ActivityIndicator size="small" color={colors.danger} style={styles.actionIcon} />
            ) : (
              <Ionicons
                name="trash-outline"
                size={18}
                color={colors.danger}
                style={styles.actionIcon}
              />
            )}
            <Text style={[styles.actionBtnText, { color: colors.danger }]}>Delete Invoice</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  topBarCenter: {
    flex: 1,
  },
  topBarTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.textPrimary,
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
    color: colors.textMuted,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
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
    backgroundColor: colors.brand + "20",
    alignItems: "center",
    justifyContent: "center",
  },
  cardInfo: {
    flex: 1,
    gap: 2,
  },
  cardLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: "500",
  },
  cardValue: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  cardSubValue: {
    fontSize: 13,
    color: colors.textSecondary,
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
    backgroundColor: colors.border,
    marginHorizontal: 16,
  },
  dateLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: "500",
  },
  dateValue: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
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
    backgroundColor: colors.border,
    marginBottom: 8,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 10,
  },
  rowDivider: {
    height: 1,
    backgroundColor: colors.border + "60",
  },
  tableCell: {
    fontSize: 12,
    color: colors.textSecondary,
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
    color: colors.textPrimary,
  },
  lineTax: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
  },
  lineNum: {
    fontSize: 13,
    color: colors.textPrimary,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 5,
  },
  totalLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  totalValue: {
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: "500",
  },
  totalDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 8,
  },
  totalLabelBold: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  totalValueBold: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  notesText: {
    fontSize: 14,
    color: colors.textSecondary,
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
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  dangerBtn: {
    borderColor: colors.danger + "40",
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
