import { useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";
import { formatDate, formatCurrency } from "../../../../src/lib/utils";
import { makeStyles } from "../../../../src/lib/makeStyles";
import { useColors } from "../../../../src/contexts/ThemeContext";
import { fonts } from "../../../../src/lib/theme";
import { QueryError } from "../../../../src/components/ui";

/* ── Constants ──────────────────────────────────────────────────── */

function useStatusColors(): Record<string, string> {
  const colors = useColors();
  return useMemo(() => ({
    pending: colors.warning,
    shipped: colors.info,
    in_transit: colors.brand,
    delivered: colors.success,
    returned: colors.danger,
  }), [colors]);
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  shipped: "Shipped",
  in_transit: "In Transit",
  delivered: "Delivered",
  returned: "Returned",
};

// Valid transitions per status
const STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ["shipped"],
  shipped: ["in_transit", "delivered"],
  in_transit: ["delivered"],
  delivered: [],
  returned: [],
};

const TRANSITION_LABELS: Record<string, string> = {
  shipped: "Mark as Shipped",
  in_transit: "Mark In Transit",
  delivered: "Mark Delivered",
};

/* ── Status badge ────────────────────────────────────────────────── */

function StatusBadge({ status }: { status: string }) {
  const badge = useBadge();
  const colors = useColors();
  const STATUS_COLORS = useStatusColors();
  const color = STATUS_COLORS[status] ?? colors.textMuted;
  const label = STATUS_LABELS[status] ?? status;
  return (
    <View style={[badge.wrap, { backgroundColor: color + "20", borderColor: color + "40" }]}>
      <View style={[badge.dot, { backgroundColor: color }]} />
      <Text style={[badge.text, { color }]}>{label}</Text>
    </View>
  );
}

const useBadge = makeStyles((_colors) => ({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  text: {
    fontSize: 13,
    fontWeight: "700",
  },
}));

/* ── Info row ────────────────────────────────────────────────────── */

function InfoRow({
  icon,
  label,
  value,
  onPress,
  mono,
}: {
  icon: string;
  label: string;
  value: string;
  onPress?: () => void;
  mono?: boolean;
}) {
  const infoRow = useInfoRow();
  const colors = useColors();
  return (
    <View style={infoRow.row}>
      <View style={infoRow.iconWrap}>
        <Ionicons name={icon as any} size={15} color={colors.brand} />
      </View>
      <View style={infoRow.body}>
        <Text style={infoRow.label}>{label}</Text>
        <TouchableOpacity
          onPress={onPress}
          disabled={!onPress}
          activeOpacity={onPress ? 0.6 : 1}
        >
          <Text
            style={[
              infoRow.value,
              mono && { fontFamily: fonts.mono },
              onPress && { color: colors.brand, textDecorationLine: "underline" },
            ]}
          >
            {value}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const useInfoRow = makeStyles((colors) => ({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 10,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  body: { flex: 1 },
  label: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  value: {
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: "500",
  },
}));

/* ── Section card ────────────────────────────────────────────────── */

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  const card = useCard();
  return (
    <View style={card.wrap}>
      <Text style={card.title}>{title}</Text>
      <View style={card.body}>{children}</View>
    </View>
  );
}

const useCard = makeStyles((colors) => ({
  wrap: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
    overflow: "hidden",
  },
  title: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
  },
  body: {
    paddingHorizontal: 16,
    paddingBottom: 6,
    // rows handle their own vertical padding
  },
}));

/* ── Divider ─────────────────────────────────────────────────────── */

function Divider() {
  const colors = useColors();
  return <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 2 }} />;
}

/* ── Main screen ─────────────────────────────────────────────────── */

