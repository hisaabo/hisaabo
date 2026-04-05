import {
  View,
  Text,
  StyleSheet,
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
import { useState, useEffect, useCallback } from "react";
import { trpc } from "../../../../src/lib/trpc";
import { useBusinessStore } from "../../../../src/stores/business";
import { colors } from "../../../../src/lib/theme";
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

const fieldStyles = StyleSheet.create({
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
});

// ---------------------------------------------------------------------------
// Store Items Modal
// ---------------------------------------------------------------------------

function StoreItemsModal({
  visible,
  onClose,
  businessId,
}: {
  visible: boolean;
  onClose: () => void;
  businessId: string | null;
}) {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [pendingChanges, setPendingChanges] = useState<Map<string, boolean>>(new Map());

  const debouncedSearch = useDebounce(search, 300);

  const { data: itemsResponse, isLoading } = trpc.store.listStoreItems.useQuery(
    { limit: 100, page: 1, search: debouncedSearch || undefined },
    { enabled: visible && !!businessId },
  );
  const items: any[] = itemsResponse?.data ?? [];

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
    onClose();
  };

  const renderItem = useCallback(
    ({ item }: { item: any }) => {
      const isEnabled = getEffectiveEnabled(item);
      const isPending = pendingChanges.has(item.id);

      return (
        <TouchableOpacity
          style={[
            modalStyles.itemRow,
            isPending && modalStyles.itemRowPending,
          ]}
          onPress={() => toggleItem(item.id, item.storeEnabled)}
          activeOpacity={0.7}
        >
          <View
            style={[
              modalStyles.checkbox,
              isEnabled && modalStyles.checkboxActive,
            ]}
          >
            {isEnabled && (
              <Ionicons name="checkmark" size={14} color={colors.textPrimary} />
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={modalStyles.itemName} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={modalStyles.itemMeta} numberOfLines={1}>
              {item.category || "Uncategorized"} · Rs.{item.salePrice ?? "0"} / {item.unit}
            </Text>
          </View>
          {isPending && (
            <View style={modalStyles.pendingBadge}>
              <Text style={modalStyles.pendingBadgeText}>
                {isEnabled ? "Adding" : "Removing"}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [getEffectiveEnabled, pendingChanges, toggleItem],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={modalStyles.overlay}>
        <View style={modalStyles.sheet}>
          {/* Header */}
          <View style={modalStyles.header}>
            <Text style={modalStyles.title}>Manage Store Items</Text>
            <TouchableOpacity onPress={handleClose} style={modalStyles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
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
          </View>

          {/* Item list */}
          {isLoading ? (
            <View style={{ padding: 20 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} width="100%" height={48} borderRadius={10} style={{ marginBottom: 8 }} />
              ))}
            </View>
          ) : items.length === 0 ? (
            <View style={modalStyles.emptyState}>
              <Ionicons name="cube-outline" size={32} color={colors.textMuted} />
              <Text style={modalStyles.emptyText}>
                {search ? "No items match your search" : "No items found"}
              </Text>
            </View>
          ) : (
            <FlatList
              data={items}
              renderItem={renderItem}
              keyExtractor={(item) => item.id}
              style={modalStyles.list}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            />
          )}

          {/* Footer */}
          <View style={modalStyles.footer}>
            <Text style={modalStyles.footerText}>
              {changeCount > 0
                ? `${changeCount} change${changeCount > 1 ? "s" : ""} pending`
                : "Tap items to add or remove"}
            </Text>
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
                    Apply {changeCount > 0 ? changeCount : ""} Change{changeCount !== 1 ? "s" : ""}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Modal Styles
// ---------------------------------------------------------------------------

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  searchWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 14,
  },
  list: {
    paddingHorizontal: 20,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
  },
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
    borderRadius: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  itemName: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  itemMeta: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  pendingBadge: {
    backgroundColor: colors.amberBg,
    borderWidth: 1,
    borderColor: colors.amber + "40",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  pendingBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: colors.amber,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerText: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 12,
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
});

// ---------------------------------------------------------------------------
// Screen Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
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
});
