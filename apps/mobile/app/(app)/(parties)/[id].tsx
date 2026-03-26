import { useState } from "react";
import {
  View,
  Text,
  SafeAreaView,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  Linking,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../src/lib/trpc";
import { formatCurrency, formatDate } from "../../../src/lib/utils";

type LedgerTab = "ledger" | "topItems";

export default function PartyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<LedgerTab>("ledger");
  const [ledgerPage, setLedgerPage] = useState(1);

  const { data: party, isLoading: partyLoading } =
    trpc.party.getById.useQuery({ id: id ?? "" }, { enabled: !!id });

  const { data: stats } = trpc.party.getStats.useQuery(
    { id: id ?? "" },
    { enabled: !!id }
  );

  const { data: ledgerData, isLoading: ledgerLoading } =
    trpc.party.ledger.useQuery(
      { partyId: id ?? "", page: ledgerPage, limit: 50 },
      { enabled: !!id && activeTab === "ledger" }
    );

  const { data: topItems, isLoading: topItemsLoading } =
    trpc.party.topItems.useQuery(
      { partyId: id ?? "" },
      { enabled: !!id && activeTab === "topItems" }
    );

  if (partyLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color="#6366f1" size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!party) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>Party not found</Text>
        </View>
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

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Nav */}
      <View style={styles.topNav}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={22} color="#ffffff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.editButton}
          onPress={() => router.push(`/(app)/(parties)/edit/${id}` as never)}
          activeOpacity={0.7}
        >
          <Ionicons name="create-outline" size={22} color="#6366f1" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[3]}
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
              <Ionicons name="call-outline" size={16} color="#6b7280" />
              <Text style={styles.contactText}>{party.phone}</Text>
            </View>
          )}
          {party.email && (
            <View style={styles.contactRow}>
              <Ionicons name="mail-outline" size={16} color="#6b7280" />
              <Text style={styles.contactText}>{party.email}</Text>
            </View>
          )}
          {party.gstin && (
            <View style={styles.contactRow}>
              <Ionicons name="document-text-outline" size={16} color="#6b7280" />
              <Text style={styles.contactText}>GST: {party.gstin}</Text>
            </View>
          )}
          {party.billingAddress && (
            <View style={styles.contactRow}>
              <Ionicons name="location-outline" size={16} color="#6b7280" />
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
              <Ionicons name="call-outline" size={20} color="#10b981" />
              <Text style={[styles.actionButtonText, { color: "#10b981" }]}>
                Call
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => router.push(`/(app)/(parties)/edit/${id}` as never)}
            activeOpacity={0.7}
          >
            <Ionicons name="create-outline" size={20} color="#6366f1" />
            <Text style={[styles.actionButtonText, { color: "#6366f1" }]}>
              Edit
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.actionButtonPrimary]}
            activeOpacity={0.7}
          >
            <Ionicons name="receipt-outline" size={20} color="#ffffff" />
            <Text style={[styles.actionButtonText, { color: "#ffffff" }]}>
              New Invoice
            </Text>
          </TouchableOpacity>
        </View>

        {/* Tab Headers (sticky) */}
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

        {/* Ledger Tab */}
        {activeTab === "ledger" && (
          <View style={styles.tabContent}>
            {ledgerLoading ? (
              <ActivityIndicator
                color="#6366f1"
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
                            entry.type === "payment" ? "#10b981" : "#6366f1"
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
                  color="#2d2d44"
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
              <ActivityIndicator color="#6366f1" style={styles.tabLoader} />
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
                <Ionicons name="cube-outline" size={40} color="#2d2d44" />
                <Text style={styles.emptyTabText}>No items sold yet</Text>
              </View>
            )}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f0f1a",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  errorText: {
    color: "#ef4444",
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
    backgroundColor: "#1a1a2e",
  },
  editButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(99,102,241,0.15)",
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
    backgroundColor: "rgba(99,102,241,0.2)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(99,102,241,0.4)",
  },
  partyAvatarTextLarge: {
    fontSize: 26,
    fontWeight: "700",
    color: "#6366f1",
  },
  partyHeaderInfo: {
    flex: 1,
    gap: 6,
  },
  partyName: {
    fontSize: 22,
    fontWeight: "700",
    color: "#ffffff",
  },
  typeBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(99,102,241,0.2)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(99,102,241,0.3)",
  },
  typeBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6366f1",
  },
  card: {
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#2d2d44",
    padding: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#6b7280",
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
    color: "#10b981",
  },
  balanceRed: {
    color: "#ef4444",
  },
  balanceDirection: {
    fontSize: 13,
    color: "#6b7280",
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
    color: "#ffffff",
  },
  statLabel: {
    fontSize: 11,
    color: "#6b7280",
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 36,
    backgroundColor: "#2d2d44",
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 10,
  },
  contactText: {
    fontSize: 14,
    color: "#9ca3af",
    flex: 1,
    lineHeight: 20,
  },
  noContactText: {
    fontSize: 14,
    color: "#6b7280",
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
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2d2d44",
    paddingVertical: 12,
  },
  actionButtonPrimary: {
    backgroundColor: "#6366f1",
    borderColor: "#6366f1",
    flex: 1.5,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  tabBar: {
    flexDirection: "row",
    marginHorizontal: 20,
    marginBottom: 0,
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: "#2d2d44",
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 9,
  },
  tabActive: {
    backgroundColor: "#6366f1",
  },
  tabText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#6b7280",
  },
  tabTextActive: {
    color: "#ffffff",
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
    backgroundColor: "#1a1a2e",
    borderRadius: 10,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: "#2d2d44",
  },
  ledgerOpeningLabel: {
    fontSize: 13,
    color: "#6b7280",
    fontWeight: "600",
  },
  ledgerOpeningValue: {
    fontSize: 14,
    color: "#9ca3af",
    fontWeight: "600",
  },
  ledgerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a2e",
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
    backgroundColor: "rgba(99,102,241,0.15)",
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
    color: "#ffffff",
  },
  ledgerDate: {
    fontSize: 12,
    color: "#6b7280",
  },
  ledgerStatus: {
    fontSize: 11,
    color: "#f59e0b",
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
    color: "#10b981",
  },
  ledgerCredit: {
    fontSize: 13,
    fontWeight: "600",
    color: "#ef4444",
  },
  ledgerBalance: {
    fontSize: 12,
    color: "#6b7280",
  },
  topItemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a2e",
    gap: 14,
  },
  topItemRank: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(99,102,241,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  topItemRankText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#6366f1",
  },
  topItemInfo: {
    flex: 1,
  },
  topItemName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#ffffff",
    marginBottom: 2,
  },
  topItemQty: {
    fontSize: 12,
    color: "#6b7280",
  },
  topItemAmount: {
    fontSize: 15,
    fontWeight: "700",
    color: "#ffffff",
  },
  emptyTab: {
    alignItems: "center",
    paddingVertical: 48,
    gap: 12,
  },
  emptyTabText: {
    fontSize: 15,
    color: "#6b7280",
  },
});
