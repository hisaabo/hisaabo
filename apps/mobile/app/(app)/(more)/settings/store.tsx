import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Switch,
  Modal,
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState, useEffect, useCallback, useMemo } from "react";
import { trpc } from "../../../../src/lib/trpc";
import { useBusinessStore } from "../../../../src/stores/business";
import { makeStyles } from "../../../../src/lib/makeStyles";
import { useColors } from "../../../../src/contexts/ThemeContext";
import { Skeleton } from "../../../../src/components/ui";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

export default function StoreSettingsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const businessId = useBusinessStore((s) => s.businessId);
  const utils = trpc.useUtils();

  // ── Local form state (null = not yet edited by user) ────────────
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [tagline, setTagline] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);
  const [minOrder, setMinOrder] = useState<string | null>(null);
  const [deliveryNote, setDeliveryNote] = useState<string | null>(null);
  const [allowNegativeStock, setAllowNegativeStock] = useState<boolean | null>(null);

  const [showItemsModal, setShowItemsModal] = useState(false);

  // ── Queries ─────────────────────────────────────────────────────
  const {
    data: settings,
    isLoading,
  } = trpc.store.getSettings.useQuery(undefined, { enabled: !!businessId });

  const { data: enabledCountResp } = trpc.store.listStoreItems.useQuery(
    { limit: 1, page: 1, storeEnabled: true },
    { enabled: !!businessId },
  );
  const { data: totalCountResp } = trpc.store.listStoreItems.useQuery(
    { limit: 1, page: 1 },
    { enabled: !!businessId },
  );
  const enabledItemCount = enabledCountResp?.total ?? 0;
  const totalItemCount = totalCountResp?.total ?? 0;

  // ── Effective values ────────────────────────────────────────────
  const effectiveEnabled = enabled ?? settings?.storeEnabled ?? false;
  const effectiveSlug = slug ?? settings?.storeSlug ?? "";
  const effectiveTagline = tagline ?? settings?.storeTagline ?? "";
  const effectiveWhatsapp = whatsapp ?? settings?.storeWhatsappNumber ?? "";
  const effectiveMinOrder = minOrder ?? settings?.storeMinOrderAmount ?? "";
  const effectiveDeliveryNote = deliveryNote ?? settings?.storeDeliveryNote ?? "";
  const effectiveAllowNegativeStock = allowNegativeStock ?? settings?.storeAllowNegativeStock ?? false;

  const isSlugLocked = !!settings?.storeSlug;

  // ── Slug availability check ─────────────────────────────────────
  const debouncedSlug = useDebounce(effectiveSlug, 500);
  const { data: slugCheck, isFetching: slugChecking } = trpc.store.checkSlug.useQuery(
    { slug: debouncedSlug },
    { enabled: !!businessId && !isSlugLocked && debouncedSlug.length >= 3 },
  );

  const slugStatus: "idle" | "checking" | "available" | "taken" =
    isSlugLocked
      ? "idle"
      : debouncedSlug.length < 3
        ? "idle"
        : slugChecking || slugCheck === undefined
          ? "checking"
          : slugCheck.available
            ? "available"
            : "taken";

  // ── Dirty tracking ──────────────────────────────────────────────
  const isDirty =
    enabled !== null ||
    slug !== null ||
    tagline !== null ||
    whatsapp !== null ||
    minOrder !== null ||
    deliveryNote !== null ||
    allowNegativeStock !== null;

  // ── Mutations ───────────────────────────────────────────────────
  const updateMutation = trpc.store.updateSettings.useMutation({
    onSuccess: () => {
      utils.store.getSettings.invalidate();
      // Reset local edits
      setEnabled(null);
      setSlug(null);
      setTagline(null);
      setWhatsapp(null);
      setMinOrder(null);
      setDeliveryNote(null);
      setAllowNegativeStock(null);
      Alert.alert("Saved", "Store settings updated successfully.");
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to save store settings.");
    },
  });

  const handleSave = () => {
    updateMutation.mutate({
      storeEnabled: effectiveEnabled,
      storeSlug: effectiveSlug || undefined,
      storeTagline: effectiveTagline || undefined,
      storeWhatsappNumber: effectiveWhatsapp || undefined,
      storeMinOrderAmount: effectiveMinOrder || undefined,
      storeDeliveryNote: effectiveDeliveryNote || undefined,
      storeAllowNegativeStock: effectiveAllowNegativeStock,
    });
  };

  // ── Render ──────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Online Store</Text>
        {isDirty ? (
          <TouchableOpacity
            onPress={handleSave}
            style={[
              styles.saveBtn,
              (updateMutation.isPending || slugStatus === "taken") && { opacity: 0.5 },
            ]}
            disabled={updateMutation.isPending || slugStatus === "taken"}
          >
            {updateMutation.isPending ? (
              <ActivityIndicator size="small" color={colors.textPrimary} />
            ) : (
              <Text style={styles.saveBtnText}>Save</Text>
            )}
          </TouchableOpacity>
        ) : (
          <View style={{ width: 60 }} />
        )}
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {isLoading ? (
            <>
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} width="100%" height={56} borderRadius={12} style={{ marginBottom: 12 }} />
              ))}
            </>
          ) : (
            <>
              {/* ── Enable / Disable Toggle ────────────────────── */}
              <View style={styles.card}>
                <View style={styles.toggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.toggleLabel}>Online Store</Text>
                    <Text style={styles.toggleHint}>
                      Allow customers to browse and order online
                    </Text>
                  </View>
                  <Switch
                    value={effectiveEnabled}
                    onValueChange={setEnabled}
                    trackColor={{ false: colors.border, true: colors.brand }}
                    thumbColor={colors.textPrimary}
                  />
                </View>
              </View>

              {/* ── Store URL Slug ─────────────────────────────── */}
              <Text style={styles.sectionLabel}>Store URL</Text>
              <View style={styles.slugRow}>
                <View style={styles.slugPrefix}>
                  <Text style={styles.slugPrefixText} numberOfLines={1}>
                    store.hisaabo.in/
                  </Text>
                </View>
                <TextInput
                  style={[
                    styles.slugInput,
                    isSlugLocked && styles.inputDisabled,
                  ]}
                  value={effectiveSlug}
                  onChangeText={(v) =>
                    !isSlugLocked && setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                  }
                  placeholder="your-business"
                  placeholderTextColor={colors.textMuted}
                  maxLength={50}
                  editable={!isSlugLocked}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {/* Status indicator */}
                {!isSlugLocked && slugStatus === "checking" && (
                  <ActivityIndicator
                    size="small"
                    color={colors.textMuted}
                    style={styles.slugStatusIcon}
                  />
                )}
                {!isSlugLocked && slugStatus === "available" && (
                  <Ionicons
                    name="checkmark-circle"
                    size={20}
                    color={colors.success}
                    style={styles.slugStatusIcon}
                  />
                )}
                {!isSlugLocked && slugStatus === "taken" && (
                  <Ionicons
                    name="close-circle"
                    size={20}
                    color={colors.danger}
                    style={styles.slugStatusIcon}
                  />
                )}
                {isSlugLocked && (
                  <Ionicons
                    name="lock-closed"
                    size={16}
                    color={colors.textMuted}
                    style={styles.slugStatusIcon}
                  />
                )}
              </View>
              {isSlugLocked ? (
                <Text style={styles.slugHintLocked}>
                  Store URL cannot be changed once set
                </Text>
              ) : slugStatus === "taken" ? (
                <Text style={styles.slugHintTaken}>
                  This URL is already taken. Please choose a different one.
                </Text>
              ) : slugStatus === "available" ? (
                <Text style={styles.slugHintAvailable}>
                  This URL is available!
                </Text>
              ) : (
                <Text style={styles.slugHintLocked}>
                  Choose carefully — this cannot be changed later
                </Text>
              )}

              {/* ── Tagline ────────────────────────────────────── */}
              <Field
                label="Store Tagline"
                value={effectiveTagline}
                onChangeText={setTagline}
                placeholder="Fresh organic produce delivered daily"
                maxLength={160}
              />

              {/* ── WhatsApp Number ────────────────────────────── */}
              <Field
                label="WhatsApp Number"
                prefix="+91"
                value={effectiveWhatsapp.replace(/^\+91/, "")}
                onChangeText={(v) => {
                  const digits = v.replace(/\D/g, "").slice(0, 10);
                  setWhatsapp(digits ? `+91${digits}` : "");
                }}
                placeholder="9876543210"
                keyboardType="phone-pad"
                maxLength={10}
                autoCapitalize="none"
              />

              {/* ── Minimum Order Amount ───────────────────────── */}
              <Field
                label="Minimum Order Amount"
                value={effectiveMinOrder}
                onChangeText={setMinOrder}
                placeholder="0"
                keyboardType="decimal-pad"
              />

              {/* ── Delivery Note ──────────────────────────────── */}
              <Field
                label="Delivery Note"
                value={effectiveDeliveryNote}
                onChangeText={setDeliveryNote}
                placeholder="Free delivery above Rs.500"
                maxLength={200}
              />

              {/* ── Allow Low Stock Orders Toggle ──────────────── */}
              <View style={[styles.card, { marginTop: 8 }]}>
                <View style={styles.toggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.toggleLabel}>Allow orders with low stock</Text>
                    <Text style={styles.toggleHint}>
                      Accept orders even when stock is low or zero
                    </Text>
                  </View>
                  <Switch
                    value={effectiveAllowNegativeStock}
                    onValueChange={setAllowNegativeStock}
                    trackColor={{ false: colors.border, true: colors.brand }}
                    thumbColor={colors.textPrimary}
                  />
                </View>
              </View>

              {/* ── Store Items Card ───────────────────────────── */}
              <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Store Items</Text>
              <View style={styles.card}>
                <View style={styles.itemsRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.toggleLabel}>Items on Store</Text>
                    <Text style={styles.toggleHint}>
                      {enabledItemCount} of {totalItemCount} items enabled
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.manageBtn}
                    onPress={() => setShowItemsModal(true)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="settings-outline" size={16} color={colors.brand} />
                    <Text style={styles.manageBtnText}>Manage</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Items Modal */}
      <StoreItemsModal
        visible={showItemsModal}
        onClose={() => setShowItemsModal(false)}
        businessId={businessId}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Field Component