export default function ShipmentDetailScreen() {
  const styles = useStyles();
  const colors = useColors();
  const STATUS_COLORS = useStatusColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const utils = trpc.useUtils();

  const { data: shipment, isLoading, isError, refetch } =
    trpc.shipment.getById.useQuery({ id: id! }, { enabled: !!id });

  const updateMutation = trpc.shipment.update.useMutation({
    onSuccess: () => {
      utils.shipment.getById.invalidate({ id: id! });
      utils.shipment.list.invalidate();
      utils.dashboard.shippingSummary.invalidate();
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to update shipment.");
    },
  });

  const deleteMutation = trpc.shipment.delete.useMutation({
    onSuccess: () => {
      utils.shipment.list.invalidate();
      utils.dashboard.shippingSummary.invalidate();
      router.back();
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to delete shipment.");
    },
  });

  const handleStatusTransition = (newStatus: string) => {
    const label = STATUS_LABELS[newStatus] ?? newStatus;
    Alert.alert(
      "Update Status",
      `Change shipment status to "${label}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Update",
          onPress: () => updateMutation.mutate({ id: id!, status: newStatus as any }),
        },
      ]
    );
  };

  const handleDelete = () => {
    Alert.alert(
      "Delete Shipment",
      "This will permanently delete the shipment. This action cannot be undone.",
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

  const handleOpenTrackingUrl = () => {
    if (shipment?.trackingUrl) {
      Linking.openURL(shipment.trackingUrl).catch(() => {
        Alert.alert("Error", "Could not open the tracking URL.");
      });
    }
  };

  /* ── Loading / error states ──────────────────────────────────── */

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.headerBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.screenTitle}>Shipment</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (isError || !shipment) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.headerBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.screenTitle}>Shipment</Text>
          <View style={{ width: 40 }} />
        </View>
        <QueryError message="Failed to load shipment" onRetry={refetch} />
      </SafeAreaView>
    );
  }

  /* ── Derived values ──────────────────────────────────────────── */

  const carrierLabel = shipment.carrier
    ? shipment.carrier.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "—";

  const modeLabel = shipment.mode
    ? shipment.mode.charAt(0).toUpperCase() + shipment.mode.slice(1)
    : "—";

  const transitions = STATUS_TRANSITIONS[shipment.status] ?? [];
  const isMutating = updateMutation.isPending || deleteMutation.isPending;

  /* ── Render ──────────────────────────────────────────────────── */

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Header */}
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Shipment</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero: status + carrier */}
        <View style={styles.heroCard}>
          <View style={styles.heroTop}>
            <View style={styles.carrierIconWrap}>
              <Ionicons name="cube-outline" size={24} color={colors.brand} />
            </View>
            <View style={styles.heroInfo}>
              <Text style={styles.heroCarrier}>{carrierLabel}</Text>
              {shipment.trackingNumber ? (
                <Text style={styles.heroTracking} numberOfLines={1}>
                  {shipment.trackingNumber}
                </Text>
              ) : null}
            </View>
            <StatusBadge status={shipment.status} />
          </View>
          {shipment.partyName || shipment.invoiceNumber ? (
            <View style={styles.heroMeta}>
              {shipment.partyName ? (
                <View style={styles.heroMetaItem}>
                  <Ionicons name="person-outline" size={13} color={colors.textMuted} />
                  <Text style={styles.heroMetaText} numberOfLines={1}>{shipment.partyName}</Text>
                </View>
              ) : null}
              {shipment.invoiceNumber ? (
                <View style={styles.heroMetaItem}>
                  <Ionicons name="document-text-outline" size={13} color={colors.textMuted} />
                  <Text style={styles.heroMetaText} numberOfLines={1}>INV #{shipment.invoiceNumber}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* Logistics info card */}
        <SectionCard title="Logistics">
          <InfoRow icon="cube-outline" label="Carrier" value={carrierLabel} />
          <Divider />
          {shipment.trackingNumber ? (
            <>
              <InfoRow
                icon="barcode-outline"
                label="Tracking Number"
                value={shipment.trackingNumber}
                mono
                onPress={shipment.trackingUrl ? handleOpenTrackingUrl : undefined}
              />
              <Divider />
            </>
          ) : null}
          {shipment.trackingUrl ? (
            <>
              <InfoRow
                icon="link-outline"
                label="Tracking URL"
                value="Open tracking link"
                onPress={handleOpenTrackingUrl}
              />
              <Divider />
            </>
          ) : null}
          <InfoRow icon="navigate-outline" label="Transport Mode" value={modeLabel} />
          {shipment.cost && parseFloat(shipment.cost) > 0 ? (
            <>
              <Divider />
              <InfoRow
                icon="cash-outline"
                label="Shipping Cost"
                value={formatCurrency(shipment.cost)}
              />
            </>
          ) : null}
          {shipment.weight ? (
            <>
              <Divider />
              <InfoRow icon="scale-outline" label="Weight" value={`${shipment.weight} kg`} />
            </>
          ) : null}
        </SectionCard>

        {/* Dates card */}
        <SectionCard title="Dates">
          {shipment.shipmentDate ? (
            <InfoRow
              icon="calendar-outline"
              label="Shipment Date"
              value={formatDate(shipment.shipmentDate)}
            />
          ) : null}
          {shipment.estimatedDelivery ? (
            <>
              <Divider />
              <InfoRow
                icon="time-outline"
                label="Estimated Delivery"
                value={formatDate(shipment.estimatedDelivery)}
              />
            </>
          ) : null}
          {shipment.actualDelivery ? (
            <>
              <Divider />
              <InfoRow
                icon="checkmark-circle-outline"
                label="Actual Delivery"
                value={formatDate(shipment.actualDelivery)}
              />
            </>
          ) : null}
          {!shipment.shipmentDate && !shipment.estimatedDelivery && !shipment.actualDelivery ? (
            <InfoRow icon="calendar-outline" label="Dates" value="No dates recorded" />
          ) : null}
        </SectionCard>

        {/* Address card — only if any address field present */}
        {(shipment.shippingAddress || shipment.shippingCity || shipment.shippingPincode) ? (
          <SectionCard title="Shipping Address">
            {shipment.shippingAddress ? (
              <InfoRow icon="location-outline" label="Address" value={shipment.shippingAddress} />
            ) : null}
            {shipment.shippingCity ? (
              <>
                {shipment.shippingAddress ? <Divider /> : null}
                <InfoRow icon="business-outline" label="City" value={shipment.shippingCity} />
              </>
            ) : null}
            {shipment.shippingPincode ? (
              <>
                {(shipment.shippingAddress || shipment.shippingCity) ? <Divider /> : null}
                <InfoRow icon="mail-outline" label="Pincode" value={shipment.shippingPincode} />
              </>
            ) : null}
          </SectionCard>
        ) : null}

        {/* Party / Invoice */}
        {(shipment.partyName || shipment.invoiceNumber) ? (
          <SectionCard title="Linked To">
            {shipment.partyName ? (
              <InfoRow icon="person-outline" label="Party" value={shipment.partyName} />
            ) : null}
            {shipment.invoiceNumber ? (
              <>
                {shipment.partyName ? <Divider /> : null}
                <InfoRow
                  icon="document-text-outline"
                  label="Invoice"
                  value={`INV #${shipment.invoiceNumber}`}
                />
              </>
            ) : null}
          </SectionCard>
        ) : null}

        {/* Notes */}
        {shipment.notes ? (
          <SectionCard title="Notes">
            <Text style={styles.notesText}>{shipment.notes}</Text>
          </SectionCard>
        ) : null}

        {/* Bottom spacer for action bar */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Bottom action bar */}
      <View style={styles.actionBar}>
        {/* Status transition buttons */}
        {transitions.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.transitionBtnRow}
            style={styles.transitionScroll}
          >
            {transitions.map((next) => {
              const color = STATUS_COLORS[next] ?? colors.brand;
              return (
                <TouchableOpacity
                  key={next}
                  style={[styles.transitionBtn, { borderColor: color + "60", backgroundColor: color + "18" }]}
                  onPress={() => handleStatusTransition(next)}
                  disabled={isMutating}
                  activeOpacity={0.7}
                >
                  {updateMutation.isPending ? (
                    <ActivityIndicator size="small" color={color} />
                  ) : (
                    <>
                      <Ionicons name="arrow-forward-circle-outline" size={16} color={color} />
                      <Text style={[styles.transitionBtnText, { color }]}>
                        {TRANSITION_LABELS[next] ?? next}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}

        {/* Delete button */}
        <TouchableOpacity
          style={[styles.deleteBtn, isMutating && { opacity: 0.5 }]}
          onPress={handleDelete}
          disabled={isMutating}
          activeOpacity={0.7}
        >
          {deleteMutation.isPending ? (
            <ActivityIndicator size="small" color={colors.danger} />
          ) : (
            <>
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
              <Text style={styles.deleteBtnText}>Delete</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

/* ── Styles ─────────────────────────────────────────────────────── */

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
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
  screenTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
    textAlign: "center",
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 16 },

  // Hero card
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 12,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  carrierIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  heroInfo: { flex: 1 },
  heroCarrier: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 2,
  },
  heroTracking: {
    fontSize: 12,
    color: colors.brand,
    fontFamily: fonts.mono,
  },
  heroMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  heroMetaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  heroMetaText: {
    fontSize: 12,
    color: colors.textSecondary,
  },

  // Notes
  notesText: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    paddingVertical: 12,
  },

  // Action bar
  actionBar: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  transitionScroll: { flexGrow: 0 },
  transitionBtnRow: { gap: 8, flexDirection: "row" },
  transitionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  transitionBtnText: {
    fontSize: 13,
    fontWeight: "700",
  },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.danger + "50",
    backgroundColor: colors.dangerBg,
  },
  deleteBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.danger,
  },
}));
