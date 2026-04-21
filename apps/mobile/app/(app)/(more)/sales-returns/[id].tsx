import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";
import { formatCurrency, formatDate } from "../../../../src/lib/utils";
import { makeStyles } from "../../../../src/lib/makeStyles";
import { useColors } from "../../../../src/contexts/ThemeContext";
import { haptic } from "../../../../src/lib/haptics";
import { StatusBadge, QueryError, Skeleton } from "../../../../src/components/ui";

export default function SalesReturnDetailScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const { data: doc, isLoading, refetch, isRefetching } = trpc.invoice.getById.useQuery(
    { id: id ?? "" },
    { enabled: !!id }
  );

  const utils = trpc.useUtils();

  const updateStatus = trpc.salesReturn.updateStatus.useMutation({
    onSuccess: () => {
      haptic.success();
      refetch();
      utils.salesReturn.list.invalidate();
      utils.dashboard.summary.invalidate();
      setUpdatingStatus(false);
    },
    onError: (err) => {
      haptic.error();
      Alert.alert("Error", err.message);
      setUpdatingStatus(false);
    },
  });

  const deleteDoc = trpc.salesReturn.delete.useMutation({
    onSuccess: () => {
      haptic.success();
      utils.salesReturn.list.invalidate();
      utils.invoice.list.invalidate();
      utils.dashboard.summary.invalidate();
      utils.party.list.invalidate();
      router.back();
    },
    onError: (err) => {
      haptic.error();
      Alert.alert("Error", err.message);
    },
  });

  const handleMarkSent = () => {
    if (!doc) return;
    haptic.medium();
    Alert.alert("Mark as Sent", "Mark this sales return as sent?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Confirm",
        onPress: () => {
          setUpdatingStatus(true);
          updateStatus.mutate({ id: doc.id, status: "sent" });
        },
      },
    ]);
  };

  const handleDelete = () => {
    if (!doc) return;
    Alert.alert(
      "Delete Sales Return",
      `Delete ${doc.invoiceNumber}? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            haptic.error();
            deleteDoc.mutate({ id: doc.id });
          },
        },
      ]
    );
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

  if (!doc) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <QueryError message="Sales return not found" onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  const subtotal = doc.lineItems.reduce(
    (sum, li) => sum + parseFloat(li.totalAmount ?? "0"),
    0
  );
  const taxTotal = doc.lineItems.reduce(
    (sum, li) => sum + parseFloat(li.taxAmount ?? "0"),
    0
  );
  const total = parseFloat(doc.totalAmount ?? "0");

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.topBarCenter}>
          <Text style={styles.topBarTitle}>{doc.invoiceNumber}</Text>
        </View>
        <StatusBadge status={doc.status} />
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
        {/* Info banner */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={15} color={colors.info} />
          <Text style={styles.infoText}>Stock is incremented on creation (goods returned by customer)</Text>
        </View>

        {/* Party Info Card */}
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <View style={styles.cardIconWrap}>
              <Ionicons name="person-outline" size={18} color={colors.brand} />
            </View>
            <View style={styles.cardInfo}>
              <Text style={styles.cardLabel}>Customer</Text>
              <Text style={styles.cardValue}>{doc.party?.name ?? "—"}</Text>
              {doc.party?.phone ? (
                <Text style={styles.cardSubValue}>{doc.party.phone}</Text>
              ) : null}
            </View>
          </View>
        </View>

        {/* Date Card */}
        <View style={styles.card}>
          <View style={styles.datesRow}>
            <View style={styles.dateItem}>
              <Text style={styles.dateLabel}>Return Date</Text>
              <Text style={styles.dateValue}>
                {doc.invoiceDate ? formatDate(doc.invoiceDate) : "—"}
              </Text>
            </View>
            {doc.referenceDocumentId ? (
              <>
                <View style={styles.dateDivider} />
                <View style={styles.dateItem}>
                  <Text style={styles.dateLabel}>Source Invoice</Text>
                  <TouchableOpacity
                    onPress={() =>
                      router.push({
                        pathname: "/(app)/(invoices)/[id]",
                        params: { id: doc.referenceDocumentId! },
                      } as never)
                    }
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.dateValue, { color: colors.brand }]}>
                      View Invoice
                      <Ionicons name="open-outline" size={12} color={colors.brand} />
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
          </View>
        </View>

        {/* Line Items */}
        <Text style={styles.sectionTitle}>Items (Returned)</Text>
        <View style={styles.card}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableCell, styles.tableDescCol]}>Description</Text>
            <Text style={[styles.tableCell, styles.tableNumCol, styles.textRight]}>Qty</Text>
            <Text style={[styles.tableCell, styles.tableNumCol, styles.textRight]}>Rate</Text>
            <Text style={[styles.tableCell, styles.tableNumCol, styles.textRight]}>Amount</Text>
          </View>
          <View style={styles.tableDivider} />
          {doc.lineItems.map((li, idx) => (
            <View key={idx}>
              <View style={styles.tableRow}>
                <View style={styles.tableDescCol}>
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
                  {li.quantity}
                </Text>
                <Text style={[styles.tableCell, styles.tableNumCol, styles.textRight, styles.lineNum]}>
                  {formatCurrency(li.unitPrice ?? "0")}
                </Text>
                <Text style={[styles.tableCell, styles.tableNumCol, styles.textRight, styles.lineNum]}>
                  {formatCurrency(li.totalAmount ?? "0")}
                </Text>
              </View>
              {idx < doc.lineItems.length - 1 && (
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
          {parseFloat(doc.discountAmount ?? "0") > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Discount</Text>
              <Text style={[styles.totalValue, { color: colors.success }]}>
                -{formatCurrency(doc.discountAmount ?? "0")}
              </Text>
            </View>
          )}
          <View style={styles.totalDivider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabelBold}>Return Amount</Text>
            <Text style={styles.totalValueBold}>{formatCurrency(total)}</Text>
          </View>
        </View>

        {/* Notes */}
        {doc.notes ? (
          <>
            <Text style={styles.sectionTitle}>Notes</Text>
            <View style={styles.card}>
              <Text style={styles.notesText}>{doc.notes}</Text>
            </View>
          </>
        ) : null}

        {/* Actions */}
        <Text style={styles.sectionTitle}>Actions</Text>

        {doc.status === "draft" && (
          <View style={styles.actionGroup}>
            <TouchableOpacity
              style={[styles.actionBtn, { borderColor: colors.info + "60" }]}
              onPress={handleMarkSent}
              activeOpacity={0.7}
              disabled={updatingStatus}
            >
              <Ionicons name="send-outline" size={18} color={colors.info} style={styles.actionIcon} />
              <Text style={[styles.actionBtnText, { color: colors.info }]}>Mark as Sent</Text>
            </TouchableOpacity>
          </View>
        )}

        {doc.status === "draft" && (
          <View style={[styles.actionGroup, styles.dangerGroup]}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.dangerBtn]}
              onPress={handleDelete}
              activeOpacity={0.7}
              disabled={deleteDoc.isPending}
            >
              <Ionicons name="trash-outline" size={18} color={colors.danger} style={styles.actionIcon} />
              <Text style={[styles.actionBtnText, { color: colors.danger }]}>Delete Sales Return</Text>
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
  infoBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.infoBg,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.info + "30",
  },
  infoText: {
    fontSize: 12,
    color: colors.info,
    flex: 1,
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
}));