// ---------------------------------------------------------------------------

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  maxLength,
  autoCapitalize,
  prefix,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "phone-pad" | "decimal-pad" | "number-pad";
  maxLength?: number;
  autoCapitalize?: "none" | "words" | "sentences" | "characters";
  prefix?: string;
}) {
  const fieldStyles = useFieldStyles();
  const colors = useColors();
  return (
    <View style={fieldStyles.wrapper}>
      <Text style={fieldStyles.label}>{label}</Text>
      <View style={prefix ? fieldStyles.prefixRow : undefined}>
        {prefix && (
          <View style={fieldStyles.prefixBox}>
            <Text style={fieldStyles.prefixText}>{prefix}</Text>
          </View>
        )}
        <TextInput
          style={[fieldStyles.input, prefix && fieldStyles.inputWithPrefix]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          keyboardType={keyboardType ?? "default"}
          autoCapitalize={autoCapitalize ?? "sentences"}
          maxLength={maxLength}
        />
      </View>
    </View>
  );
}

const useFieldStyles = makeStyles((colors) => ({
  wrapper: {
    marginBottom: 14,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 14,
  },
  prefixRow: {
    flexDirection: "row" as const,
    alignItems: "stretch" as const,
  },
  prefixBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    paddingHorizontal: 12,
    justifyContent: "center" as const,
    borderRightWidth: 0,
  },
  prefixText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "600" as const,
  },
  inputWithPrefix: {
    flex: 1,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
  },
}));

