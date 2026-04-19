import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Modal,
  FlatList,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";
import { colors } from "../../../../src/lib/theme";
import { DatePickerField } from "../../../../src/components/ui";

/* ── Constants ──────────────────────────────────────────────────── */

const KNOWN_CARRIERS: { key: string; label: string; icon: string }[] = [
  { key: "delhivery", label: "Delhivery", icon: "cube-outline" },
  { key: "bluedart", label: "Blue Dart", icon: "cube-outline" },
  { key: "dtdc", label: "DTDC", icon: "cube-outline" },
  { key: "ecom_express", label: "Ecom Express", icon: "cube-outline" },
  { key: "india_post", label: "India Post", icon: "mail-outline" },
  { key: "shadowfax", label: "Shadowfax", icon: "cube-outline" },
  { key: "xpressbees", label: "XpressBees", icon: "cube-outline" },
];

const TRANSPORT_MODES: { key: string; label: string }[] = [
  { key: "road", label: "Road" },
  { key: "air", label: "Air" },
  { key: "rail", label: "Rail" },
  { key: "sea", label: "Sea" },
];

/* ── Party Picker ──────────────────────────────────────────────── */

function PartyPickerModal({
  visible,
  onSelect,
  onClose,
}: {
  visible: boolean;
  onSelect: (p: { id: string; name: string }) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const { data } = trpc.party.list.useQuery(
    { type: "customer", page: 1, limit: 200 },
    { enabled: visible }
  );
  const parties = data?.data ?? [];
  const filtered = search
    ? parties.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : parties;

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={ms.overlay}>
        <View style={ms.sheet}>
          <View style={ms.sheetHeader}>
            <Text style={ms.sheetTitle}>Select Party</Text>
            <TouchableOpacity onPress={onClose} style={ms.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={ms.searchWrap}>
            <Ionicons name="search-outline" size={15} color={colors.textMuted} style={ms.searchIcon} />
            <TextInput
              style={ms.searchInput}
              placeholder="Search..."
              placeholderTextColor={colors.textMuted}
              value={search}
              onChangeText={setSearch}
              autoFocus
            />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={ms.listContent}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={ms.listItem}
                onPress={() => { onSelect(item); onClose(); }}
                activeOpacity={0.7}
              >
                <View style={ms.listItemIcon}>
                  <Ionicons name="person-outline" size={16} color={colors.brand} />
                </View>
                <View>
                  <Text style={ms.listItemName}>{item.name}</Text>
                  {item.phone && <Text style={ms.listItemSub}>{item.phone}</Text>}
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={ms.emptyText}>No parties found</Text>}
          />
        </View>
      </View>
    </Modal>
  );
}

/* ── Carrier Picker ────────────────────────────────────────────── */

