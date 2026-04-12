import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Modal,
  FlatList,
  SectionList,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../src/lib/trpc";
import { formatCurrency } from "../../../src/lib/utils";
import { calcInvoiceTotals } from "@hisaabo/shared";
import { colors } from "../../../src/lib/theme";
import { haptic } from "../../../src/lib/haptics";
import { useContacts, type PhoneContact } from "../../../src/hooks/useContacts";
import { DatePickerField } from "../../../src/components/ui";
import { LineItemNotesField } from "../../../src/components/LineItemNotesField";

type InvoiceType = "sale" | "purchase";

interface LineItem {
  itemId?: string;
  // G-08: variant/alt-unit selection
  variantId?: string;
  selectedUnit?: string;
  conversionFactor?: string;
  // item mode cached from the selected item so sub-selectors can render
  itemMode?: "simple" | "alt_units" | "variants";
  /**
   * Bug B: snapshot of the product name at billing time. This is the primary
   * line-item display and is frozen into the invoice so later item renames
   * don't rewrite history. Required.
   */
  itemName: string;
  /**
   * Bug B: optional free-text per-line note (e.g. "Keep separate from
   * order #42"). Maps to the wire-format `description` field when
   * submitting to the backend.
   */
  notes: string;
  quantity: string;
  unitPrice: string;
  taxPercent: string;
  discountPercent: string;
}

function newLineItem(): LineItem {
  return {
    itemName: "",
    notes: "",
    quantity: "1",
    unitPrice: "0",
    taxPercent: "0",
    discountPercent: "0",
  };
}

// ── Helpers ────────────────────────────────────────────────────

function todayDate() {
  return new Date();
}

function in30daysDate() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d;
}