// ---------------------------------------------------------------------------
// Store Items Modal
// ---------------------------------------------------------------------------

type FilterTab = "all" | "in_store" | "not_in_store";

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: "all", label: "All Items" },
  { key: "in_store", label: "In Store" },
  { key: "not_in_store", label: "Not in Store" },
];

function StoreItemsModal({
  visible,
  onClose,
  businessId,
}: {
  visible: boolean;
  onClose: () => void;
  businessId: string | null;
}) {
  const modalStyles = useModalStyles();
  const colors = useColors();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [pendingChanges, setPendingChanges] = useState<Map<string, boolean>>(new Map());

  const debouncedSearch = useDebounce(search, 300);

  // Build the storeEnabled filter based on active tab
  const storeEnabledFilter =
    activeTab === "in_store" ? true : activeTab === "not_in_store" ? false : undefined;

  const { data: itemsResponse, isLoading } = trpc.store.listStoreItems.useQuery(
    {
      limit: 100,
      page: 1,
      search: debouncedSearch || undefined,
      storeEnabled: storeEnabledFilter,
    },
    { enabled: visible && !!businessId },
  );
  const items: any[] = itemsResponse?.data ?? [];

  // Fetch counts for each tab (lightweight queries with limit: 1)
  const { data: allCountResp } = trpc.store.listStoreItems.useQuery(
    { limit: 1, page: 1 },
    { enabled: visible && !!businessId },
  );
  const { data: enabledCountResp } = trpc.store.listStoreItems.useQuery(
    { limit: 1, page: 1, storeEnabled: true },
    { enabled: visible && !!businessId },
  );
  const totalItemCount = allCountResp?.total ?? 0;
  const enabledItemCount = enabledCountResp?.total ?? 0;
  const disabledItemCount = totalItemCount - enabledItemCount;

  const toggleMut = trpc.store.bulkToggleItems.useMutation({
    onSuccess: () => {
      utils.store.listStoreItems.invalidate();
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to update items.");
    },
  });

  const getEffectiveEnabled = useCallback(
    (item: { id: string; storeEnabled: boolean }): boolean => {
      return pendingChanges.has(item.id)
        ? pendingChanges.get(item.id)!
        : item.storeEnabled;
    },
    [pendingChanges],
  );

  // Sort items: store-enabled first in "All Items" tab, then alphabetical
  const sortedItems = useMemo(() => {
    const sorted = [...items];
    sorted.sort((a, b) => {
      if (activeTab === "all") {
        const aEnabled = getEffectiveEnabled(a);
        const bEnabled = getEffectiveEnabled(b);
        if (aEnabled !== bEnabled) return aEnabled ? -1 : 1;
      }
      return (a.name as string).localeCompare(b.name as string);
    });
    return sorted;
  }, [items, activeTab, getEffectiveEnabled]);

  const toggleItem = useCallback((id: string, currentlyEnabled: boolean) => {
    setPendingChanges((prev) => {
      const next = new Map(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.set(id, !currentlyEnabled);
      }
      return next;
    });
  }, []);

  const changeCount = pendingChanges.size;

  // Compute effective summary counts accounting for pending changes
  const effectiveEnabledCount = useMemo(() => {
    let count = enabledItemCount;
    for (const [, willEnable] of pendingChanges) {
      if (willEnable) count += 1;
      else count -= 1;
    }
    return Math.max(0, count);
  }, [enabledItemCount, pendingChanges]);

  const applyChanges = async () => {
    const toEnable = [...pendingChanges.entries()]
      .filter(([, v]) => v)
      .map(([id]) => id);
    const toDisable = [...pendingChanges.entries()]
      .filter(([, v]) => !v)
      .map(([id]) => id);

    if (toEnable.length > 0) {
      await toggleMut.mutateAsync({ itemIds: toEnable, storeEnabled: true });
    }
    if (toDisable.length > 0) {
      await toggleMut.mutateAsync({ itemIds: toDisable, storeEnabled: false });
    }

    setPendingChanges(new Map());
    await utils.store.listStoreItems.invalidate();
    onClose();
  };

  const handleClose = () => {
    setPendingChanges(new Map());
    setSearch("");
    setActiveTab("all");
    onClose();
  };

  const getEmptyMessage = (): string => {
    if (search) return "No items match your search";
    if (activeTab === "in_store") return "No items are in the store yet. Switch to \"All Items\" to add some.";
    if (activeTab === "not_in_store") return "All items are already in the store!";
    return "No items found. Create items first to add them to your store.";
  };

  const getTabCount = (tab: FilterTab): number => {
    if (tab === "all") return totalItemCount;
    if (tab === "in_store") return enabledItemCount;
    return disabledItemCount;
  };

  const renderItem = useCallback(
    ({ item }: { item: any }) => {
      const isEnabled = getEffectiveEnabled(item);
      const isPending = pendingChanges.has(item.id);
      const isProduct = item.itemType === "product";

      return (
        <TouchableOpacity
          style={[
            modalStyles.itemRow,
            isPending && modalStyles.itemRowPending,
          ]}
          onPress={() => toggleItem(item.id, item.storeEnabled)}
          activeOpacity={0.7}
        >
          {/* Checkbox icon */}
          <Ionicons
            name={isEnabled ? "checkbox" : "square-outline"}
            size={24}
            color={isEnabled ? colors.brand : colors.textMuted}
          />

          {/* Item details */}
          <View style={modalStyles.itemContent}>
            <View style={modalStyles.itemNameRow}>
              <Text style={modalStyles.itemName} numberOfLines={1}>
                {item.name}
              </Text>
              {isPending && (
                <View style={modalStyles.modifiedBadge}>
                  <Text style={modalStyles.modifiedBadgeText}>Modified</Text>
                </View>
              )}
            </View>
            <View style={modalStyles.itemMetaRow}>
              <View style={[modalStyles.typeBadge, isProduct ? modalStyles.typeBadgeProduct : modalStyles.typeBadgeService]}>
                <Text style={[modalStyles.typeBadgeText, isProduct ? modalStyles.typeBadgeTextProduct : modalStyles.typeBadgeTextService]}>
                  {isProduct ? "Product" : "Service"}
                </Text>
              </View>
              <Text style={modalStyles.itemMeta} numberOfLines={1}>
                Rs.{item.salePrice ?? "0"} / {item.unit}
              </Text>
              {!isPending && isEnabled && (
                <View style={modalStyles.inStoreDot} />
              )}
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [getEffectiveEnabled, pendingChanges, toggleItem],
  );

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="slide"
      onRequestClose={handleClose}
    >
      <SafeAreaView style={modalStyles.fullScreen}>
        {/* Header */}
        <View style={modalStyles.header}>
          <TouchableOpacity onPress={handleClose} style={modalStyles.closeBtn}>
            <Ionicons name="close" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={modalStyles.title}>Manage Store Items</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Search */}
        <View style={modalStyles.searchWrapper}>
          <Ionicons name="search" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
          <TextInput
            style={modalStyles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search items..."
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter tabs */}
        <View style={modalStyles.tabBar}>
          {FILTER_TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            const count = getTabCount(tab.key);
            return (
              <TouchableOpacity
                key={tab.key}
                style={[modalStyles.tab, isActive && modalStyles.tabActive]}
                onPress={() => setActiveTab(tab.key)}
                activeOpacity={0.7}
              >
                <Text style={[modalStyles.tabText, isActive && modalStyles.tabTextActive]}>
                  {tab.label}
                </Text>
                <View style={[modalStyles.tabCountBadge, isActive && modalStyles.tabCountBadgeActive]}>
                  <Text style={[modalStyles.tabCountText, isActive && modalStyles.tabCountTextActive]}>
                    {count}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Item list */}
        {isLoading ? (
          <View style={{ padding: 20 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} width="100%" height={56} borderRadius={10} style={{ marginBottom: 8 }} />
            ))}
          </View>
        ) : sortedItems.length === 0 ? (
          <View style={modalStyles.emptyState}>
            <Ionicons
              name={activeTab === "not_in_store" ? "checkmark-done-circle-outline" : "cube-outline"}
              size={40}
              color={colors.textMuted}
            />
            <Text style={modalStyles.emptyText}>{getEmptyMessage()}</Text>
          </View>
        ) : (
          <FlatList
            data={sortedItems}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            style={modalStyles.list}
            contentContainerStyle={modalStyles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          />
        )}

        {/* Summary bar + apply button */}
        <View style={modalStyles.footer}>
          <View style={modalStyles.summaryRow}>
            <Ionicons name="storefront-outline" size={16} color={colors.textMuted} />
            <Text style={modalStyles.summaryText}>
              {effectiveEnabledCount} of {totalItemCount} items in store
            </Text>
            {changeCount > 0 && (
              <View style={modalStyles.changesBadge}>
                <Text style={modalStyles.changesBadgeText}>
                  {changeCount} change{changeCount !== 1 ? "s" : ""}
                </Text>
              </View>
            )}
          </View>
          <View style={modalStyles.footerActions}>
            <TouchableOpacity
              style={modalStyles.cancelBtn}
              onPress={handleClose}
              disabled={toggleMut.isPending}
            >
              <Text style={modalStyles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                modalStyles.applyBtn,
                (changeCount === 0 || toggleMut.isPending) && { opacity: 0.4 },
              ]}
              onPress={applyChanges}
              disabled={changeCount === 0 || toggleMut.isPending}
            >
              {toggleMut.isPending ? (
                <ActivityIndicator size="small" color={colors.textPrimary} />
              ) : (
                <Text style={modalStyles.applyBtnText}>
                  Apply {changeCount > 0 ? `${changeCount} ` : ""}Change{changeCount !== 1 ? "s" : ""}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Modal Styles
// ---------------------------------------------------------------------------

const useModalStyles = makeStyles((colors) => ({
  fullScreen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  searchWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 14,
  },
  // Filter tabs
  tabBar: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginBottom: 4,
    gap: 6,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: {
    backgroundColor: colors.brandLight,
    borderColor: colors.brand,
  },
  tabText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  tabTextActive: {
    color: colors.brand,
  },
  tabCountBadge: {
    backgroundColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    minWidth: 22,
    alignItems: "center",
  },
  tabCountBadgeActive: {
    backgroundColor: colors.brand,
  },
  tabCountText: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.textMuted,
  },
  tabCountTextActive: {
    color: colors.textPrimary,
  },
  // List
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },
  // Item row
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemRowPending: {
    backgroundColor: colors.brandLight,
    marginHorizontal: -8,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderBottomColor: "transparent",
  },
  itemContent: {
    flex: 1,
    minWidth: 0,
  },
  itemNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  itemName: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
    flexShrink: 1,
  },
  itemMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  typeBadgeProduct: {
    backgroundColor: colors.infoBg,
  },
  typeBadgeService: {
    backgroundColor: colors.warningBg,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  typeBadgeTextProduct: {
    color: colors.info,
  },
  typeBadgeTextService: {
    color: colors.warning,
  },
  itemMeta: {
    fontSize: 11,
    color: colors.textMuted,
    flexShrink: 1,
  },
  inStoreDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
  },
  modifiedBadge: {
    backgroundColor: colors.amberBg,
    borderWidth: 1,
    borderColor: colors.amber + "40",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  modifiedBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: colors.amber,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  // Footer
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
  },
  summaryText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: "500",
    flex: 1,
  },
  changesBadge: {
    backgroundColor: colors.brandLight,
    borderWidth: 1,
    borderColor: colors.brand + "40",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  changesBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.brand,
  },
  footerActions: {
    flexDirection: "row",
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelBtnText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: "600",
  },
  applyBtn: {
    flex: 2,
    backgroundColor: colors.brand,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  applyBtnText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
}));

// ---------------------------------------------------------------------------
// Screen Styles
// ---------------------------------------------------------------------------

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
  saveBtn: {
    backgroundColor: colors.brand,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    minWidth: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: { color: colors.textPrimary, fontWeight: "700", fontSize: 14 },
  content: { padding: 16, paddingBottom: 48 },

  // Section label
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 8,
  },

  // Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 14,
  },

  // Toggle row
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  toggleHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },

  // Slug
  slugRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  slugPrefix: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRightWidth: 0,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 12,
    justifyContent: "center",
  },
  slugPrefixText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  slugInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 14,
  },
  inputDisabled: {
    backgroundColor: colors.bg,
    color: colors.textMuted,
  },
  slugStatusIcon: {
    position: "absolute",
    right: 12,
  },
  slugHintLocked: {
    fontSize: 11,
    color: colors.amber,
    marginBottom: 14,
    marginTop: 4,
  },
  slugHintTaken: {
    fontSize: 11,
    color: colors.danger,
    marginBottom: 14,
    marginTop: 4,
  },
  slugHintAvailable: {
    fontSize: 11,
    color: colors.success,
    marginBottom: 14,
    marginTop: 4,
  },

  // Items row
  itemsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  manageBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.brandLight,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  manageBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.brand,
  },
}));
