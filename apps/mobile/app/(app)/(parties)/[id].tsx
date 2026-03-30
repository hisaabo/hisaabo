import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  Linking,
  Alert,
  RefreshControl,
  Share,
  TextInput,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../src/lib/trpc";
import { formatCurrency, formatDate } from "../../../src/lib/utils";
import { colors } from "../../../src/lib/theme";
import { haptic } from "../../../src/lib/haptics";
import { Card, QueryError, DatePickerField } from "../../../src/components/ui";

type LedgerTab = "ledger" | "topItems";

interface MergeTargetParty {
  id: string;
  name: string;
  type: string;
  phone?: string | null;
}

export default function PartyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<LedgerTab>("ledger");
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerFrom, setLedgerFrom] = useState<Date | null>(null);
  const [ledgerTo, setLedgerTo] = useState<Date | null>(null);
  const [showDateFilter, setShowDateFilter] = useState(false);

  // Merge modal state
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeTarget, setMergeTarget] = useState<MergeTargetParty | null>(null);
  const [mergeStep, setMergeStep] = useState<"search" | "confirm">("search");

  const { data: party, isLoading: partyLoading, refetch: refetchParty, isRefetching: isRefetchingParty } =
    trpc.party.getById.useQuery({ id: id ?? "" }, { enabled: !!id });

  const { data: stats } = trpc.party.getStats.useQuery(
    { id: id ?? "" },
    { enabled: !!id }
  );

  const ledgerInput: { partyId: string; page: number; limit: number; fromDate?: string; toDate?: string } = {
    partyId: id ?? "",
    page: ledgerPage,
    limit: 50,
  };
  if (ledgerFrom) ledgerInput.fromDate = new Date(ledgerFrom.getFullYear(), ledgerFrom.getMonth(), ledgerFrom.getDate()).toISOString();
  if (ledgerTo) ledgerInput.toDate = new Date(ledgerTo.getFullYear(), ledgerTo.getMonth(), ledgerTo.getDate(), 23, 59, 59, 999).toISOString();

  const { data: ledgerData, isLoading: ledgerLoading } =
    trpc.party.ledger.useQuery(
      ledgerInput,
      { enabled: !!id && activeTab === "ledger" }
    );

  const { data: topItems, isLoading: topItemsLoading } =
    trpc.party.topItems.useQuery(
      { partyId: id ?? "" },
      { enabled: !!id && activeTab === "topItems" }
    );

  const utils = trpc.useUtils();

  const deleteParty = trpc.party.delete.useMutation({
    onSuccess: () => {
      utils.party.list.invalidate();
      router.back();
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to delete party");
    },
  });

  const { data: mergeSearchResults } = trpc.party.list.useQuery(
    { search: mergeSearch, limit: 20, page: 1 },
    { enabled: showMergeModal && mergeSearch.length >= 1 }
  );

  const mergeMutation = trpc.party.merge.useMutation({
    onSuccess: () => {
      utils.party.list.invalidate();
      setShowMergeModal(false);
      setMergeTarget(null);
      setMergeSearch("");
      setMergeStep("search");
      router.replace("/(app)/(parties)");
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to merge parties.");
    },
  });

  const handleOpenMerge = () => {
    setMergeSearch("");
    setMergeTarget(null);
    setMergeStep("search");
    setShowMergeModal(true);
  };

  const handleCloseMerge = () => {
    setShowMergeModal(false);
    setMergeTarget(null);
    setMergeSearch("");
    setMergeStep("search");
  };

  const handleSelectMergeTarget = (target: MergeTargetParty) => {
    setMergeTarget(target);
    setMergeStep("confirm");
  };

  const handleConfirmMerge = () => {
    if (!party || !mergeTarget) return;
    mergeMutation.mutate({ sourceId: party.id, targetId: mergeTarget.id });
  };

  const handleDelete = () => {
    if (!party) return;
    Alert.alert(
      "Delete Party",
      `Delete ${party.name}? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            haptic.error();
            deleteParty.mutate({ id: party.id });
          },
        },
      ]
    );
  };

  if (partyLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!party) {
    return (
      <SafeAreaView style={styles.container}>
        <QueryError message="Party not found" onRetry={() => {}} />
      </SafeAreaView>
    );
  }

  const balance = parseFloat(party.balance || "0");
  const isReceivable = balance >= 0;

  const handleCall = () => {
    if (party.phone) {
      Linking.openURL(`tel:${party.phone}`);
    }
  };

  const handleExportLedger = async () => {
    if (!ledgerData?.data || ledgerData.data.length === 0) {
      Alert.alert("No data", "Nothing to export.");
      return;
    }
    const lines = [
      "Date,Document,Type,Debit,Credit,Balance",
      ...ledgerData.data.map((e) =>
        [
          e.date,
          e.documentNumber,
          e.type,
          e.debit,
          e.credit,
          e.runningBalance,
        ].join(",")
      ),
    ].join("\n");
    try {
      await Share.share({ message: lines, title: `Ledger - ${party.name}` });
    } catch {
      // User cancelled
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Nav */}
      <View style={styles.topNav}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.topNavActions}>
          <TouchableOpacity
            style={styles.editButton}
            onPress={() => router.push({ pathname: "/(app)/(parties)/edit", params: { id } } as never)}
            activeOpacity={0.7}
          >
            <Ionicons name="create-outline" size={22} color={colors.brand} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.mergeButton}
            onPress={handleOpenMerge}
            activeOpacity={0.7}
          >
            <Ionicons name="git-merge-outline" size={20} color={colors.info} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={handleDelete}
            activeOpacity={0.7}
          >
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[3]}
        refreshControl={
          <RefreshControl refreshing={isRefetchingParty} onRefresh={refetchParty} tintColor={colors.brand} colors={[colors.brand]} />
        }
      >
        {/* Header */}
        <View style={styles.partyHeader}>
          <View style={styles.partyAvatarLarge}>
            <Text style={styles.partyAvatarTextLarge}>
              {party.name.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.partyHeaderInfo}>
            <Text style={styles.partyName}>{party.name}</Text>
            <View style={styles.typeBadge}>
              <Text style={styles.typeBadgeText}>
                {party.type === "customer" ? "Customer" : "Supplier"}
              </Text>
            </View>
          </View>
        </View>

        {/* Balance Card */}
        <View style={styles.card}>
          <View style={styles.balanceRow}>
            <View>
              <Text style={styles.sectionLabel}>Outstanding Balance</Text>
              <Text
                style={[
                  styles.balanceLarge,
                  isReceivable ? styles.balanceGreen : styles.balanceRed,
                ]}
              >
                {formatCurrency(Math.abs(balance))}
              </Text>
              <Text style={styles.balanceDirection}>
                {isReceivable ? "You will receive" : "You will pay"}
              </Text>
            </View>
            <View style={styles.statsColumn}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{stats?.invoiceCount ?? 0}</Text>
                <Text style={styles.statLabel}>Invoices</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{stats?.paymentCount ?? 0}</Text>
                <Text style={styles.statLabel}>Payments</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Contact Card */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Contact Details</Text>
          {party.phone && (
            <View style={styles.contactRow}>
              <Ionicons name="call-outline" size={16} color={colors.textMuted} />
              <Text style={styles.contactText}>{party.phone}</Text>
            </View>
          )}
          {party.email && (
            <View style={styles.contactRow}>
              <Ionicons name="mail-outline" size={16} color={colors.textMuted} />
              <Text style={styles.contactText}>{party.email}</Text>
            </View>
          )}
          {party.gstin && (
            <View style={styles.contactRow}>
              <Ionicons name="document-text-outline" size={16} color={colors.textMuted} />
              <Text style={styles.contactText}>GST: {party.gstin}</Text>
            </View>
          )}
          {party.billingAddress && (
            <View style={styles.contactRow}>
              <Ionicons name="location-outline" size={16} color={colors.textMuted} />
              <Text style={styles.contactText} numberOfLines={2}>
                {[party.billingAddress, party.city, party.state, party.pincode]
                  .filter(Boolean)
                  .join(", ")}
              </Text>
            </View>
          )}
          {!party.phone && !party.email && !party.gstin && !party.billingAddress && (
            <Text style={styles.noContactText}>No contact details added</Text>
          )}
        </View>

        {/* Actions */}
        <View style={styles.actionsRow}>
          {party.phone && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleCall}
              activeOpacity={0.7}
            >
              <Ionicons name="call-outline" size={20} color={colors.success} />
              <Text style={[styles.actionButtonText, { color: colors.success }]}>
                Call
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => router.push({ pathname: "/(app)/(parties)/edit", params: { id } } as never)}
            activeOpacity={0.7}
          >
            <Ionicons name="create-outline" size={20} color={colors.brand} />
            <Text style={[styles.actionButtonText, { color: colors.brand }]}>
              Edit
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.actionButtonPrimary]}
            activeOpacity={0.7}
          >
            <Ionicons name="receipt-outline" size={20} color={colors.textPrimary} />
            <Text style={[styles.actionButtonText, { color: colors.textPrimary }]}>
              New Invoice
            </Text>
          </TouchableOpacity>
        </View>

        {/* Tab Headers (sticky) */}
        <View style={styles.tabHeaderWrapper}>
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tab, activeTab === "ledger" && styles.tabActive]}
              onPress={() => setActiveTab("ledger")}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === "ledger" && styles.tabTextActive,
                ]}
              >
                Ledger
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === "topItems" && styles.tabActive]}
              onPress={() => setActiveTab("topItems")}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === "topItems" && styles.tabTextActive,
                ]}
              >
                Top Items
              </Text>
            </TouchableOpacity>
          </View>
          {activeTab === "ledger" && (
            <View style={styles.ledgerActions}>
              <TouchableOpacity
                style={styles.ledgerActionBtn}
                onPress={() => setShowDateFilter(!showDateFilter)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="calendar-outline"
                  size={16}
                  color={showDateFilter ? colors.brand : colors.textMuted}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.ledgerActionBtn}
                onPress={handleExportLedger}
                activeOpacity={0.7}
              >
                <Ionicons name="share-outline" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          )}
        </View>
        {activeTab === "ledger" && showDateFilter && (
          <View style={styles.dateFilterRow}>
            <View style={styles.dateField}>
              <DatePickerField
                label="From"
                value={ledgerFrom ?? new Date()}
                onChange={setLedgerFrom}
              />
            </View>
            <View style={styles.dateField}>
              <DatePickerField
                label="To"
                value={ledgerTo ?? new Date()}
                onChange={setLedgerTo}
                minimumDate={ledgerFrom ?? undefined}
              />
            </View>
          </View>
        )}

        {/* Ledger Tab */}
        {activeTab === "ledger" && (
          <View style={styles.tabContent}>
            {ledgerLoading ? (
              <ActivityIndicator
                color={colors.brand}
                style={styles.tabLoader}
              />
            ) : ledgerData?.data && ledgerData.data.length > 0 ? (
              <>
                {/* Opening Balance Row */}
                <View style={styles.ledgerOpeningRow}>
                  <Text style={styles.ledgerOpeningLabel}>
                    Opening Balance
                  </Text>
                  <Text style={styles.ledgerOpeningValue}>
                    {formatCurrency(parseFloat(ledgerData.openingBalance || "0"))}
                  </Text>
                </View>
                {ledgerData.data.map((entry, idx) => (
                  <View key={`${entry.documentId}-${idx}`} style={styles.ledgerRow}>
                    <View style={styles.ledgerIconCol}>
                      <View
                        style={[
                          styles.ledgerTypeIcon,
                          entry.type === "invoice" || entry.type === "purchase"
                            ? styles.ledgerTypeIconInvoice
                            : styles.ledgerTypeIconPayment,
                        ]}
                      >
                        <Ionicons
                          name={
                            entry.type === "payment"
                              ? "cash-outline"
                              : "receipt-outline"
                          }
                          size={14}
                          color={
                            entry.type === "payment" ? colors.success : colors.brand
                          }
                        />
                      </View>
                    </View>
                    <View style={styles.ledgerMiddle}>
                      <Text style={styles.ledgerDocNumber}>
                        {entry.documentNumber}
                      </Text>
                      <Text style={styles.ledgerDate}>
                        {formatDate(entry.date)}
                      </Text>
                      {entry.status && (
                        <Text style={styles.ledgerStatus}>{entry.status}</Text>
                      )}
                    </View>
                    <View style={styles.ledgerRight}>
                      {parseFloat(entry.debit) > 0 && (
                        <Text style={styles.ledgerDebit}>
                          +{formatCurrency(entry.debit)}
                        </Text>
                      )}
                      {parseFloat(entry.credit) > 0 && (
                        <Text style={styles.ledgerCredit}>
                          -{formatCurrency(entry.credit)}
                        </Text>
                      )}
                      <Text style={styles.ledgerBalance}>
                        {formatCurrency(parseFloat(entry.runningBalance))}
                      </Text>
                    </View>
                  </View>
                ))}
              </>
            ) : (
              <View style={styles.emptyTab}>
                <Ionicons
                  name="document-text-outline"
                  size={40}
                  color={colors.border}
                />
                <Text style={styles.emptyTabText}>No ledger entries</Text>
              </View>
            )}
          </View>
        )}

        {/* Top Items Tab */}
        {activeTab === "topItems" && (
          <View style={styles.tabContent}>
            {topItemsLoading ? (
              <ActivityIndicator color={colors.brand} style={styles.tabLoader} />
            ) : topItems && topItems.length > 0 ? (
              topItems.map((item, idx) => (
                <View key={item.itemId ?? idx} style={styles.topItemRow}>
                  <View style={styles.topItemRank}>
                    <Text style={styles.topItemRankText}>{idx + 1}</Text>
                  </View>
                  <View style={styles.topItemInfo}>
                    <Text style={styles.topItemName}>{item.itemName}</Text>
                    <Text style={styles.topItemQty}>
                      {parseFloat(item.totalQuantity ?? "0").toFixed(0)} units
                      across {item.invoiceCount} invoices
                    </Text>
                  </View>
                  <Text style={styles.topItemAmount}>
                    {formatCurrency(parseFloat(item.totalAmount ?? "0"))}
                  </Text>
                </View>
              ))
            ) : (
              <View style={styles.emptyTab}>
                <Ionicons name="cube-outline" size={40} color={colors.border} />
                <Text style={styles.emptyTabText}>No items sold yet</Text>
              </View>
            )}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Merge Modal */}
      <Modal
        visible={showMergeModal}
        transparent
        animationType="slide"
        onRequestClose={handleCloseMerge}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {mergeStep === "search" ? "Merge Into Party" : "Confirm Merge"}
              </Text>
              <TouchableOpacity onPress={handleCloseMerge} style={styles.modalClose}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {mergeStep === "search" ? (
              <>
                <View style={styles.mergeSourceRow}>
                  <Ionicons name="person-circle-outline" size={18} color={colors.textMuted} />
                  <Text style={styles.mergeSourceLabel}>
                    Merging: <Text style={styles.mergeSourceName}>{party?.name}</Text>
                  </Text>
                </View>
                <Text style={styles.mergeHint}>
                  Search for the party to merge INTO. All invoices, payments, and history
                  from <Text style={{ fontWeight: "700" }}>{party?.name}</Text> will be
                  transferred to the selected party.
                </Text>

                <TextInput
                  style={styles.mergeSearchInput}
                  value={mergeSearch}
                  onChangeText={setMergeSearch}
                  placeholder="Search party name..."
                  placeholderTextColor={colors.textMuted}
                  autoFocus
                  returnKeyType="search"
                />

                <FlatList
                  data={(mergeSearchResults?.data ?? []).filter((p) => p.id !== id)}
                  keyExtractor={(item) => item.id}
                  style={styles.mergeResultsList}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.mergeResultRow}
                      onPress={() => handleSelectMergeTarget(item)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.mergeResultAvatar}>
                        <Text style={styles.mergeResultAvatarText}>
                          {item.name.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.mergeResultInfo}>
                        <Text style={styles.mergeResultName}>{item.name}</Text>
                        <Text style={styles.mergeResultType}>
                          {item.type === "customer" ? "Customer" : "Supplier"}
                          {item.phone ? ` · ${item.phone}` : ""}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={
                    mergeSearch.length >= 1 ? (
                      <Text style={styles.mergeEmptyText}>No parties found</Text>
                    ) : (
                      <Text style={styles.mergeEmptyText}>
                        Type at least 1 character to search
                      </Text>
                    )
                  }
                />
              </>
            ) : (
              <>
                <View style={styles.mergeDiagram}>
                  <View style={styles.mergeDiagramParty}>
                    <View style={[styles.mergeDiagramAvatar, { backgroundColor: colors.dangerBg }]}>
                      <Text style={[styles.mergeDiagramAvatarText, { color: colors.danger }]}>
                        {party?.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.mergeDiagramName} numberOfLines={1}>
                      {party?.name}
                    </Text>
                    <Text style={styles.mergeDiagramRole}>Source (will be deleted)</Text>
                  </View>

                  <View style={styles.mergeDiagramArrow}>
                    <Ionicons name="arrow-forward" size={20} color={colors.textMuted} />
                  </View>

                  <View style={styles.mergeDiagramParty}>
                    <View style={[styles.mergeDiagramAvatar, { backgroundColor: colors.brandLight }]}>
                      <Text style={[styles.mergeDiagramAvatarText, { color: colors.brand }]}>
                        {mergeTarget?.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.mergeDiagramName} numberOfLines={1}>
                      {mergeTarget?.name}
                    </Text>
                    <Text style={styles.mergeDiagramRole}>Target (kept)</Text>
                  </View>
                </View>

                <View style={styles.mergeWarningBanner}>
                  <Ionicons name="warning-outline" size={16} color={colors.warning} />
                  <Text style={styles.mergeWarningText}>
                    All invoices, payments, and history from{" "}
                    <Text style={{ fontWeight: "700", color: colors.textPrimary }}>{party?.name}</Text>{" "}
                    will be transferred to{" "}
                    <Text style={{ fontWeight: "700", color: colors.textPrimary }}>{mergeTarget?.name}</Text>.
                    {"\n"}
                    <Text style={{ fontWeight: "700" }}>{party?.name}</Text> will then be permanently deleted.
                    This cannot be undone.
                  </Text>
                </View>

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.mergeBackBtn}
                    onPress={() => setMergeStep("search")}
                    disabled={mergeMutation.isPending}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.mergeBackBtnText}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.mergeConfirmBtn, mergeMutation.isPending && { opacity: 0.6 }]}
                    onPress={handleConfirmMerge}
                    disabled={mergeMutation.isPending}
                    activeOpacity={0.8}
                  >
                    {mergeMutation.isPending ? (
                      <ActivityIndicator color={colors.textPrimary} size="small" />
                    ) : (
                      <Text style={styles.mergeConfirmBtnText}>Merge Parties</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  errorText: {
    color: colors.danger,
    fontSize: 16,
  },
  topNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  topNavActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  editButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandLight,
  },
  mergeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.infoBg,
  },
  deleteButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(239,68,68,0.12)",
  },
  scrollView: {
    flex: 1,
  },
  partyHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 16,
  },
  partyAvatarLarge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(99,102,241,0.4)",
  },
  partyAvatarTextLarge: {
    fontSize: 26,
    fontWeight: "700",
    color: colors.brand,
  },
  partyHeaderInfo: {
    flex: 1,
    gap: 6,
  },
  partyName: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  typeBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.brandLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(99,102,241,0.3)",
  },
  typeBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.brand,
  },
  card: {
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 10,
  },
  balanceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  balanceLarge: {
    fontSize: 30,
    fontWeight: "800",
    marginTop: 4,
    marginBottom: 4,
  },
  balanceGreen: {
    color: colors.success,
  },
  balanceRed: {
    color: colors.danger,
  },
  balanceDirection: {
    fontSize: 13,
    color: colors.textMuted,
  },
  statsColumn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  statItem: {
    alignItems: "center",
  },
  statValue: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 36,
    backgroundColor: colors.border,
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 10,
  },
  contactText: {
    fontSize: 14,
    color: colors.textSecondary,
    flex: 1,
    lineHeight: 20,
  },
  noContactText: {
    fontSize: 14,
    color: colors.textMuted,
    fontStyle: "italic",
  },
  actionsRow: {
    flexDirection: "row",
    marginHorizontal: 20,
    marginBottom: 16,
    gap: 10,
  },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
  },
  actionButtonPrimary: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
    flex: 1.5,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  tabHeaderWrapper: {
    marginHorizontal: 20,
    marginBottom: 0,
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ledgerActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 4,
    marginTop: 8,
  },
  ledgerActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  dateFilterRow: {
    flexDirection: "row",
    gap: 12,
    marginHorizontal: 20,
    marginTop: 8,
  },
  dateField: {
    flex: 1,
  },
  dateFieldLabel: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  dateFieldInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.textPrimary,
    fontSize: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 9,
  },
  tabActive: {
    backgroundColor: colors.brand,
  },
  tabText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textMuted,
  },
  tabTextActive: {
    color: colors.textPrimary,
  },
  tabContent: {
    paddingTop: 12,
  },
  tabLoader: {
    paddingVertical: 40,
  },
  ledgerOpeningRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginHorizontal: 20,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderRadius: 10,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ledgerOpeningLabel: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: "600",
  },
  ledgerOpeningValue: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: "600",
  },
  ledgerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
    gap: 12,
  },
  ledgerIconCol: {
    width: 36,
    alignItems: "center",
  },
  ledgerTypeIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  ledgerTypeIconInvoice: {
    backgroundColor: colors.brandLight,
  },
  ledgerTypeIconPayment: {
    backgroundColor: "rgba(16,185,129,0.15)",
  },
  ledgerMiddle: {
    flex: 1,
    gap: 2,
  },
  ledgerDocNumber: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  ledgerDate: {
    fontSize: 12,
    color: colors.textMuted,
  },
  ledgerStatus: {
    fontSize: 11,
    color: colors.warning,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  ledgerRight: {
    alignItems: "flex-end",
    gap: 2,
  },
  ledgerDebit: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.success,
  },
  ledgerCredit: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.danger,
  },
  ledgerBalance: {
    fontSize: 12,
    color: colors.textMuted,
  },
  topItemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
    gap: 14,
  },
  topItemRank: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  topItemRankText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.brand,
  },
  topItemInfo: {
    flex: 1,
  },
  topItemName: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: 2,
  },
  topItemQty: {
    fontSize: 12,
    color: colors.textMuted,
  },
  topItemAmount: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  emptyTab: {
    alignItems: "center",
    paddingVertical: 48,
    gap: 12,
  },
  emptyTabText: {
    fontSize: 15,
    color: colors.textMuted,
  },

  // Merge modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
    maxHeight: "85%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  modalClose: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  mergeSourceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  mergeSourceLabel: {
    fontSize: 13,
    color: colors.textMuted,
  },
  mergeSourceName: {
    color: colors.textPrimary,
    fontWeight: "700",
  },
  mergeHint: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 17,
    marginBottom: 14,
  },
  mergeSearchInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 14,
    marginBottom: 10,
  },
  mergeResultsList: {
    maxHeight: 280,
  },
  mergeResultRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  mergeResultAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  mergeResultAvatarText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.brand,
  },
  mergeResultInfo: { flex: 1 },
  mergeResultName: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: 2,
  },
  mergeResultType: {
    fontSize: 12,
    color: colors.textMuted,
  },
  mergeEmptyText: {
    textAlign: "center",
    color: colors.textMuted,
    fontSize: 13,
    paddingVertical: 24,
  },

  // Merge confirmation step
  mergeDiagram: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    marginBottom: 16,
    paddingVertical: 8,
  },
  mergeDiagramParty: {
    flex: 1,
    alignItems: "center",
    gap: 6,
  },
  mergeDiagramAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  mergeDiagramAvatarText: {
    fontSize: 20,
    fontWeight: "700",
  },
  mergeDiagramName: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textPrimary,
    textAlign: "center",
  },
  mergeDiagramRole: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: "center",
  },
  mergeDiagramArrow: {
    width: 32,
    alignItems: "center",
  },
  mergeWarningBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warning + "40",
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
  },
  mergeWarningText: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
  },
  mergeBackBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mergeBackBtnText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: "600",
  },
  mergeConfirmBtn: {
    flex: 2,
    backgroundColor: colors.danger,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  mergeConfirmBtnText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
});
