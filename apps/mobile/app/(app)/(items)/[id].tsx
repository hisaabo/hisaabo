import { useState } from "react";
import {
  View,
  Text,
  SafeAreaView,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../src/lib/trpc";
import { formatCurrency, formatDate } from "../../../src/lib/utils";

type DetailTab = "stats" | "priceHistory" | "stockMovements";

export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();

  const [activeTab, setActiveTab] = useState<DetailTab>("stats");
  const [adjustModalVisible, setAdjustModalVisible] = useState(false);
  const [adjustDirection, setAdjustDirection] = useState<"add" | "remove">(
    "add"
  );
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  const { data: item, isLoading } = trpc.item.getById.useQuery(
    { id: id ?? "" },
    { enabled: !!id }
  );

  const { data: salesStats, isLoading: statsLoading } =
    trpc.item.salesStats.useQuery(
      { id: id ?? "" },
      { enabled: !!id && activeTab === "stats" }
    );

  const { data: priceHistory, isLoading: priceHistoryLoading } =
    trpc.item.priceHistory.useQuery(
      { id: id ?? "" },
      { enabled: !!id && activeTab === "priceHistory" }
    );

  const { data: stockMovements, isLoading: stockMovementsLoading } =
    trpc.item.stockMovements.useQuery(
      { id: id ?? "" },
      { enabled: !!id && activeTab === "stockMovements" }
    );

  const adjustStock = trpc.item.adjustStock.useMutation({
    onSuccess: () => {
      utils.item.getById.invalidate({ id: id ?? "" });
      setAdjustModalVisible(false);
      setAdjustQty("");
      setAdjustReason("");
    },
    onError: (error) => {
      Alert.alert("Error", error.message || "Failed to adjust stock");
    },
  });

  const handleAdjustSubmit = () => {
    const qty = parseFloat(adjustQty);
    if (isNaN(qty) || qty <= 0) {
      Alert.alert("Error", "Enter a valid positive quantity");
      return;
    }

    const finalQty =
      adjustDirection === "remove" ? `-${adjustQty}` : adjustQty;

    adjustStock.mutate({
      itemId: id ?? "",
      quantity: finalQty,
      reason: adjustReason.trim() || undefined,
      adjustmentDate: new Date().toISOString(),
    });
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color="#6366f1" size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!item) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>Item not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isVariant = item.itemMode === "variants";
  const isAltUnit = item.itemMode === "alt_units";
  const currentStock = parseFloat(item.stockQuantity ?? "0");
  const lowStockThreshold = item.lowStockAlert
    ? parseFloat(item.lowStockAlert)
    : null;
  const itemLowStock =
    !isVariant &&
    lowStockThreshold !== null &&
    currentStock <= lowStockThreshold;

  const newStockPreview = () => {
    const qty = parseFloat(adjustQty) || 0;
    if (adjustDirection === "add") return currentStock + qty;
    return Math.max(0, currentStock - qty);
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
          onPress={() => router.push(`/(app)/(items)/edit/${id}` as never)}
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
        {/* Item Header */}
        <View style={styles.itemHeader}>
          <View
            style={[
              styles.itemIconLarge,
              item.itemType === "service"
                ? styles.itemIconLargeService
                : styles.itemIconLargeProduct,
            ]}
          >
            <Ionicons
              name={
                item.itemType === "service"
                  ? "briefcase-outline"
                  : "cube-outline"
              }
              size={30}
              color={item.itemType === "service" ? "#8b5cf6" : "#6366f1"}
            />
          </View>
          <View style={styles.itemHeaderInfo}>
            <Text style={styles.itemName}>{item.name}</Text>
            <View style={styles.badgesRow}>
              <View style={styles.typeBadge}>
                <Text style={styles.typeBadgeText}>
                  {item.itemType === "product" ? "Product" : "Service"}
                </Text>
              </View>
              {isVariant && (
                <View style={styles.modeBadgeVariant}>
                  <Text style={styles.modeBadgeText}>Variants</Text>
                </View>
              )}
              {isAltUnit && (
                <View style={styles.modeBadgeAlt}>
                  <Text style={styles.modeBadgeTextAlt}>Alt Units</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Info Card */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Item Details</Text>
          <View style={styles.infoGrid}>
            <View style={styles.infoCell}>
              <Text style={styles.infoCellLabel}>Sale Price</Text>
              <Text style={styles.infoCellValue}>
                {item.salePrice ? formatCurrency(item.salePrice) : "—"}
              </Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoCellLabel}>Purchase Price</Text>
              <Text style={styles.infoCellValue}>
                {item.purchasePrice ? formatCurrency(item.purchasePrice) : "—"}
              </Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoCellLabel}>Tax %</Text>
              <Text style={styles.infoCellValue}>
                {parseFloat(item.taxPercent ?? "0").toFixed(0)}%
              </Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoCellLabel}>Unit</Text>
              <Text style={styles.infoCellValue}>{item.unit}</Text>
            </View>
            {item.hsn && (
              <View style={styles.infoCell}>
                <Text style={styles.infoCellLabel}>HSN</Text>
                <Text style={styles.infoCellValue}>{item.hsn}</Text>
              </View>
            )}
            {item.sku && (
              <View style={styles.infoCell}>
                <Text style={styles.infoCellLabel}>SKU</Text>
                <Text style={[styles.infoCellValue, styles.skuValue]}>
                  {item.sku}
                </Text>
              </View>
            )}
            {item.category && (
              <View style={styles.infoCell}>
                <Text style={styles.infoCellLabel}>Category</Text>
                <Text style={styles.infoCellValue}>{item.category}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Stock Section (non-variant products) */}
        {item.itemType === "product" && !isVariant && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Stock</Text>
            <View style={styles.stockRow}>
              <View>
                <Text
                  style={[
                    styles.stockNumber,
                    itemLowStock ? styles.stockLow : styles.stockNormal,
                  ]}
                >
                  {currentStock % 1 === 0
                    ? currentStock.toFixed(0)
                    : currentStock.toFixed(2)}
                </Text>
                <Text style={styles.stockUnit}>{item.unit} in stock</Text>
                {itemLowStock && (
                  <View style={styles.lowStockAlert}>
                    <Ionicons
                      name="warning-outline"
                      size={14}
                      color="#f59e0b"
                    />
                    <Text style={styles.lowStockText}>
                      Low stock · Alert at{" "}
                      {parseFloat(item.lowStockAlert ?? "0")} {item.unit}
                    </Text>
                  </View>
                )}
                {lowStockThreshold !== null && !itemLowStock && (
                  <Text style={styles.lowStockThreshold}>
                    Alert below {lowStockThreshold} {item.unit}
                  </Text>
                )}
              </View>
              <TouchableOpacity
                style={styles.adjustButton}
                onPress={() => setAdjustModalVisible(true)}
                activeOpacity={0.8}
              >
                <Ionicons name="swap-vertical-outline" size={18} color="#ffffff" />
                <Text style={styles.adjustButtonText}>Adjust</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Variants Section */}
        {isVariant && item.variants && item.variants.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>
              Variants ({item.variants.length})
            </Text>
            {item.variants.map((v, idx) => (
              <View
                key={v.id}
                style={[
                  styles.variantRow,
                  idx < item.variants.length - 1 && styles.variantRowBorder,
                ]}
              >
                <View style={styles.variantInfo}>
                  <Text style={styles.variantAttrs}>
                    {Object.values(v.attributeValues).join(" / ")}
                  </Text>
                  {v.sku && (
                    <Text style={styles.variantSku}>{v.sku}</Text>
                  )}
                </View>
                <View style={styles.variantRight}>
                  <Text style={styles.variantPrice}>
                    {v.salePrice ? formatCurrency(v.salePrice) : "—"}
                  </Text>
                  <Text style={styles.variantStock}>
                    {parseFloat(v.stockQuantity ?? "0").toFixed(0)} {item.unit}
                  </Text>
                </View>
              </View>
            ))}
            <View style={styles.variantTotalRow}>
              <Text style={styles.variantTotalLabel}>Total Stock</Text>
              <Text style={styles.variantTotalValue}>
                {item.variants
                  .reduce(
                    (sum, v) => sum + parseFloat(v.stockQuantity ?? "0"),
                    0
                  )
                  .toFixed(0)}{" "}
                {item.unit}
              </Text>
            </View>
          </View>
        )}

        {/* Detail Tabs */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, activeTab === "stats" && styles.tabActive]}
            onPress={() => setActiveTab("stats")}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === "stats" && styles.tabTextActive,
              ]}
            >
              Sales
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.tab,
              activeTab === "priceHistory" && styles.tabActive,
            ]}
            onPress={() => setActiveTab("priceHistory")}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === "priceHistory" && styles.tabTextActive,
              ]}
            >
              Prices
            </Text>
          </TouchableOpacity>
          {item.itemType === "product" && (
            <TouchableOpacity
              style={[
                styles.tab,
                activeTab === "stockMovements" && styles.tabActive,
              ]}
              onPress={() => setActiveTab("stockMovements")}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === "stockMovements" && styles.tabTextActive,
                ]}
              >
                Stock
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Sales Stats */}
        {activeTab === "stats" && (
          <View style={styles.tabContent}>
            {statsLoading ? (
              <ActivityIndicator color="#6366f1" style={styles.tabLoader} />
            ) : salesStats ? (
              <View style={styles.statsGrid}>
                <View style={styles.statCard}>
                  <Text style={styles.statCardValue}>
                    {formatCurrency(parseFloat(salesStats.totalSaleAmount))}
                  </Text>
                  <Text style={styles.statCardLabel}>Total Sales</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statCardValue}>
                    {parseFloat(salesStats.totalSaleQty).toFixed(2)} {item.unit}
                  </Text>
                  <Text style={styles.statCardLabel}>Qty Sold</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statCardValue}>
                    {formatCurrency(parseFloat(salesStats.avgSalePrice))}
                  </Text>
                  <Text style={styles.statCardLabel}>Avg Price</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statCardValue}>
                    {salesStats.saleInvoiceCount}
                  </Text>
                  <Text style={styles.statCardLabel}>Invoices</Text>
                </View>
              </View>
            ) : null}
          </View>
        )}

        {/* Price History */}
        {activeTab === "priceHistory" && (
          <View style={styles.tabContent}>
            {priceHistoryLoading ? (
              <ActivityIndicator color="#6366f1" style={styles.tabLoader} />
            ) : priceHistory && priceHistory.length > 0 ? (
              priceHistory.map((ph, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.historyRow,
                    idx < priceHistory.length - 1 && styles.historyRowBorder,
                  ]}
                >
                  <View style={styles.historyLeft}>
                    <Text style={styles.historyDocNum}>
                      {ph.invoiceNumber}
                    </Text>
                    <Text style={styles.historyDate}>
                      {formatDate(ph.invoiceDate)}
                    </Text>
                    <Text style={styles.historyParty}>{ph.partyName}</Text>
                  </View>
                  <View style={styles.historyRight}>
                    <Text style={styles.historyPrice}>
                      {formatCurrency(parseFloat(ph.unitPrice ?? "0"))}
                    </Text>
                    <Text style={styles.historyQty}>
                      {parseFloat(ph.quantity ?? "0").toFixed(2)}{" "}
                      {ph.selectedUnit ?? item.unit}
                    </Text>
                    <View
                      style={[
                        styles.historyTypeBadge,
                        ph.invoiceType === "sale"
                          ? styles.historyTypeSale
                          : styles.historyTypePurchase,
                      ]}
                    >
                      <Text style={styles.historyTypeText}>
                        {ph.invoiceType === "sale" ? "Sale" : "Purchase"}
                      </Text>
                    </View>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.emptyTab}>
                <Ionicons
                  name="pricetag-outline"
                  size={40}
                  color="#2d2d44"
                />
                <Text style={styles.emptyTabText}>No price history</Text>
              </View>
            )}
          </View>
        )}

        {/* Stock Movements */}
        {activeTab === "stockMovements" && (
          <View style={styles.tabContent}>
            {stockMovementsLoading ? (
              <ActivityIndicator color="#6366f1" style={styles.tabLoader} />
            ) : stockMovements && stockMovements.length > 0 ? (
              stockMovements.map((sm, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.movementRow,
                    idx < stockMovements.length - 1 &&
                      styles.movementRowBorder,
                  ]}
                >
                  <View
                    style={[
                      styles.movementArrow,
                      sm.direction === "in"
                        ? styles.movementArrowIn
                        : styles.movementArrowOut,
                    ]}
                  >
                    <Ionicons
                      name={
                        sm.direction === "in"
                          ? "arrow-down-outline"
                          : "arrow-up-outline"
                      }
                      size={16}
                      color={sm.direction === "in" ? "#10b981" : "#ef4444"}
                    />
                  </View>
                  <View style={styles.movementInfo}>
                    <Text style={styles.movementDoc}>{sm.invoiceNumber}</Text>
                    <Text style={styles.movementDate}>
                      {formatDate(sm.invoiceDate)}
                    </Text>
                    <Text style={styles.movementParty}>{sm.partyName}</Text>
                  </View>
                  <View style={styles.movementRight}>
                    <Text
                      style={[
                        styles.movementQty,
                        sm.direction === "in"
                          ? styles.movementQtyIn
                          : styles.movementQtyOut,
                      ]}
                    >
                      {sm.direction === "in" ? "+" : "-"}
                      {parseFloat(sm.quantity ?? "0").toFixed(2)}{" "}
                      {sm.selectedUnit ?? item.unit}
                    </Text>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.emptyTab}>
                <Ionicons
                  name="git-commit-outline"
                  size={40}
                  color="#2d2d44"
                />
                <Text style={styles.emptyTabText}>No stock movements</Text>
              </View>
            )}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Adjust Stock Modal */}
      <Modal
        visible={adjustModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setAdjustModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Adjust Stock</Text>
              <TouchableOpacity
                onPress={() => setAdjustModalVisible(false)}
                activeOpacity={0.7}
              >
                <Ionicons name="close" size={22} color="#9ca3af" />
              </TouchableOpacity>
            </View>

            {/* Current Stock Display */}
            <View style={styles.stockPreviewRow}>
              <View style={styles.stockPreviewItem}>
                <Text style={styles.stockPreviewLabel}>Current</Text>
                <Text style={styles.stockPreviewValue}>
                  {currentStock % 1 === 0
                    ? currentStock.toFixed(0)
                    : currentStock.toFixed(2)}
                </Text>
              </View>
              <Ionicons name="arrow-forward" size={20} color="#6b7280" />
              <View style={styles.stockPreviewItem}>
                <Text style={styles.stockPreviewLabel}>After Adjust</Text>
                <Text
                  style={[
                    styles.stockPreviewValue,
                    adjustQty
                      ? adjustDirection === "add"
                        ? styles.stockPreviewGreen
                        : styles.stockPreviewRed
                      : styles.stockPreviewValue,
                  ]}
                >
                  {adjustQty
                    ? (adjustDirection === "add"
                        ? currentStock + parseFloat(adjustQty || "0")
                        : Math.max(
                            0,
                            currentStock - parseFloat(adjustQty || "0")
                          )
                      ).toFixed(
                        (currentStock % 1 === 0 &&
                          parseFloat(adjustQty || "0") % 1 === 0)
                          ? 0
                          : 2
                      )
                    : "—"}
                </Text>
              </View>
            </View>

            {/* Direction Toggle */}
            <View style={styles.directionToggle}>
              <TouchableOpacity
                style={[
                  styles.directionOption,
                  adjustDirection === "add" && styles.directionOptionAdd,
                ]}
                onPress={() => setAdjustDirection("add")}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="add-circle-outline"
                  size={18}
                  color={adjustDirection === "add" ? "#10b981" : "#6b7280"}
                />
                <Text
                  style={[
                    styles.directionText,
                    adjustDirection === "add" && styles.directionTextAdd,
                  ]}
                >
                  Add Stock
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.directionOption,
                  adjustDirection === "remove" && styles.directionOptionRemove,
                ]}
                onPress={() => setAdjustDirection("remove")}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="remove-circle-outline"
                  size={18}
                  color={adjustDirection === "remove" ? "#ef4444" : "#6b7280"}
                />
                <Text
                  style={[
                    styles.directionText,
                    adjustDirection === "remove" && styles.directionTextRemove,
                  ]}
                >
                  Remove Stock
                </Text>
              </TouchableOpacity>
            </View>

            {/* Quantity Input */}
            <View style={styles.modalField}>
              <Text style={styles.modalFieldLabel}>
                Quantity ({item.unit})
              </Text>
              <TextInput
                style={styles.modalInput}
                placeholder="0"
                placeholderTextColor="#6b7280"
                value={adjustQty}
                onChangeText={setAdjustQty}
                keyboardType="decimal-pad"
                autoFocus
              />
            </View>

            {/* Reason Input */}
            <View style={styles.modalField}>
              <Text style={styles.modalFieldLabel}>Reason (optional)</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. Physical count, damage..."
                placeholderTextColor="#6b7280"
                value={adjustReason}
                onChangeText={setAdjustReason}
              />
            </View>

            <TouchableOpacity
              style={[
                styles.modalConfirmButton,
                adjustStock.isPending && styles.modalConfirmButtonDisabled,
              ]}
              onPress={handleAdjustSubmit}
              disabled={adjustStock.isPending}
              activeOpacity={0.8}
            >
              {adjustStock.isPending ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Text style={styles.modalConfirmText}>Confirm Adjustment</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  itemHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 16,
  },
  itemIconLarge: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  itemIconLargeProduct: {
    backgroundColor: "rgba(99,102,241,0.15)",
    borderWidth: 2,
    borderColor: "rgba(99,102,241,0.3)",
  },
  itemIconLargeService: {
    backgroundColor: "rgba(139,92,246,0.15)",
    borderWidth: 2,
    borderColor: "rgba(139,92,246,0.3)",
  },
  itemHeaderInfo: {
    flex: 1,
    gap: 8,
  },
  itemName: {
    fontSize: 20,
    fontWeight: "700",
    color: "#ffffff",
  },
  badgesRow: {
    flexDirection: "row",
    gap: 8,
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
  modeBadgeVariant: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(139,92,246,0.2)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.3)",
  },
  modeBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#a78bfa",
  },
  modeBadgeAlt: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(20,184,166,0.2)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(20,184,166,0.3)",
  },
  modeBadgeTextAlt: {
    fontSize: 12,
    fontWeight: "600",
    color: "#2dd4bf",
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
    marginBottom: 12,
  },
  infoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  infoCell: {
    width: "47%",
    marginBottom: 12,
  },
  infoCellLabel: {
    fontSize: 11,
    color: "#6b7280",
    marginBottom: 3,
  },
  infoCellValue: {
    fontSize: 15,
    fontWeight: "600",
    color: "#ffffff",
  },
  skuValue: {
    fontFamily: "monospace",
    fontSize: 13,
  },
  stockRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  stockNumber: {
    fontSize: 40,
    fontWeight: "800",
    lineHeight: 44,
  },
  stockNormal: {
    color: "#ffffff",
  },
  stockLow: {
    color: "#f59e0b",
  },
  stockUnit: {
    fontSize: 14,
    color: "#6b7280",
    marginTop: 2,
  },
  lowStockAlert: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    backgroundColor: "rgba(245,158,11,0.1)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.2)",
  },
  lowStockText: {
    fontSize: 12,
    color: "#f59e0b",
    fontWeight: "600",
  },
  lowStockThreshold: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 4,
  },
  adjustButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#6366f1",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  adjustButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#ffffff",
  },
  variantRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  variantRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "#2d2d44",
  },
  variantInfo: {
    flex: 1,
  },
  variantAttrs: {
    fontSize: 14,
    fontWeight: "600",
    color: "#ffffff",
  },
  variantSku: {
    fontSize: 11,
    color: "#6b7280",
    fontFamily: "monospace",
    marginTop: 2,
  },
  variantRight: {
    alignItems: "flex-end",
    gap: 2,
  },
  variantPrice: {
    fontSize: 14,
    fontWeight: "600",
    color: "#ffffff",
  },
  variantStock: {
    fontSize: 12,
    color: "#6b7280",
  },
  variantTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#2d2d44",
  },
  variantTotalLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#9ca3af",
  },
  variantTotalValue: {
    fontSize: 13,
    fontWeight: "700",
    color: "#ffffff",
  },
  tabBar: {
    flexDirection: "row",
    marginHorizontal: 20,
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
    fontSize: 13,
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
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 20,
    gap: 12,
  },
  statCard: {
    flex: 1,
    minWidth: "44%",
    backgroundColor: "#1a1a2e",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2d2d44",
    padding: 16,
    alignItems: "center",
  },
  statCardValue: {
    fontSize: 20,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 4,
    textAlign: "center",
  },
  statCardLabel: {
    fontSize: 12,
    color: "#6b7280",
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  historyRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a2e",
  },
  historyLeft: {
    flex: 1,
    gap: 2,
  },
  historyDocNum: {
    fontSize: 14,
    fontWeight: "600",
    color: "#ffffff",
  },
  historyDate: {
    fontSize: 12,
    color: "#6b7280",
  },
  historyParty: {
    fontSize: 12,
    color: "#9ca3af",
  },
  historyRight: {
    alignItems: "flex-end",
    gap: 4,
  },
  historyPrice: {
    fontSize: 15,
    fontWeight: "700",
    color: "#ffffff",
  },
  historyQty: {
    fontSize: 12,
    color: "#6b7280",
  },
  historyTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  historyTypeSale: {
    backgroundColor: "rgba(99,102,241,0.2)",
  },
  historyTypePurchase: {
    backgroundColor: "rgba(245,158,11,0.15)",
  },
  historyTypeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#9ca3af",
  },
  movementRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  movementRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a2e",
  },
  movementArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  movementArrowIn: {
    backgroundColor: "rgba(16,185,129,0.15)",
  },
  movementArrowOut: {
    backgroundColor: "rgba(239,68,68,0.15)",
  },
  movementInfo: {
    flex: 1,
    gap: 2,
  },
  movementDoc: {
    fontSize: 14,
    fontWeight: "600",
    color: "#ffffff",
  },
  movementDate: {
    fontSize: 12,
    color: "#6b7280",
  },
  movementParty: {
    fontSize: 12,
    color: "#9ca3af",
  },
  movementRight: {
    alignItems: "flex-end",
  },
  movementQty: {
    fontSize: 15,
    fontWeight: "700",
  },
  movementQtyIn: {
    color: "#10b981",
  },
  movementQtyOut: {
    color: "#ef4444",
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
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#1a1a2e",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderColor: "#2d2d44",
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: "#2d2d44",
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 16,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#ffffff",
  },
  stockPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
    backgroundColor: "#0f0f1a",
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#2d2d44",
  },
  stockPreviewItem: {
    alignItems: "center",
    gap: 4,
  },
  stockPreviewLabel: {
    fontSize: 12,
    color: "#6b7280",
  },
  stockPreviewValue: {
    fontSize: 28,
    fontWeight: "800",
    color: "#ffffff",
  },
  stockPreviewGreen: {
    color: "#10b981",
  },
  stockPreviewRed: {
    color: "#ef4444",
  },
  directionToggle: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 20,
  },
  directionOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#0f0f1a",
    borderWidth: 1,
    borderColor: "#2d2d44",
  },
  directionOptionAdd: {
    borderColor: "#10b981",
    backgroundColor: "rgba(16,185,129,0.1)",
  },
  directionOptionRemove: {
    borderColor: "#ef4444",
    backgroundColor: "rgba(239,68,68,0.1)",
  },
  directionText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#6b7280",
  },
  directionTextAdd: {
    color: "#10b981",
  },
  directionTextRemove: {
    color: "#ef4444",
  },
  modalField: {
    marginBottom: 16,
  },
  modalFieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#9ca3af",
    marginBottom: 8,
  },
  modalInput: {
    backgroundColor: "#0f0f1a",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2d2d44",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#ffffff",
  },
  modalConfirmButton: {
    backgroundColor: "#6366f1",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 4,
  },
  modalConfirmButtonDisabled: {
    opacity: 0.6,
  },
  modalConfirmText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
  },
});