function safeNum(s: string) {
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/** Simple debounce hook */
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ── Phone number normalization for de-duplication ──────────────

function normalizePhone(p: string): string {
  return p.replace(/\D/g, "").slice(-10);
}

// ── Party Picker Modal ──────────────────────────────────────────

interface PartyPickerProps {
  visible: boolean;
  type: InvoiceType;
  onSelect: (party: { id: string; name: string; phone?: string | null }) => void;
  onClose: () => void;
}

type PickerSection = {
  title: string;
  data: PickerRow[];
};

type PickerRow =
  | { kind: "party"; id: string; name: string; phone?: string | null }
  | { kind: "contact"; contact: PhoneContact };

// OPT-03: Inline party creation form state
interface InlinePartyFormState {
  name: string;
  phone: string;
  type: "customer" | "supplier";
}

function PartyPickerModal({ visible, type, onSelect, onClose }: PartyPickerProps) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const partyType = type === "sale" ? "customer" : "supplier";

  const { contacts, permission, requestAccess } = useContacts();
  const [creatingFromContact, setCreatingFromContact] = useState(false);

  // OPT-03: inline create form
  const [showInlineCreate, setShowInlineCreate] = useState(false);
  const [inlineForm, setInlineForm] = useState<InlinePartyFormState>({ name: "", phone: "", type: partyType });

  const { data, isLoading } = trpc.party.list.useQuery(
    { type: partyType, search: debouncedSearch || undefined, page: 1, limit: 50 },
    { enabled: visible }
  );

  const createPartyMutation = trpc.party.create.useMutation();

  const parties = data?.data ?? [];

  // Build a set of normalized party phone numbers for de-duplication
  const partyPhones = useMemo(() => {
    const set = new Set<string>();
    for (const p of parties) {
      if (p.phone) set.add(normalizePhone(p.phone));
    }
    return set;
  }, [parties]);

  // Filter contacts: remove those already matching an existing party by phone
  const uniqueContacts = useMemo(() => {
    if (permission !== "granted") return [];
    return contacts.filter(
      (c) => c.phone && !partyPhones.has(normalizePhone(c.phone))
    );
  }, [contacts, partyPhones, permission]);

  // Apply search filter to contacts
  const filteredContacts = useMemo(() => {
    if (!debouncedSearch) return uniqueContacts;
    const q = debouncedSearch.toLowerCase();
    return uniqueContacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone && c.phone.includes(debouncedSearch))
    );
  }, [uniqueContacts, debouncedSearch]);

  // Build sections for SectionList
  const sections = useMemo<PickerSection[]>(() => {
    const result: PickerSection[] = [];

    const partyRows: PickerRow[] = parties.map((p) => ({
      kind: "party" as const,
      id: p.id,
      name: p.name,
      phone: p.phone,
    }));

    if (partyRows.length > 0) {
      result.push({ title: "Your Parties", data: partyRows });
    }

    if (permission === "granted" && filteredContacts.length > 0) {
      const contactRows: PickerRow[] = filteredContacts.map((c) => ({
        kind: "contact" as const,
        contact: c,
      }));
      result.push({ title: "Phone Contacts", data: contactRows });
    }

    return result;
  }, [parties, filteredContacts, permission]);

  const handleContactSelect = useCallback(
    async (contact: PhoneContact) => {
      Alert.alert(
        "Create party from contact?",
        `${contact.name}${contact.phone ? `\n${contact.phone}` : ""}`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Create",
            onPress: async () => {
              setCreatingFromContact(true);
              try {
                const newParty = await createPartyMutation.mutateAsync({
                  type: partyType,
                  name: contact.name,
                  phone: contact.phone || undefined,
                  email: contact.email || undefined,
                });
                haptic.success();
                Alert.alert("Party created from contact");
                onSelect({ id: newParty.id, name: newParty.name, phone: newParty.phone });
                onClose();
              } catch (err: any) {
                haptic.error();
                Alert.alert("Error", err?.message ?? "Failed to create party");
              } finally {
                setCreatingFromContact(false);
              }
            },
          },
        ]
      );
    },
    [partyType, createPartyMutation, onSelect, onClose]
  );

  const isEmpty = !isLoading && sections.length === 0;

  // OPT-03: submit inline party creation
  const handleInlineCreate = useCallback(async () => {
    if (!inlineForm.name.trim()) {
      Alert.alert("Validation", "Name is required.");
      return;
    }
    if (!inlineForm.phone.trim()) {
      Alert.alert("Validation", "Phone is required.");
      return;
    }
    setCreatingFromContact(true);
    try {
      const newParty = await createPartyMutation.mutateAsync({
        type: inlineForm.type,
        name: inlineForm.name.trim(),
        phone: inlineForm.phone.trim(),
      });
      haptic.success();
      onSelect({ id: newParty.id, name: newParty.name, phone: newParty.phone });
      setShowInlineCreate(false);
      onClose();
    } catch (err: any) {
      haptic.error();
      Alert.alert("Error", err?.message ?? "Failed to create party");
    } finally {
      setCreatingFromContact(false);
    }
  }, [inlineForm, createPartyMutation, onSelect, onClose]);

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={modalStyles.overlay}>
        <View style={modalStyles.sheet}>
          <View style={modalStyles.header}>
            <Text style={modalStyles.title}>
              Select {type === "sale" ? "Customer" : "Supplier"}
            </Text>
            <TouchableOpacity onPress={onClose} style={modalStyles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={modalStyles.searchWrap}>
            <Ionicons name="search-outline" size={15} color={colors.textMuted} style={modalStyles.searchIcon} />
            <TextInput
              style={modalStyles.searchInput}
              placeholder="Search parties & contacts..."
              placeholderTextColor={colors.textMuted}
              value={search}
              onChangeText={(v) => {
                setSearch(v);
                // Reset inline form if search changes
                if (showInlineCreate) setShowInlineCreate(false);
              }}
              autoFocus
              returnKeyType="search"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => { setSearch(""); setShowInlineCreate(false); }}>
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Permission prompt banner */}
          {permission === "undetermined" && (
            <View style={pickerStyles.permissionBanner}>
              <View style={pickerStyles.permissionBannerContent}>
                <Ionicons name="phone-portrait-outline" size={20} color={colors.info} />
                <View style={pickerStyles.permissionBannerText}>
                  <Text style={pickerStyles.permissionTitle}>Import from contacts</Text>
                  <Text style={pickerStyles.permissionSubtitle}>
                    Allow access to show your phone contacts alongside your parties.
                  </Text>
                </View>
              </View>
              <View style={pickerStyles.permissionActions}>
                <TouchableOpacity
                  onPress={() => {
                    // Dismiss by doing nothing — permission stays undetermined
                    // but we won't show the banner again this session
                  }}
                  style={pickerStyles.permissionBtnSecondary}
                >
                  <Text style={pickerStyles.permissionBtnSecondaryText}>Not now</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={requestAccess} style={pickerStyles.permissionBtnPrimary}>
                  <Text style={pickerStyles.permissionBtnPrimaryText}>Allow</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Loading overlay for party creation from contact or inline create */}
          {creatingFromContact && (
            <View style={pickerStyles.creatingOverlay}>
              <ActivityIndicator color={colors.brand} size="small" />
              <Text style={pickerStyles.creatingText}>Creating party...</Text>
            </View>
          )}

          {/* OPT-03: Inline create form */}
          {showInlineCreate && (
            <View style={inlineCreateStyles.container}>
              <View style={inlineCreateStyles.header}>
                <Ionicons name="person-add-outline" size={16} color={colors.brand} />
                <Text style={inlineCreateStyles.title}>New {type === "sale" ? "Customer" : "Supplier"}</Text>
              </View>
              <TextInput
                style={inlineCreateStyles.input}
                value={inlineForm.name}
                onChangeText={(v) => setInlineForm((f) => ({ ...f, name: v }))}
                placeholder="Name *"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="words"
              />
              <TextInput
                style={inlineCreateStyles.input}
                value={inlineForm.phone}
                onChangeText={(v) => setInlineForm((f) => ({ ...f, phone: v }))}
                placeholder="Phone *"
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
              />
              <View style={inlineCreateStyles.typeRow}>
                {(["customer", "supplier"] as const).map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[inlineCreateStyles.typePill, inlineForm.type === t && inlineCreateStyles.typePillActive]}
                    onPress={() => setInlineForm((f) => ({ ...f, type: t }))}
                    activeOpacity={0.7}
                  >
                    <Text style={[inlineCreateStyles.typePillText, inlineForm.type === t && inlineCreateStyles.typePillTextActive]}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={inlineCreateStyles.actions}>
                <TouchableOpacity
                  style={inlineCreateStyles.cancelBtn}
                  onPress={() => setShowInlineCreate(false)}
                >
                  <Text style={inlineCreateStyles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[inlineCreateStyles.createBtn, creatingFromContact && inlineCreateStyles.createBtnDisabled]}
                  onPress={handleInlineCreate}
                  disabled={creatingFromContact}
                >
                  {creatingFromContact ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={inlineCreateStyles.createBtnText}>Create & Select</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {isLoading ? (
            <ActivityIndicator style={{ marginTop: 32 }} color={colors.brand} />
          ) : isEmpty ? (
            <View>
              <Text style={modalStyles.emptyText}>
                {debouncedSearch ? `No parties found for "${debouncedSearch}"` : "No parties yet"}
              </Text>
              {/* OPT-03: create button when search returns empty */}
              {!showInlineCreate && (
                <TouchableOpacity
                  style={inlineCreateStyles.createFromSearchBtn}
                  onPress={() => {
                    setInlineForm({ name: debouncedSearch || "", phone: "", type: partyType });
                    setShowInlineCreate(true);
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="person-add-outline" size={16} color={colors.brand} />
                  <Text style={inlineCreateStyles.createFromSearchBtnText}>
                    {debouncedSearch ? `Create "${debouncedSearch}" as new ${type === "sale" ? "customer" : "supplier"}` : `Create new ${type === "sale" ? "customer" : "supplier"}`}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <SectionList
              sections={sections}
              keyExtractor={(item, _index) =>
                item.kind === "party" ? item.id : `contact-${item.contact.id}`
              }
              contentContainerStyle={modalStyles.listContent}
              stickySectionHeadersEnabled={false}
              renderSectionHeader={({ section }) => (
                <Text style={pickerStyles.sectionHeader}>{section.title}</Text>
              )}
              ListFooterComponent={
                debouncedSearch && !showInlineCreate ? (
                  <TouchableOpacity
                    style={inlineCreateStyles.createFromSearchBtn}
                    onPress={() => {
                      setInlineForm({ name: debouncedSearch, phone: "", type: partyType });
                      setShowInlineCreate(true);
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="person-add-outline" size={16} color={colors.brand} />
                    <Text style={inlineCreateStyles.createFromSearchBtnText}>
                      Create "{debouncedSearch}" as new {type === "sale" ? "customer" : "supplier"}
                    </Text>
                  </TouchableOpacity>
                ) : null
              }
              renderItem={({ item }) => {
                if (item.kind === "party") {
                  return (
                    <TouchableOpacity
                      style={modalStyles.listItem}
                      onPress={() => {
                        onSelect({ id: item.id, name: item.name, phone: item.phone });
                        onClose();
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={[modalStyles.listItemIcon, pickerStyles.partyIcon]}>
                        <Ionicons name="person-outline" size={16} color={colors.info} />
                      </View>
                      <View style={modalStyles.listItemContent}>
                        <Text style={modalStyles.listItemName}>{item.name}</Text>
                        {item.phone && (
                          <Text style={modalStyles.listItemSub}>{item.phone}</Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                }

                // Contact row
                const contact = item.contact;
                return (
                  <TouchableOpacity
                    style={modalStyles.listItem}
                    onPress={() => handleContactSelect(contact)}
                    activeOpacity={0.7}
                    disabled={creatingFromContact}
                  >
                    <View style={[modalStyles.listItemIcon, pickerStyles.contactIcon]}>
                      <Ionicons name="call-outline" size={16} color={colors.success} />
                    </View>
                    <View style={modalStyles.listItemContent}>
                      <Text style={modalStyles.listItemName}>{contact.name}</Text>
                      {contact.phone && (
                        <Text style={modalStyles.listItemSub}>{contact.phone}</Text>
                      )}
                    </View>
                    <View style={pickerStyles.newBadge}>
                      <Text style={pickerStyles.newBadgeText}>NEW</Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const pickerStyles = StyleSheet.create({
  sectionHeader: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingTop: 16,
    paddingBottom: 8,
  },
  partyIcon: {
    backgroundColor: colors.infoBg,
  },
  contactIcon: {
    backgroundColor: colors.successBg,
  },
  newBadge: {
    backgroundColor: colors.successBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  newBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.success,
  },
  permissionBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: colors.infoBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.info + "30",
    padding: 14,
  },
  permissionBannerContent: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  permissionBannerText: {
    flex: 1,
  },
  permissionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: 2,
  },
  permissionSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  permissionActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 10,
    gap: 10,
  },
  permissionBtnSecondary: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  permissionBtnSecondaryText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
  },
  permissionBtnPrimary: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: colors.info,
    borderRadius: 8,
  },
  permissionBtnPrimaryText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  creatingOverlay: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    gap: 8,
  },
  creatingText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
});

// ── OPT-03: Inline party create styles ────────────────────────

const inlineCreateStyles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: colors.bg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.brand + "40",
    padding: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: 8,
  },
  typeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  typePill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typePillActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  typePillText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  typePillTextActive: {
    color: "#fff",
  },
  actions: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  createBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: colors.brand,
    minWidth: 110,
    alignItems: "center",
  },
  createBtnDisabled: {
    opacity: 0.6,
  },
  createBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
  },
  createFromSearchBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.brand + "60",
    backgroundColor: colors.brand + "08",
  },
  createFromSearchBtnText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: colors.brand,
  },
});

// ── Item Picker Modal ──────────────────────────────────────────

// Shape of a unit variant entry from the DB JSON column
interface UnitVariant {
  unit: string;
  conversionFactor: number;
  salePrice: string;
  purchasePrice?: string | null;
}

interface ItemPickerProps {
  visible: boolean;
  invoiceType: InvoiceType;
  onSelect: (item: {
    id: string;
    name: string;
    salePrice?: string | null;
    purchasePrice?: string | null;
    taxPercent: string;
    itemMode?: string | null;
    unitVariants?: UnitVariant[] | null;
  }) => void;
  onClose: () => void;
}

function ItemPickerModal({ visible, invoiceType, onSelect, onClose }: ItemPickerProps) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading } = trpc.item.list.useQuery(
    { search: debouncedSearch || undefined, page: 1, limit: 50 },
    { enabled: visible }
  );

  const items = data?.data ?? [];

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={modalStyles.overlay}>
        <View style={modalStyles.sheet}>
          <View style={modalStyles.header}>
            <Text style={modalStyles.title}>Select Item</Text>
            <TouchableOpacity onPress={onClose} style={modalStyles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={modalStyles.searchWrap}>
            <Ionicons name="search-outline" size={15} color={colors.textMuted} style={modalStyles.searchIcon} />
            <TextInput
              style={modalStyles.searchInput}
              placeholder="Search items..."
              placeholderTextColor={colors.textMuted}
              value={search}
              onChangeText={setSearch}
              autoFocus
              returnKeyType="search"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch("")}>
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {isLoading ? (
            <ActivityIndicator style={{ marginTop: 32 }} color={colors.brand} />
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item) => item.id}
              contentContainerStyle={modalStyles.listContent}
              renderItem={({ item }) => {
                const price =
                  invoiceType === "purchase"
                    ? item.purchasePrice ?? item.salePrice
                    : item.salePrice;
                const hasVariants = item.itemMode === "variants";
                const hasAltUnits = item.itemMode === "alt_units";
                return (
                  <TouchableOpacity
                    style={modalStyles.listItem}
                    onPress={() => {
                      onSelect({
                        id: item.id,
                        name: item.name,
                        salePrice: item.salePrice,
                        purchasePrice: item.purchasePrice,
                        taxPercent: item.taxPercent,
                        itemMode: item.itemMode,
                        unitVariants: (item.unitVariants as UnitVariant[] | null) ?? null,
                      });
                      onClose();
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={modalStyles.listItemIcon}>
                      <Ionicons name="cube-outline" size={16} color={colors.brand} />
                    </View>
                    <View style={modalStyles.listItemContent}>
                      <View style={itemPickerStyles.itemNameRow}>
                        <Text style={modalStyles.listItemName}>{item.name}</Text>
                        {hasVariants && (
                          <View style={itemPickerStyles.modeBadge}>
                            <Text style={itemPickerStyles.modeBadgeText}>VARIANTS</Text>
                          </View>
                        )}
                        {hasAltUnits && (
                          <View style={[itemPickerStyles.modeBadge, itemPickerStyles.modeBadgeAlt]}>
                            <Text style={itemPickerStyles.modeBadgeText}>UNITS</Text>
                          </View>
                        )}
                      </View>
                      <Text style={modalStyles.listItemSub}>
                        {price ? formatCurrency(price) : "No price"} · GST {item.taxPercent}%
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={modalStyles.emptyText}>No items found</Text>
              }
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Item picker badge styles ──────────────────────────────────

const itemPickerStyles = StyleSheet.create({
  itemNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  modeBadge: {
    backgroundColor: colors.brand + "20",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  modeBadgeAlt: {
    backgroundColor: colors.info + "20",
  },
  modeBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: colors.brand,
    letterSpacing: 0.3,
  },
});

// ── G-08: Sub-selector styles ─────────────────────────────────

const subSelectorStyles = StyleSheet.create({
  container: {
    marginBottom: 10,
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  pillBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    alignSelf: "flex-start",
    minWidth: 140,
  },
  pillBtnSelected: {
    borderColor: colors.brand + "60",
    backgroundColor: colors.brand + "12",
  },
  pillText: {
    flex: 1,
    fontSize: 13,
    color: colors.textMuted,
  },
  pillTextSelected: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: colors.brand,
  },
  warningText: {
    fontSize: 11,
    color: colors.warning,
    marginTop: 4,
  },
  listItemSelected: {
    backgroundColor: colors.brand + "10",
  },
  pillScroll: {
    flexGrow: 0,
  },
  unitPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    marginRight: 8,
    alignItems: "center",
    minWidth: 64,
  },
  unitPillSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.brand + "15",
  },
  unitPillText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  unitPillTextSelected: {
    color: colors.brand,
  },
  unitPillPrice: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  unitPillPriceSelected: {
    color: colors.brand + "cc",
  },
});

// ── Line Item Row ──────────────────────────────────────────────
// Stacked 2-row layout per line item:
//   Row 1: Item name (full width)
//   Row 2: [Qty] [Rate] [GST%] [Disc%]  — two per row at 44pt minHeight
//   Row 3: Amount (computed, right-aligned)

interface LineItemRowProps {
  item: LineItem;
  index: number;
  invoiceType: InvoiceType;
  onChange: (index: number, field: keyof LineItem, value: string) => void;
  onRemove: (index: number) => void;
  onPickItem: (index: number) => void;
  // G-08
  onSelectVariant: (index: number, variant: { id: string; attributeValues: Record<string, string>; salePrice: string | null; purchasePrice: string | null }) => void;
  onSelectUnit: (index: number, unitKey: string) => void;
  allItems: Array<{ id: string; name: string; salePrice?: string | null; purchasePrice?: string | null; taxPercent: string; itemMode?: string | null; unitVariants?: UnitVariant[] | null }>;
}

function LineItemRow({ item, index, invoiceType, onChange, onRemove, onPickItem, onSelectVariant, onSelectUnit, allItems }: LineItemRowProps) {
  const qtyRef = useRef<TextInput>(null);
  const rateRef = useRef<TextInput>(null);
  const gstRef = useRef<TextInput>(null);
  const discRef = useRef<TextInput>(null);

  const lineTotal = useMemo(() => {
    const qty = safeNum(item.quantity);
    const price = safeNum(item.unitPrice);
    const tax = safeNum(item.taxPercent);
    const disc = safeNum(item.discountPercent);
    const subtotal = qty * price;
    const afterDiscount = subtotal * (1 - disc / 100);
    const taxAmt = afterDiscount * (tax / 100);
    return afterDiscount + taxAmt;
  }, [item]);

  // Find the full item record from the list to get unitVariants etc.
  const selectedItemRecord = item.itemId
    ? allItems.find((i) => i.id === item.itemId)
    : null;

  const isVariantItem = item.itemMode === "variants";
  const isAltUnitItem = item.itemMode === "alt_units";
  const unitVariants = (selectedItemRecord?.unitVariants as UnitVariant[] | null | undefined) ?? [];

  return (
    <View style={styles.lineItemCard}>
      {/* Row 1: Item picker + remove */}
      <View style={styles.lineItemHeader}>
        <TouchableOpacity
          style={styles.descPickerBtn}
          onPress={() => onPickItem(index)}
          activeOpacity={0.7}
        >
          <Text
            style={item.itemName ? styles.descText : styles.descPlaceholder}
            numberOfLines={1}
          >
            {item.itemName || "Tap to select item..."}
          </Text>
          <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onRemove(index)} style={styles.removeBtn}>
          <Ionicons name="close-circle" size={20} color={colors.danger} />
        </TouchableOpacity>
      </View>

      {/* Bug B: free-text per-line notes. Default collapsed as "+ Add notes". */}
      {item.itemName ? (
        <LineItemNotesField value={item.notes} onChange={(v) => onChange(index, "notes", v)} />
      ) : null}

      {/* G-08: Variant sub-selector */}
      {isVariantItem && item.itemId && (
        <VariantSubSelector
          itemId={item.itemId}
          selectedVariantId={item.variantId}
          invoiceType={invoiceType}
          onSelect={(variant) => onSelectVariant(index, variant)}
        />
      )}

      {/* G-08: Alt-unit pill selector */}
      {isAltUnitItem && unitVariants.length > 0 && selectedItemRecord && (
        <AltUnitSelector
          baseUnit={selectedItemRecord.salePrice ? { unit: "base", salePrice: selectedItemRecord.salePrice, purchasePrice: selectedItemRecord.purchasePrice } : null}
          unitVariants={unitVariants}
          selectedUnit={item.selectedUnit}
          invoiceType={invoiceType}
          onSelect={(unitKey) => onSelectUnit(index, unitKey)}
        />
      )}

      {/* Row 2a: Qty + Rate */}
      <View style={styles.lineItemFieldsRow}>
        <View style={styles.lineFieldHalf}>
          <Text style={styles.fieldLabel}>Qty</Text>
          <TextInput
            ref={qtyRef}
            style={styles.fieldInput}
            value={item.quantity}
            onChangeText={(v) => onChange(index, "quantity", v)}
            keyboardType="decimal-pad"
            placeholder="1"
            placeholderTextColor={colors.textMuted}
            returnKeyType="next"
            onSubmitEditing={() => rateRef.current?.focus()}
          />
        </View>
        <View style={styles.lineFieldHalf}>
          <Text style={styles.fieldLabel}>Rate (₹)</Text>
          <TextInput
            ref={rateRef}
            style={styles.fieldInput}
            value={item.unitPrice}
            onChangeText={(v) => onChange(index, "unitPrice", v)}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.textMuted}
            returnKeyType="next"
            onSubmitEditing={() => gstRef.current?.focus()}
          />
        </View>
      </View>

      {/* Row 2b: GST % + Disc % */}
      <View style={[styles.lineItemFieldsRow, { marginBottom: 10 }]}>
        <View style={styles.lineFieldHalf}>
          <Text style={styles.fieldLabel}>GST %</Text>
          <TextInput
            ref={gstRef}
            style={styles.fieldInput}
            value={item.taxPercent}
            onChangeText={(v) => onChange(index, "taxPercent", v)}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.textMuted}
            returnKeyType="next"
            onSubmitEditing={() => discRef.current?.focus()}
          />
        </View>
        <View style={styles.lineFieldHalf}>
          <Text style={styles.fieldLabel}>Disc %</Text>
          <TextInput
            ref={discRef}
            style={styles.fieldInput}
            value={item.discountPercent}
            onChangeText={(v) => onChange(index, "discountPercent", v)}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.textMuted}
            returnKeyType="done"
          />
        </View>
      </View>

      {/* Row 3: computed amount */}
      <View style={styles.lineTotalRow}>
        <Text style={styles.lineTotalLabel}>Amount</Text>
        <Text style={styles.lineTotalValue}>{formatCurrency(lineTotal)}</Text>
      </View>
    </View>
  );
}

// ── G-08: Variant Sub-Selector ────────────────────────────────

interface VariantSubSelectorProps {
  itemId: string;
  selectedVariantId?: string;
  invoiceType: InvoiceType;
  onSelect: (variant: { id: string; attributeValues: Record<string, string>; salePrice: string | null; purchasePrice: string | null }) => void;
}

function VariantSubSelector({ itemId, selectedVariantId, onSelect }: VariantSubSelectorProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const { data: variants, isLoading } = trpc.item.listVariants.useQuery(
    { itemId },
    { enabled: true }
  );

  const selectedVariant = variants?.find((v) => v.id === selectedVariantId);
  const selectedLabel = selectedVariant
    ? Object.values(selectedVariant.attributeValues as Record<string, string>).join(" / ")
    : null;

  return (
    <View style={subSelectorStyles.container}>
      <Text style={subSelectorStyles.label}>Variant</Text>
      <TouchableOpacity
        style={[subSelectorStyles.pillBtn, selectedVariantId ? subSelectorStyles.pillBtnSelected : {}]}
        onPress={() => setModalVisible(true)}
        activeOpacity={0.7}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={colors.brand} />
        ) : (
          <>
            <Text style={selectedVariantId ? subSelectorStyles.pillTextSelected : subSelectorStyles.pillText}>
              {selectedLabel ?? "Select variant..."}
            </Text>
            <Ionicons name="chevron-down" size={12} color={selectedVariantId ? colors.brand : colors.textMuted} />
          </>
        )}
      </TouchableOpacity>
      {!selectedVariantId && !isLoading && (
        <Text style={subSelectorStyles.warningText}>Please select a variant</Text>
      )}

      <Modal visible={modalVisible} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={modalStyles.overlay}>
          <View style={modalStyles.sheet}>
            <View style={modalStyles.header}>
              <Text style={modalStyles.title}>Select Variant</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} style={modalStyles.closeBtn}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            {isLoading ? (
              <ActivityIndicator style={{ marginTop: 32 }} color={colors.brand} />
            ) : !variants || variants.length === 0 ? (
              <Text style={modalStyles.emptyText}>No variants defined for this item</Text>
            ) : (
              <FlatList
                data={variants}
                keyExtractor={(v) => v.id}
                contentContainerStyle={modalStyles.listContent}
                renderItem={({ item: v }) => {
                  const label = Object.values(v.attributeValues as Record<string, string>).join(" / ");
                  const isSelected = v.id === selectedVariantId;
                  return (
                    <TouchableOpacity
                      style={[modalStyles.listItem, isSelected && subSelectorStyles.listItemSelected]}
                      onPress={() => {
                        onSelect({ id: v.id, attributeValues: v.attributeValues as Record<string, string>, salePrice: v.salePrice, purchasePrice: v.purchasePrice });
                        setModalVisible(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={modalStyles.listItemIcon}>
                        <Ionicons name="options-outline" size={16} color={colors.brand} />
                      </View>
                      <View style={modalStyles.listItemContent}>
                        <Text style={[modalStyles.listItemName, isSelected && { color: colors.brand }]}>{label}</Text>
                        {v.salePrice && (
                          <Text style={modalStyles.listItemSub}>{formatCurrency(v.salePrice)}</Text>
                        )}
                      </View>
                      {isSelected && (
                        <Ionicons name="checkmark-circle" size={20} color={colors.brand} />
                      )}
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── G-08: Alt-Unit Pill Selector ──────────────────────────────

interface AltUnitSelectorProps {
  baseUnit: { unit: string; salePrice: string | null | undefined; purchasePrice?: string | null } | null;
  unitVariants: UnitVariant[];
  selectedUnit?: string;
  invoiceType: InvoiceType;
  onSelect: (unitKey: string) => void;
}

function AltUnitSelector({ baseUnit, unitVariants, selectedUnit, invoiceType, onSelect }: AltUnitSelectorProps) {
  return (
    <View style={subSelectorStyles.container}>
      <Text style={subSelectorStyles.label}>Unit</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={subSelectorStyles.pillScroll}>
        {/* Base unit pill */}
        {baseUnit && (
          <TouchableOpacity
            style={[subSelectorStyles.unitPill, !selectedUnit && subSelectorStyles.unitPillSelected]}
            onPress={() => onSelect("__base__")}
            activeOpacity={0.7}
          >
            <Text style={[subSelectorStyles.unitPillText, !selectedUnit && subSelectorStyles.unitPillTextSelected]}>
              {baseUnit.unit === "base"
                ? `Base`
                : baseUnit.unit}
            </Text>
            {baseUnit.salePrice && (
              <Text style={[subSelectorStyles.unitPillPrice, !selectedUnit && subSelectorStyles.unitPillPriceSelected]}>
                {formatCurrency(invoiceType === "purchase" && baseUnit.purchasePrice ? baseUnit.purchasePrice : baseUnit.salePrice)}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {/* Alt-unit pills */}
        {unitVariants.map((uv) => {
          const isSelected = selectedUnit === uv.unit;
          const price = invoiceType === "purchase" && uv.purchasePrice ? uv.purchasePrice : uv.salePrice;
          return (
            <TouchableOpacity
              key={uv.unit}
              style={[subSelectorStyles.unitPill, isSelected && subSelectorStyles.unitPillSelected]}
              onPress={() => onSelect(uv.unit)}
              activeOpacity={0.7}
            >
              <Text style={[subSelectorStyles.unitPillText, isSelected && subSelectorStyles.unitPillTextSelected]}>
                {uv.unit}
              </Text>
              <Text style={[subSelectorStyles.unitPillPrice, isSelected && subSelectorStyles.unitPillPriceSelected]}>
                {formatCurrency(price)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ── Main Create Screen ────────────────────────────────────────

export default function InvoiceCreateScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string }>();
  const [invoiceType, setInvoiceType] = useState<InvoiceType>(
    (params.type as InvoiceType) ?? "sale"
  );

  const [selectedParty, setSelectedParty] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [invoiceDate, setInvoiceDate] = useState(todayDate());
  const [dueDate, setDueDate] = useState(in30daysDate());
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([newLineItem()]);
  const [showPartyPicker, setShowPartyPicker] = useState(false);
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [activeLineIndex, setActiveLineIndex] = useState(0);

  // G-08: fetch full item list so LineItemRow can read unitVariants
  const { data: allItemsData } = trpc.item.list.useQuery({ page: 1, limit: 200 });
  const allItems = allItemsData?.data ?? [];

  // OPT-04: fetch party details when a party is selected (for creditPeriodDays)
  const partyType = invoiceType === "sale" ? "customer" : "supplier";
  const { data: partiesData } = trpc.party.list.useQuery(
    { type: partyType, page: 1, limit: 200 },
    { enabled: showPartyPicker || selectedParty !== null }
  );

  const createMutation = trpc.invoice.create.useMutation({
    onSuccess: (data) => {
      router.replace(`/(invoices)/${data.id}` as never);
    },
    onError: (err) => {
      Alert.alert("Error", err.message, [
        {
          text: "Retry",
          onPress: () => {
            if (selectedParty) handleCreate();
          },
        },
        { text: "OK" },
      ]);
    },
  });

  const totals = useMemo(() => {
    const validItems = lineItems.filter((li) => li.itemName.trim().length > 0);
    if (validItems.length === 0) {
      return { subtotal: "0", taxTotal: "0", lineDiscountTotal: "0", invoiceDiscountAmount: "0", chargesTotal: "0", roundOff: "0", total: "0" };
    }
    return calcInvoiceTotals({
      lineItems: validItems.map((li) => ({
        quantity: li.quantity || "1",
        unitPrice: li.unitPrice || "0",
        taxPercent: li.taxPercent || "0",
        discountPercent: li.discountPercent || "0",
      })),
    });
  }, [lineItems]);

  const handleLineChange = useCallback(
    (index: number, field: keyof LineItem, value: string) => {
      setLineItems((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], [field]: value };
        return next;
      });
    },
    []
  );

  const handleRemoveLine = useCallback((index: number) => {
    setLineItems((prev) => {
      if (prev.length === 1) return [newLineItem()];
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handlePickItemForLine = useCallback((index: number) => {
    setActiveLineIndex(index);
    setShowItemPicker(true);
  }, []);

  const handleItemSelected = useCallback(
    (item: {
      id: string;
      name: string;
      salePrice?: string | null;
      purchasePrice?: string | null;
      taxPercent: string;
      itemMode?: string | null;
      unitVariants?: UnitVariant[] | null;
    }) => {
      const price =
        invoiceType === "purchase"
          ? item.purchasePrice ?? item.salePrice ?? "0"
          : item.salePrice ?? "0";
      setLineItems((prev) => {
        const next = [...prev];
        next[activeLineIndex] = {
          ...next[activeLineIndex],
          itemId: item.id,
          itemName: item.name,
          unitPrice: price,
          taxPercent: item.taxPercent,
          // G-08: store item mode so sub-selectors can render; clear prior selections
          itemMode: (item.itemMode as LineItem["itemMode"]) ?? "simple",
          variantId: undefined,
          selectedUnit: undefined,
          conversionFactor: undefined,
        };
        return next;
      });
    },
    [invoiceType, activeLineIndex]
  );

  const handleAddLine = useCallback(() => {
    setLineItems((prev) => [newLineItem(), ...prev]); // prepend — new item at top
  }, []);

  // G-08: variant selection handler
  const handleSelectVariant = useCallback(
    (index: number, variant: { id: string; attributeValues: Record<string, string>; salePrice: string | null; purchasePrice: string | null }) => {
      setLineItems((prev) => {
        const next = [...prev];
        const li = next[index];
        const parentItem = allItems.find((i) => i.id === li.itemId);
        const label = Object.values(variant.attributeValues).join(" / ");
        const variantPrice = invoiceType === "purchase"
          ? (variant.purchasePrice ?? variant.salePrice ?? (parentItem?.purchasePrice ?? parentItem?.salePrice ?? "0"))
          : (variant.salePrice ?? (parentItem?.salePrice ?? "0"));
        next[index] = {
          ...li,
          variantId: variant.id,
          itemName: parentItem ? `${parentItem.name} - ${label}` : label,
          unitPrice: variantPrice ?? "0",
        };
        return next;
      });
    },
    [invoiceType, allItems]
  );

  // G-08: alt-unit selection handler
  const handleSelectUnit = useCallback(
    (index: number, unitKey: string) => {
      setLineItems((prev) => {
        const next = [...prev];
        const li = next[index];
        const parentItem = allItems.find((i) => i.id === li.itemId);
        if (!parentItem) return prev;

        if (unitKey === "__base__") {
          const basePrice = invoiceType === "purchase"
            ? (parentItem.purchasePrice ?? parentItem.salePrice ?? "0")
            : (parentItem.salePrice ?? "0");
          next[index] = {
            ...li,
            selectedUnit: undefined,
            conversionFactor: undefined,
            unitPrice: basePrice,
            itemName: parentItem.name,
          };
          return next;
        }

        const uv = (parentItem.unitVariants as UnitVariant[] | null | undefined)?.find((v) => v.unit === unitKey);
        if (!uv) return prev;

        const unitPrice = invoiceType === "purchase"
          ? (uv.purchasePrice ?? uv.salePrice)
          : uv.salePrice;
        next[index] = {
          ...li,
          selectedUnit: uv.unit,
          conversionFactor: String(uv.conversionFactor),
          unitPrice: unitPrice ?? "0",
          itemName: `${parentItem.name} (${uv.unit})`,
        };
        return next;
      });
    },
    [invoiceType, allItems]
  );

  // OPT-04: set due date based on party's creditPeriodDays
  const handlePartySelect = useCallback(
    (party: { id: string; name: string; phone?: string | null }) => {
      setSelectedParty({ id: party.id, name: party.name });
      const fullParty = partiesData?.data.find((p) => p.id === party.id);
      if (fullParty?.creditPeriodDays && fullParty.creditPeriodDays > 0) {
        const due = new Date(invoiceDate);
        due.setDate(due.getDate() + fullParty.creditPeriodDays);
        setDueDate(due);
      }
    },
    [partiesData, invoiceDate]
  );

  const doCreate = useCallback(() => {
    if (!selectedParty) {
      Alert.alert("Validation", "Please select a party.");
      return;
    }

    const validItems = lineItems.filter(
      (li) => li.itemName.trim().length > 0 && parseFloat(li.quantity) > 0
    );

    if (validItems.length === 0) {
      Alert.alert("Validation", "Add at least one item.");
      return;
    }

    for (const li of validItems) {
      if (parseFloat(li.unitPrice) < 0) {
        Alert.alert("Validation", "Item prices cannot be negative.");
        return;
      }
    }

    haptic.success();
    createMutation.mutate({
      partyId: selectedParty.id,
      type: invoiceType,
      documentType: "invoice",
      invoiceDate: invoiceDate.toISOString(),
      dueDate: dueDate.toISOString(),
      notes: notes.trim() || undefined,
      additionalCharges: "0",
      invoiceDiscount: "0",
      invoiceDiscountType: "amount",
      roundOff: "0",
      // Bug B: itemName is the required name snapshot and description is
      // the optional free-text per-line note (empty → omitted).
      lineItems: validItems.map((li) => ({
        itemId: li.itemId,
        itemName: li.itemName.trim(),
        description: li.notes.trim() || undefined,
        quantity: li.quantity || "1",
        unitPrice: li.unitPrice || "0",
        taxPercent: li.taxPercent || "0",
        discountPercent: li.discountPercent || "0",
        // G-08: variant / alt-unit fields
        variantId: li.variantId || undefined,
        selectedUnit: li.selectedUnit || undefined,
        conversionFactor: li.conversionFactor || undefined,
      })),
    });
  }, [selectedParty, lineItems, invoiceType, invoiceDate, dueDate, notes, createMutation]);

  const handleCreate = useCallback(() => {
    const total = parseFloat(totals.total);
    if (total === 0) {
      Alert.alert(
        "Zero-value Invoice",
        "This invoice has a total of ₹0. Are you sure you want to proceed?",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Create Anyway", onPress: doCreate },
        ]
      );
      return;
    }
    doCreate();
  }, [totals.total, doCreate]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Header */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>New Invoice</Text>
        <View style={styles.typeToggle}>
          <TouchableOpacity
            style={[styles.typeBtn, invoiceType === "sale" && styles.typeBtnActive]}
            onPress={() => setInvoiceType("sale")}
          >
            <Text style={[styles.typeBtnText, invoiceType === "sale" && styles.typeBtnTextActive]}>
              Sale
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.typeBtn, invoiceType === "purchase" && styles.typeBtnActive]}
            onPress={() => setInvoiceType("purchase")}
          >
            <Text
              style={[
                styles.typeBtnText,
                invoiceType === "purchase" && styles.typeBtnTextActive,
              ]}
            >
              Purchase
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Party */}
          <Text style={styles.sectionLabel}>
            {invoiceType === "sale" ? "Customer" : "Supplier"}
          </Text>
          <TouchableOpacity
            style={[styles.selectorBtn, selectedParty ? styles.selectorBtnFilled : {}]}
            onPress={() => setShowPartyPicker(true)}
            activeOpacity={0.7}
          >
            <Ionicons
              name="person-outline"
              size={18}
              color={selectedParty ? colors.textPrimary : colors.textMuted}
              style={styles.selectorIcon}
            />
            <Text style={selectedParty ? styles.selectorValueText : styles.selectorPlaceholder}>
              {selectedParty ? selectedParty.name : "Select party..."}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>

          {/* Dates */}
          <Text style={styles.sectionLabel}>Dates</Text>
          <View style={styles.datesRow}>
            <View style={styles.dateCard}>
              <DatePickerField
                label="Invoice Date"
                value={invoiceDate}
                onChange={setInvoiceDate}
              />
            </View>
            <View style={styles.dateCard}>
              <DatePickerField
                label="Due Date"
                value={dueDate}
                onChange={setDueDate}
                minimumDate={invoiceDate}
              />
            </View>
          </View>

          {/* Line Items */}
          {/* Items section header with running total */}
          <View style={styles.lineItemsHeader}>
            <View>
              <Text style={styles.sectionLabel}>Items</Text>
              <Text style={styles.lineCount}>
                {lineItems.filter(l => l.itemName).length} {lineItems.filter(l => l.itemName).length === 1 ? "item" : "items"} · {formatCurrency(totals.total)}
              </Text>
            </View>
            <TouchableOpacity style={styles.addItemBtn} onPress={handleAddLine} activeOpacity={0.7}>
              <Ionicons name="add-circle-outline" size={20} color={colors.brand} />
              <Text style={styles.addItemBtnText}>Add</Text>
            </TouchableOpacity>
          </View>

          {/* Line items — newest at top */}
          {lineItems.map((li, idx) => (
            <LineItemRow
              key={idx}
              item={li}
              index={idx}
              invoiceType={invoiceType}
              onChange={handleLineChange}
              onRemove={handleRemoveLine}
              onPickItem={handlePickItemForLine}
              onSelectVariant={handleSelectVariant}
              onSelectUnit={handleSelectUnit}
              allItems={allItems}
            />
          ))}

          {/* Notes */}
          <Text style={styles.sectionLabel}>Notes (optional)</Text>
          <TextInput
            style={styles.notesInput}
            value={notes}
            onChangeText={setNotes}
            placeholder="Payment terms, delivery notes, etc."
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            returnKeyType="done"
          />

          {/* Totals Summary */}
          <Text style={styles.sectionLabel}>Summary</Text>
          <View style={styles.totalsCard}>
            {parseFloat(totals.lineDiscountTotal) > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Discount</Text>
                <Text style={[styles.totalValue, { color: colors.success }]}>
                  -{formatCurrency(totals.lineDiscountTotal)}
                </Text>
              </View>
            )}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>{formatCurrency(totals.subtotal)}</Text>
            </View>
            {parseFloat(totals.taxTotal) > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Tax</Text>
                <Text style={styles.totalValue}>{formatCurrency(totals.taxTotal)}</Text>
              </View>
            )}
            <View style={styles.totalDivider} />
            <View style={styles.totalRow}>
              <Text style={styles.totalLabelBold}>Total</Text>
              <Text style={styles.totalValueBold}>{formatCurrency(totals.total)}</Text>
            </View>
          </View>

          {/* Bottom spacer for footer */}
          <View style={{ height: 100 }} />
        </ScrollView>

        {/* Sticky Create Button */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.createBtn, (createMutation.isPending || !selectedParty || !lineItems.some((li) => li.itemName.trim() && li.unitPrice)) && styles.createBtnDisabled]}
            onPress={handleCreate}
            activeOpacity={0.85}
            disabled={createMutation.isPending || !selectedParty || !lineItems.some((li) => li.itemName.trim() && li.unitPrice)}
          >
            {createMutation.isPending ? (
              <ActivityIndicator color={colors.textPrimary} size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={20} color={colors.textPrimary} />
                <Text style={styles.createBtnText}>Create Invoice</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Party Picker Modal */}
      <PartyPickerModal
        visible={showPartyPicker}
        type={invoiceType}
        onSelect={handlePartySelect}
        onClose={() => setShowPartyPicker(false)}
      />

      {/* Item Picker Modal */}
      <ItemPickerModal
        visible={showItemPicker}
        invoiceType={invoiceType}
        onSelect={handleItemSelected}
        onClose={() => setShowItemPicker(false)}
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
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
  topBarTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  typeToggle: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
  },
  typeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
  },
  typeBtnActive: {
    backgroundColor: colors.brand,
  },
  typeBtnText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.textMuted,
  },
  typeBtnTextActive: {
    color: colors.textPrimary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
  },
  selectorBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 44,
  },
  selectorBtnFilled: {
    borderColor: colors.brand + "60",
  },
  selectorIcon: {
    marginRight: 10,
  },
  selectorValueText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  selectorPlaceholder: {
    flex: 1,
    fontSize: 15,
    color: colors.textMuted,
  },
  datesRow: {
    flexDirection: "row",
    gap: 10,
  },
  dateCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    minHeight: 44,
  },
  dateLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: "500",
    marginBottom: 4,
  },
  dateInput: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
    padding: 0,
  },
  lineItemsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
    marginBottom: 12,
  },
  lineCount: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  lineItemCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
  },
  lineItemHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    gap: 8,
  },
  descPickerBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
    minHeight: 44,
  },
  descText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  descPlaceholder: {
    flex: 1,
    fontSize: 13,
    color: colors.textMuted,
  },
  removeBtn: {
    padding: 4,
  },
  descInput: {
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: colors.textPrimary,
    marginBottom: 10,
  },
  // 2-column row for line item numeric fields
  lineItemFieldsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  lineFieldHalf: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: "600",
    marginBottom: 4,
  },
  fieldInput: {
    backgroundColor: colors.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
    textAlign: "center",
    minHeight: 44,
  },
  lineTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  lineTotalLabel: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: "500",
  },
  lineTotalValue: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  addItemBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.brand + "18",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 4,
  },
  addItemBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.brand,
  },
  notesInput: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.textPrimary,
    minHeight: 80,
  },
  totalsCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
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
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand,
    borderRadius: 16,
    paddingVertical: 16,
    gap: 10,
    shadowColor: colors.brand,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  createBtnDisabled: {
    opacity: 0.7,
  },
  createBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
});

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
    maxHeight: "80%",
    paddingBottom: 32,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    padding: 0,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  listItemIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.brand + "20",
    alignItems: "center",
    justifyContent: "center",
  },
  listItemContent: {
    flex: 1,
  },
  listItemName: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  listItemSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  emptyText: {
    textAlign: "center",
    paddingTop: 40,
    fontSize: 14,
    color: colors.textMuted,
  },
});