function CarrierPickerModal({
  visible,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selected: string;
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={ms.overlay}>
        <View style={ms.sheet}>
          <View style={ms.sheetHeader}>
            <Text style={ms.sheetTitle}>Select Carrier</Text>
            <TouchableOpacity onPress={onClose} style={ms.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={ms.listContent}>
            {KNOWN_CARRIERS.map((c) => (
              <TouchableOpacity
                key={c.key}
                style={[ms.listItem, selected === c.key && ms.listItemSelected]}
                onPress={() => { onSelect(c.key); onClose(); }}
                activeOpacity={0.7}
              >
                <View style={ms.listItemIcon}>
                  <Ionicons name={c.icon as any} size={16} color={selected === c.key ? colors.textPrimary : colors.brand} />
                </View>
                <Text style={[ms.listItemName, selected === c.key && { color: colors.textPrimary }]}>
                  {c.label}
                </Text>
                {selected === c.key && (
                  <Ionicons name="checkmark" size={16} color={colors.textPrimary} style={ms.checkIcon} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ── Main Screen ────────────────────────────────────────────────── */

export default function CreateShipmentScreen() {
  const router = useRouter();

  // Party
  const [partyId, setPartyId] = useState<string | undefined>();
  const [partyName, setPartyName] = useState("");
  const [showPartyPicker, setShowPartyPicker] = useState(false);

  // Carrier & logistics
  const [carrier, setCarrier] = useState("");
  const [showCarrierPicker, setShowCarrierPicker] = useState(false);
  const [mode, setMode] = useState("road");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [cost, setCost] = useState("0");
  const [weight, setWeight] = useState("");

  // Address
  const [shippingAddress, setShippingAddress] = useState("");
  const [shippingCity, setShippingCity] = useState("");
  const [shippingPincode, setShippingPincode] = useState("");

  // Dates
  const [shipmentDate, setShipmentDate] = useState<Date | undefined>(new Date());
  const [estimatedDelivery, setEstimatedDelivery] = useState<Date | undefined>();

  // Notes
  const [notes, setNotes] = useState("");

  const utils = trpc.useUtils();

  const createMutation = trpc.shipment.create.useMutation({
    onSuccess: () => {
      utils.shipment.list.invalidate();
      utils.dashboard.shippingSummary.invalidate();
      router.back();
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to create shipment.");
    },
  });

  const carrierLabel = KNOWN_CARRIERS.find((c) => c.key === carrier)?.label ?? carrier;

  const handleSubmit = () => {
    if (!carrier && !trackingNumber) {
      Alert.alert("Validation", "Please select a carrier or enter a tracking number.");
      return;
    }

    createMutation.mutate({
      partyId: partyId || undefined,
      carrier: carrier || undefined,
      mode: mode || undefined,
      trackingNumber: trackingNumber.trim() || undefined,
      trackingUrl: trackingUrl.trim() || undefined,
      cost: cost || "0",
      weight: weight.trim() || undefined,
      shippingAddress: shippingAddress.trim() || undefined,
      shippingCity: shippingCity.trim() || undefined,
      shippingPincode: shippingPincode.trim() || undefined,
      status: "pending",
      shipmentDate: shipmentDate?.toISOString(),
      estimatedDelivery: estimatedDelivery?.toISOString(),
      notes: notes.trim() || undefined,
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
        <View style={styles.headerBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.screenTitle}>New Shipment</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Party */}
          <Text style={styles.sectionLabel}>Party (Optional)</Text>
          <TouchableOpacity
            style={styles.pickerBtn}
            onPress={() => setShowPartyPicker(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="person-outline" size={16} color={partyId ? colors.brand : colors.textMuted} />
            <Text style={[styles.pickerBtnText, partyId && { color: colors.textPrimary }]}>
              {partyId ? partyName : "Select party..."}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
          </TouchableOpacity>

          {/* Carrier */}
          <Text style={styles.sectionLabel}>Carrier</Text>
          <TouchableOpacity
            style={styles.pickerBtn}
            onPress={() => setShowCarrierPicker(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="cube-outline" size={16} color={carrier ? colors.brand : colors.textMuted} />
            <Text style={[styles.pickerBtnText, carrier && { color: colors.textPrimary }]}>
              {carrier ? carrierLabel : "Select carrier..."}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
          </TouchableOpacity>

          {/* Transport mode */}
          <Text style={styles.sectionLabel}>Transport Mode</Text>
          <View style={styles.pillRow}>
            {TRANSPORT_MODES.map((m) => (
              <TouchableOpacity
                key={m.key}
                style={[styles.pill, mode === m.key && styles.pillActive]}
                onPress={() => setMode(m.key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.pillText, mode === m.key && styles.pillTextActive]}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Tracking */}
          <Text style={styles.sectionLabel}>Tracking Number</Text>
          <TextInput
            style={styles.input}
            value={trackingNumber}
            onChangeText={setTrackingNumber}
            placeholder="e.g. 1234567890"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
          />

          <Text style={styles.sectionLabel}>Tracking URL (Optional)</Text>
          <TextInput
            style={styles.input}
            value={trackingUrl}
            onChangeText={setTrackingUrl}
            placeholder="https://..."
            placeholderTextColor={colors.textMuted}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {/* Cost & weight */}
          <View style={styles.twoCol}>
            <View style={styles.colItem}>
              <Text style={styles.sectionLabel}>Shipping Cost</Text>
              <TextInput
                style={styles.input}
                value={cost}
                onChangeText={setCost}
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={styles.colItem}>
              <Text style={styles.sectionLabel}>Weight (kg)</Text>
              <TextInput
                style={styles.input}
                value={weight}
                onChangeText={setWeight}
                placeholder="e.g. 1.5"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
              />
            </View>
          </View>

          {/* Dates */}
          <Text style={styles.sectionLabel}>Shipment Date</Text>
          <DatePickerField
            label="Shipment Date"
            value={shipmentDate ?? new Date()}
            onChange={setShipmentDate}
          />

          <Text style={styles.sectionLabel}>Estimated Delivery (Optional)</Text>
          {estimatedDelivery && (
            <DatePickerField
              label="Estimated Delivery"
              value={estimatedDelivery}
              onChange={setEstimatedDelivery}
            />
          )}

          {/* Shipping address */}
          <Text style={styles.sectionLabel}>Shipping Address (Optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={shippingAddress}
            onChangeText={setShippingAddress}
            placeholder="Street address, building..."
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />

          <View style={styles.twoCol}>
            <View style={styles.colItem}>
              <Text style={styles.sectionLabel}>City</Text>
              <TextInput
                style={styles.input}
                value={shippingCity}
                onChangeText={setShippingCity}
                placeholder="City"
                placeholderTextColor={colors.textMuted}
              />
            </View>
            <View style={styles.colItem}>
              <Text style={styles.sectionLabel}>Pincode</Text>
              <TextInput
                style={styles.input}
                value={shippingPincode}
                onChangeText={setShippingPincode}
                placeholder="110001"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                maxLength={6}
              />
            </View>
          </View>

          {/* Notes */}
          <Text style={styles.sectionLabel}>Notes (Optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Any additional instructions..."
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitBtn, createMutation.isPending && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={createMutation.isPending}
            activeOpacity={0.8}
          >
            {createMutation.isPending ? (
              <ActivityIndicator color={colors.textPrimary} size="small" />
            ) : (
              <>
                <Ionicons name="cube-outline" size={18} color={colors.textPrimary} />
                <Text style={styles.submitBtnText}>Create Shipment</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      <PartyPickerModal
        visible={showPartyPicker}
        onSelect={(p) => { setPartyId(p.id); setPartyName(p.name); }}
        onClose={() => setShowPartyPicker(false)}
      />

      <CarrierPickerModal
        visible={showCarrierPicker}
        selected={carrier}
        onSelect={setCarrier}
        onClose={() => setShowCarrierPicker(false)}
      />
    </SafeAreaView>
  );
}

/* ── Styles ─────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 32 },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 12,
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
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
  },
  pickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  pickerBtnText: {
    flex: 1,
    fontSize: 14,
    color: colors.textMuted,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  pillText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
  },
  pillTextActive: {
    color: colors.textPrimary,
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
  textArea: {
    height: 80,
    paddingTop: 12,
  },
  twoCol: {
    flexDirection: "row",
    gap: 12,
  },
  colItem: {
    flex: 1,
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.brand,
    paddingVertical: 15,
    borderRadius: 14,
    marginTop: 24,
  },
  submitBtnText: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
});

const ms = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "75%",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetTitle: {
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
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  searchIcon: {},
  searchInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    paddingVertical: 0,
  },
  listContent: {
    paddingBottom: 32,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  listItemSelected: {
    backgroundColor: colors.brand,
  },
  listItemIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
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
  checkIcon: {
    marginLeft: "auto" as any,
  },
  emptyText: {
    textAlign: "center",
    color: colors.textMuted,
    fontSize: 13,
    padding: 24,
  },
});
