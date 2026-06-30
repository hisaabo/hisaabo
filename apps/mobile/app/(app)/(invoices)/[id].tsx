import { useState, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Modal,
  TextInput,
  Linking,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { trpc } from "../../../src/lib/trpc";
import { useBusinessStore } from "../../../src/stores/business";
import { getTokenSync } from "../../../src/lib/auth";
import { getApiUrl } from "../../../src/lib/api-url";
import { formatCurrency, formatDate } from "../../../src/lib/utils";
import { makeStyles } from "../../../src/lib/makeStyles";
import { useColors } from "../../../src/contexts/ThemeContext";
import { haptic } from "../../../src/lib/haptics";
import { StatusBadge, QueryError, Skeleton } from "../../../src/components/ui";

type StatusKey = "draft" | "unfulfilled" | "sent" | "paid" | "partial" | "overdue" | "cancelled" | "adjusted";

async function sharePDF(
  invoiceId: string,
  invoiceNumber: string,
  businessId: string | null,
  format: "a4" | "a5" | "thermal" = "a5"
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

function getNextStatuses(current: string, colors: { info: string }): NextStatus[] {
  switch (current) {
    case "draft":
      return [{ label: "Mark as Sent", status: "sent", color: colors.info }];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Shipment helpers
// ---------------------------------------------------------------------------

type ShipmentStatus = "pending" | "shipped" | "in_transit" | "delivered" | "returned";
type ShipmentMode = "hand_delivery" | "courier" | "transport" | "post" | string;

function useShipmentStatusConfig(): Record<ShipmentStatus, { label: string; color: string; bg: string; icon: React.ComponentProps<typeof Ionicons>["name"] }> {
  const colors = useColors();
  return useMemo(() => ({
    pending:    { label: "Pending",     color: colors.warning,  bg: colors.warningBg,  icon: "time-outline" },
    shipped:    { label: "Shipped",     color: colors.info,     bg: colors.infoBg,     icon: "cube-outline" },
    in_transit: { label: "In Transit",  color: colors.brand,    bg: colors.brandLight, icon: "navigate-outline" },
    delivered:  { label: "Delivered",   color: colors.success,  bg: colors.successBg,  icon: "checkmark-circle-outline" },
    returned:   { label: "Returned",    color: colors.danger,   bg: colors.dangerBg,   icon: "return-down-back-outline" },
  }), [colors]);
}

const MODE_LABELS: Record<string, string> = {
  hand_delivery: "Self/Driver",
  courier:       "Courier",
  transport:     "Transport",
  post:          "Post",
};

function getModeLabel(mode: ShipmentMode | null | undefined): string {
  if (!mode) return "—";
  return MODE_LABELS[mode] ?? mode;
}

const SHIPMENT_MODES: { value: string; label: string }[] = [
  { value: "hand_delivery", label: "Self/Driver" },
  { value: "courier",       label: "Courier" },
  { value: "transport",     label: "Transport" },
  { value: "post",          label: "Post" },
];

// ---------------------------------------------------------------------------
// AddTracking bottom-sheet modal
// ---------------------------------------------------------------------------

interface AddTrackingSheetProps {
  visible: boolean;
  shipmentId: string;
  initialCarrier?: string | null;
  initialTrackingNumber?: string | null;
  initialMode?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

function AddTrackingSheet({
  visible,
  shipmentId,
  initialCarrier,
  initialTrackingNumber,
  initialMode,
  onClose,
  onSaved,
}: AddTrackingSheetProps) {
  const sheetStyles = useSheetStyles();
  const colors = useColors();
  const [carrier, setCarrier] = useState(initialCarrier ?? "");
  const [trackingNumber, setTrackingNumber] = useState(initialTrackingNumber ?? "");
  const [mode, setMode] = useState(initialMode ?? "courier");

  const updateShipment = trpc.shipment.update.useMutation({
    onSuccess: () => {
      haptic.success();
      onSaved();
      onClose();
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const handleSave = () => {
    updateShipment.mutate({
      id: shipmentId,
      carrier: carrier.trim() || undefined,
      trackingNumber: trackingNumber.trim() || undefined,
      mode,
    });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={sheetStyles.overlay} onPress={onClose} />
      <View style={sheetStyles.sheet}>
        {/* Handle */}
        <View style={sheetStyles.handle} />

        <Text style={sheetStyles.title}>Add Tracking Info</Text>

        {/* Mode picker */}
        <Text style={sheetStyles.label}>Mode</Text>
        <View style={sheetStyles.modeRow}>
          {SHIPMENT_MODES.map((m) => (
            <TouchableOpacity
              key={m.value}
              style={[sheetStyles.modeChip, mode === m.value && sheetStyles.modeChipActive]}
              onPress={() => setMode(m.value)}
              activeOpacity={0.7}
            >
              <Text style={[sheetStyles.modeChipText, mode === m.value && sheetStyles.modeChipTextActive]}>
                {m.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Carrier input */}
        <Text style={sheetStyles.label}>Carrier</Text>
        <TextInput
          style={sheetStyles.input}
          value={carrier}
          onChangeText={setCarrier}
          placeholder="e.g. Delhivery, BlueDart"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="words"
          returnKeyType="next"
        />

        {/* Tracking number input */}
        <Text style={sheetStyles.label}>Tracking Number</Text>
        <TextInput
          style={sheetStyles.input}
          value={trackingNumber}
          onChangeText={setTrackingNumber}
          placeholder="e.g. 1234567890"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          returnKeyType="done"
          onSubmitEditing={handleSave}
        />

        <TouchableOpacity
          style={[sheetStyles.saveBtn, updateShipment.isPending && { opacity: 0.6 }]}
          onPress={handleSave}
          activeOpacity={0.8}
          disabled={updateShipment.isPending}
        >
          {updateShipment.isPending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={sheetStyles.saveBtnText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// ShipmentSection component
// ---------------------------------------------------------------------------

interface ShipmentSectionProps {
  invoiceId: string;
  invoiceStatus: string;
}

function ShipmentSection({ invoiceId, invoiceStatus }: ShipmentSectionProps) {
  const styles = useStyles();
  const shipmentStyles = useShipmentStyles();
  const colors = useColors();
  const SHIPMENT_STATUS_CONFIG = useShipmentStatusConfig();
  const [trackingSheetOpen, setTrackingSheetOpen] = useState(false);
  const utils = trpc.useUtils();

  const { data, isLoading, refetch } = trpc.shipment.list.useQuery(
    { invoiceId, limit: 1 },
    { enabled: !!invoiceId }
  );

  const updateShipment = trpc.shipment.update.useMutation({
    onSuccess: () => {
      haptic.success();
      refetch();
      // Refresh invoice data so totals reflect synced shipping charges
      utils.invoice.getById.invalidate({ id: invoiceId });
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  // Paid invoices: backend blocks mutations, UI hides action buttons
  const isPaid = invoiceStatus === "paid";

  const shipment = data?.data?.[0] ?? null;

  if (isLoading) {
    return (
      <>
        <Text style={styles.sectionTitle}>Shipment</Text>
        <Skeleton width="100%" height={80} borderRadius={16} style={{ marginBottom: 12 }} />
      </>
    );
  }

  if (!shipment) return null;

  const statusCfg = SHIPMENT_STATUS_CONFIG[shipment.status as ShipmentStatus] ?? SHIPMENT_STATUS_CONFIG.pending;
  const cost = parseFloat(shipment.cost ?? "0");
  const hasTracking = !!shipment.trackingNumber;
  const trackingUrl = shipment.trackingUrl ?? null;

  const handleMarkShipped = () => {
    haptic.medium();
    Alert.alert("Mark Shipped", "Set shipment status to Shipped?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Confirm",
        onPress: () =>
          updateShipment.mutate({
            id: shipment.id,
            status: "shipped",
            shipmentDate: new Date().toISOString(),
          }),
      },
    ]);
  };

  const handleMarkDelivered = () => {
    haptic.medium();
    Alert.alert("Mark Delivered", "Set shipment status to Delivered?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Confirm",
        onPress: () =>
          updateShipment.mutate({ id: shipment.id, status: "delivered" }),
      },
    ]);
  };

  const handleOpenTracking = () => {
    if (trackingUrl) {
      Linking.openURL(trackingUrl).catch(() =>
        Alert.alert("Error", "Could not open tracking URL.")
      );
    }
  };

  return (
    <>
      <Text style={styles.sectionTitle}>Shipment</Text>
      <View style={styles.card}>
        {/* Status row */}
        <View style={shipmentStyles.headerRow}>
          <View style={[shipmentStyles.statusBadge, { backgroundColor: statusCfg.bg }]}>
            <Ionicons name={statusCfg.icon} size={13} color={statusCfg.color} style={{ marginRight: 4 }} />
            <Text style={[shipmentStyles.statusText, { color: statusCfg.color }]}>
              {statusCfg.label}
            </Text>
          </View>
          <Text style={shipmentStyles.modeText}>{getModeLabel(shipment.mode)}</Text>
        </View>

        <View style={styles.totalDivider} />

        {/* Carrier + Tracking */}
        {shipment.carrier ? (
          <View style={shipmentStyles.detailRow}>
            <Ionicons name="business-outline" size={14} color={colors.textMuted} style={shipmentStyles.detailIcon} />
            <Text style={shipmentStyles.detailLabel}>Carrier</Text>
            <Text style={shipmentStyles.detailValue}>{shipment.carrier}</Text>
          </View>
        ) : null}

        {hasTracking ? (
          <TouchableOpacity
            style={shipmentStyles.detailRow}
            onPress={trackingUrl ? handleOpenTracking : undefined}
            activeOpacity={trackingUrl ? 0.7 : 1}
          >
            <Ionicons name="barcode-outline" size={14} color={colors.textMuted} style={shipmentStyles.detailIcon} />
            <Text style={shipmentStyles.detailLabel}>Tracking</Text>
            <Text style={[shipmentStyles.detailValue, trackingUrl && { color: colors.brand }]}>
              {shipment.trackingNumber}
              {trackingUrl ? (
                <Ionicons name="open-outline" size={12} color={colors.brand} />
              ) : null}
            </Text>
          </TouchableOpacity>
        ) : null}

        {/* Cost */}
        {cost > 0 ? (
          <View style={shipmentStyles.detailRow}>
            <Ionicons name="pricetag-outline" size={14} color={colors.textMuted} style={shipmentStyles.detailIcon} />
            <Text style={shipmentStyles.detailLabel}>Shipping Cost</Text>
            <Text style={shipmentStyles.detailValue}>{formatCurrency(shipment.cost ?? "0")}</Text>
          </View>
        ) : null}

        {/* Dates */}
        {shipment.shipmentDate ? (
          <View style={shipmentStyles.detailRow}>
            <Ionicons name="calendar-outline" size={14} color={colors.textMuted} style={shipmentStyles.detailIcon} />
            <Text style={shipmentStyles.detailLabel}>Shipped On</Text>
            <Text style={shipmentStyles.detailValue}>{formatDate(shipment.shipmentDate)}</Text>
          </View>
        ) : null}

        {shipment.estimatedDelivery ? (
          <View style={shipmentStyles.detailRow}>
            <Ionicons name="time-outline" size={14} color={colors.textMuted} style={shipmentStyles.detailIcon} />
            <Text style={shipmentStyles.detailLabel}>Est. Delivery</Text>
            <Text style={shipmentStyles.detailValue}>{formatDate(shipment.estimatedDelivery)}</Text>
          </View>
        ) : null}

        {shipment.actualDelivery ? (
          <View style={shipmentStyles.detailRow}>
            <Ionicons name="checkmark-done-outline" size={14} color={colors.success} style={shipmentStyles.detailIcon} />
            <Text style={shipmentStyles.detailLabel}>Delivered On</Text>
            <Text style={[shipmentStyles.detailValue, { color: colors.success }]}>
              {formatDate(shipment.actualDelivery)}
            </Text>
          </View>
        ) : null}

        {/* Action buttons — hidden when invoice is paid */}
        {!isPaid && (shipment.status === "pending" ||
          shipment.status === "shipped" ||
          shipment.status === "in_transit") ? (
          <View style={shipmentStyles.actionRow}>
            {shipment.status === "pending" && (
              <TouchableOpacity
                style={[shipmentStyles.actionChip, { borderColor: colors.info + "60" }]}
                onPress={handleMarkShipped}
                activeOpacity={0.7}
                disabled={updateShipment.isPending}
              >
                <Ionicons name="cube-outline" size={14} color={colors.info} style={{ marginRight: 6 }} />
                <Text style={[shipmentStyles.actionChipText, { color: colors.info }]}>Mark Shipped</Text>
              </TouchableOpacity>
            )}

            {(shipment.status === "shipped" || shipment.status === "in_transit") && (
              <TouchableOpacity
                style={[shipmentStyles.actionChip, { borderColor: colors.success + "60" }]}
                onPress={handleMarkDelivered}
                activeOpacity={0.7}
                disabled={updateShipment.isPending}
              >
                <Ionicons name="checkmark-circle-outline" size={14} color={colors.success} style={{ marginRight: 6 }} />
                <Text style={[shipmentStyles.actionChipText, { color: colors.success }]}>Mark Delivered</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[shipmentStyles.actionChip, { borderColor: colors.brand + "60" }]}
              onPress={() => setTrackingSheetOpen(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="create-outline" size={14} color={colors.brand} style={{ marginRight: 6 }} />
              <Text style={[shipmentStyles.actionChipText, { color: colors.brand }]}>Add Tracking</Text>
            </TouchableOpacity>
          </View>
        ) : (
          // For delivered/returned, still allow editing tracking
          !hasTracking && (
            <View style={shipmentStyles.actionRow}>
              <TouchableOpacity
                style={[shipmentStyles.actionChip, { borderColor: colors.brand + "60" }]}
                onPress={() => setTrackingSheetOpen(true)}
                activeOpacity={0.7}
              >
                <Ionicons name="create-outline" size={14} color={colors.brand} style={{ marginRight: 6 }} />
                <Text style={[shipmentStyles.actionChipText, { color: colors.brand }]}>Add Tracking</Text>
              </TouchableOpacity>
            </View>
          )
        )}
      </View>

      {trackingSheetOpen && (
        <AddTrackingSheet
          visible={trackingSheetOpen}
          shipmentId={shipment.id}
          initialCarrier={shipment.carrier}
          initialTrackingNumber={shipment.trackingNumber}
          initialMode={shipment.mode}
          onClose={() => setTrackingSheetOpen(false)}
          onSaved={() => refetch()}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function InvoiceDetailScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const businessId = useBusinessStore((s) => s.businessId);
  const [sharingPDF, setSharingPDF] = useState(false);

  const { data: invoice, isLoading, refetch, isRefetching } = trpc.invoice.getById.useQuery(
    { id: id ?? "" },
    { enabled: !!id }
  );

  const utils = trpc.useUtils();

  const updateStatus = trpc.invoice.updateStatus.useMutation({
    onSuccess: () => {
      refetch();
      utils.invoice.list.invalidate();
      utils.dashboard.summary.invalidate();
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const deleteInvoice = trpc.invoice.delete.useMutation({
    onSuccess: () => {
      utils.invoice.list.invalidate();
      utils.dashboard.summary.invalidate();
      utils.party.list.invalidate();
      utils.item.list.invalidate();
      router.back();
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const handleIssueCreditNote = () => {
    if (!invoice) return;
    haptic.light();
    router.push({
      pathname: "/(app)/(more)/credit-notes/create",
      params: { prefillFromInvoiceId: invoice.id },
    } as never);
  };

  const handleCreateSalesReturn = () => {
    if (!invoice) return;
    haptic.light();
    router.push({
      pathname: "/(app)/(more)/sales-returns/create",
      params: { prefillFromInvoiceId: invoice.id },
    } as never);
  };

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

  const handleSharePDF = async (format: "a4" | "a5" | "thermal") => {
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
        <Stack.Screen options={{ headerShown: false }} />
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
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <QueryError message="Invoice not found" onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  const nextStatuses = getNextStatuses(invoice.status, colors);
  const subtotal = invoice.lineItems.reduce(
    (sum, li) => sum + parseFloat(li.totalAmount ?? "0"),
    0
  );
  const taxTotal = invoice.lineItems.reduce(
    (sum, li) => sum + parseFloat(li.taxAmount ?? "0"),
    0
  );
  const isGST = taxTotal > 0;
  const defaultFormat = isGST ? "a4" : "a5";
  const amountPaid = parseFloat(invoice.amountPaid ?? "0");
  const totalAdjusted = parseFloat((invoice as { totalAdjusted?: string }).totalAdjusted ?? "0");
  const total = parseFloat(invoice.totalAmount ?? "0");
  const balance = total - amountPaid - totalAdjusted;
  const isAdjusted = invoice.status === "adjusted";

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
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
                  {/* Bug B: itemName is the primary display, description is
                      the optional italic notes line underneath. */}
                  <Text style={styles.lineDesc} numberOfLines={2}>
                    {li.itemName}
                  </Text>
                  {li.description && li.description.trim().length > 0 && (
                    <Text style={styles.lineNotes} numberOfLines={3}>
                      {li.description}
                    </Text>
                  )}
                  {parseFloat(li.taxPercent ?? "0") > 0 && (
                    <Text style={styles.lineTax}>GST {li.taxPercent}%</Text>
                  )}
                </View>
                <Text style={[styles.tableCell, styles.tableNumCol, styles.textRight, styles.lineNum]}>
                  {li.quantity}{(li.selectedUnit || li.itemUnit) ? ` ${(li.selectedUnit || li.itemUnit)?.toUpperCase()}` : ""}
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
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Paid</Text>
              <Text style={[styles.totalValue, { color: colors.success }]}>
                {formatCurrency(amountPaid)}
              </Text>
            </View>
          )}
          {totalAdjusted > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Adjusted (CN/SR)</Text>
              <Text style={[styles.totalValue, { color: "#a78bfa" }]}>
                -{formatCurrency(totalAdjusted)}
              </Text>
            </View>
          )}
          {(amountPaid > 0 || totalAdjusted > 0) && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Balance Due</Text>
              <Text style={[styles.totalValue, { color: balance > 0 ? colors.warning : colors.success }]}>
                {formatCurrency(Math.max(0, balance))}
              </Text>
            </View>
          )}
          {isAdjusted && amountPaid <= 0 && (
            <View style={styles.totalRow}>
              <Text style={[styles.totalLabel, { color: "#a78bfa" }]}>
                Settled via credit note / sales return
              </Text>
            </View>
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

        {/* Shipment tracking — sale invoices only, hidden for adjusted */}
        {invoice.type === "sale" && !isAdjusted && <ShipmentSection invoiceId={invoice.id} invoiceStatus={invoice.status} />}

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

        {/* Record Payment (for unpaid invoices; hidden when adjusted or balance fully covered).
            Drafts are intentionally allowed: receiving a payment auto-promotes the invoice
            to partial/paid status (see payment.create in packages/api), so the user no
            longer needs to "Mark as Sent" first. */}
        {balance > 0 && invoice.status !== "cancelled" && invoice.status !== "adjusted" && (
          <View style={styles.actionGroup}>
            <TouchableOpacity
              style={[styles.actionBtn, { borderColor: colors.success + "60" }]}
              onPress={() => router.push({
                pathname: "/(payments)/create",
                params: { partyId: invoice.partyId, partyName: invoice.party?.name ?? "", invoiceId: invoice.id },
              })}
              activeOpacity={0.7}
            >
              <Ionicons name="card-outline" size={18} color={colors.success} style={styles.actionIcon} />
              <Text style={[styles.actionBtnText, { color: colors.success }]}>Record Payment</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Credit Note / Sales Return conversions — hidden when fully adjusted */}
        {invoice.status !== "draft" && invoice.status !== "cancelled" && invoice.status !== "adjusted" && (
          <View style={styles.actionGroup}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={handleIssueCreditNote}
              activeOpacity={0.7}
            >
              <Ionicons name="document-text-outline" size={18} color={colors.warning} style={styles.actionIcon} />
              <Text style={[styles.actionBtnText, { color: colors.warning }]}>Issue Credit Note</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={handleCreateSalesReturn}
              activeOpacity={0.7}
            >
              <Ionicons name="return-down-back-outline" size={18} color={colors.warning} style={styles.actionIcon} />
              <Text style={[styles.actionBtnText, { color: colors.warning }]}>Create Sales Return</Text>
            </TouchableOpacity>
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
            onPress={() => handleSharePDF(defaultFormat)}
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
              {sharingPDF ? "Generating PDF..." : `Share PDF (${isGST ? "A4" : "A5"})`}
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

        {/* Delete — hidden when any payment has been recorded */}
        {amountPaid <= 0 && (
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
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
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
  lineNotes: {
    fontSize: 11,
    fontStyle: "italic",
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 14,
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
}));

// Styles shared between shipment section and action chips
const useShipmentStyles = makeStyles((colors) => ({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
  },
  modeText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: "500",
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 5,
  },
  detailIcon: {
    marginRight: 8,
    width: 16,
  },
  detailLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    flex: 1,
  },
  detailValue: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: "500",
    textAlign: "right",
    flexShrink: 1,
    marginLeft: 8,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  actionChip: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
  },
  actionChipText: {
    fontSize: 13,
    fontWeight: "600",
  },
}));

// Bottom sheet styles
const useSheetStyles = makeStyles((colors) => ({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 36,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 20,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 8,
    marginTop: 16,
  },
  modeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  modeChip: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  modeChipActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandLight,
  },
  modeChipText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: "500",
  },
  modeChipTextActive: {
    color: colors.brand,
    fontWeight: "700",
  },
  input: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.textPrimary,
  },
  saveBtn: {
    backgroundColor: colors.brand,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 24,
  },
  saveBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
  },
}));
