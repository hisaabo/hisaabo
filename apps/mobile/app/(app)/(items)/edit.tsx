import { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../src/lib/trpc";
import { makeStyles } from "../../../src/lib/makeStyles";
import { useColors } from "../../../src/contexts/ThemeContext";
import { haptic } from "../../../src/lib/haptics";
import { QueryError } from "../../../src/components/ui";

const UNITS = [
  "pcs", "kg", "g", "l", "ml", "m", "cm", "ft", "in", "box",
  "dozen", "pair", "set", "pkt", "bag", "btl", "ton", "pack", "person", "other",
] as const;

type Unit = (typeof UNITS)[number];

export default function EditItemScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();

  const { data: item, isLoading } = trpc.item.getById.useQuery(
    { id: id ?? "" },
    { enabled: !!id }
  );

  const [itemType, setItemType] = useState<"product" | "service">("product");
  const [name, setName] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [taxPercent, setTaxPercent] = useState("0");
  const [unit, setUnit] = useState<Unit>("pcs");
  const [category, setCategory] = useState("");
  const [sku, setSku] = useState("");
  const [hsn, setHsn] = useState("");
  const [lowStockAlert, setLowStockAlert] = useState("");
  const [unitPickerVisible, setUnitPickerVisible] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (item && !initialized) {
      setItemType((item.itemType as "product" | "service") ?? "product");
      setName(item.name ?? "");
      setSalePrice(item.salePrice ?? "");
      setPurchasePrice(item.purchasePrice ?? "");
      setTaxPercent(item.taxPercent ?? "0");
      setUnit((item.unit as Unit) ?? "pcs");
      setCategory(item.category ?? "");
      setSku(item.sku ?? "");
      setHsn(item.hsn ?? "");
      setLowStockAlert(item.lowStockAlert ?? "");
      setInitialized(true);
    }
  }, [item, initialized]);

  const updateItem = trpc.item.update.useMutation({
    onSuccess: () => {
      utils.item.list.invalidate();
      utils.item.getById.invalidate({ id: id ?? "" });
      router.back();
    },
    onError: (error) => {
      Alert.alert("Error", error.message || "Failed to update item");
    },
  });

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Name is required";
    if (salePrice && !/^\d+(\.\d{1,2})?$/.test(salePrice)) {
      newErrors.salePrice = "Enter a valid price (e.g. 100 or 99.99)";
    }
    if (purchasePrice && !/^\d+(\.\d{1,2})?$/.test(purchasePrice)) {
      newErrors.purchasePrice = "Enter a valid price";
    }
    if (taxPercent && !/^\d+(\.\d{1,2})?$/.test(taxPercent)) {
      newErrors.taxPercent = "Enter a valid percentage";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    haptic.success();
    updateItem.mutate({
      id: id ?? "",
      data: {
        name: name.trim(),
        itemType,
        salePrice: salePrice.trim() || undefined,
        purchasePrice: purchasePrice.trim() || undefined,
        taxPercent: taxPercent.trim() || "0",
        unit,
        category: category.trim() || undefined,
        sku: sku.trim() || undefined,
        hsn: hsn.trim() || undefined,
        lowStockAlert: lowStockAlert.trim() || undefined,
      },
    });
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!item) {
    return (
      <SafeAreaView style={styles.container}>
        <QueryError message="Item not found" onRetry={() => {}} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Item</Text>
          <TouchableOpacity
            style={[
              styles.saveButton,
              updateItem.isPending && styles.saveButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={updateItem.isPending}
            activeOpacity={0.8}
          >
            {updateItem.isPending ? (
              <ActivityIndicator size="small" color={colors.textPrimary} />
            ) : (
              <Text style={styles.saveButtonText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Item Type Toggle */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Item Type</Text>
            <View style={styles.typeToggle}>
              <TouchableOpacity
                style={[
                  styles.typeOption,
                  itemType === "product" && styles.typeOptionActive,
                ]}
                onPress={() => setItemType("product")}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="cube-outline"
                  size={18}
                  color={itemType === "product" ? colors.textPrimary : colors.textMuted}
                />
                <Text
                  style={[
                    styles.typeOptionText,
                    itemType === "product" && styles.typeOptionTextActive,
                  ]}
                >
                  Product
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.typeOption,
                  itemType === "service" && styles.typeOptionActive,
                ]}
                onPress={() => setItemType("service")}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="briefcase-outline"
                  size={18}
                  color={itemType === "service" ? colors.textPrimary : colors.textMuted}
                />
                <Text
                  style={[
                    styles.typeOptionText,
                    itemType === "service" && styles.typeOptionTextActive,
                  ]}
                >
                  Service
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Basic Info */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Basic Information</Text>
            <View style={styles.card}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>
                  Name <Text style={styles.required}>*</Text>
                </Text>
                <TextInput
                  style={[styles.input, errors.name && styles.inputError]}
                  placeholder="Item name"
                  placeholderTextColor={colors.textMuted}
                  value={name}
                  onChangeText={(t) => {
                    setName(t);
                    if (errors.name) setErrors((e) => ({ ...e, name: "" }));
                  }}
                  autoCapitalize="words"
                />
                {errors.name && (
                  <Text style={styles.errorText}>{errors.name}</Text>
                )}
              </View>

              <View style={styles.fieldDivider} />

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Category</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Electronics, Food..."
                  placeholderTextColor={colors.textMuted}
                  value={category}
                  onChangeText={setCategory}
                  autoCapitalize="words"
                />
              </View>

              <View style={styles.fieldDivider} />

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>SKU</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Stock keeping unit code"
                  placeholderTextColor={colors.textMuted}
                  value={sku}
                  onChangeText={setSku}
                  autoCapitalize="characters"
                />
              </View>

              <View style={styles.fieldDivider} />

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>HSN Code</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Harmonized System Number"
                  placeholderTextColor={colors.textMuted}
                  value={hsn}
                  onChangeText={setHsn}
                  keyboardType="numeric"
                />
              </View>
            </View>
          </View>

          {/* Pricing */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Pricing</Text>
            <View style={styles.card}>
              <View style={styles.fieldRow}>
                <View style={[styles.fieldGroup, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>Sale Price (₹)</Text>
                  <TextInput
                    style={[styles.input, errors.salePrice && styles.inputError]}
                    placeholder="0.00"
                    placeholderTextColor={colors.textMuted}
                    value={salePrice}
                    onChangeText={(t) => {
                      setSalePrice(t);
                      if (errors.salePrice)
                        setErrors((e) => ({ ...e, salePrice: "" }));
                    }}
                    keyboardType="decimal-pad"
                  />
                  {errors.salePrice && (
                    <Text style={styles.errorText}>{errors.salePrice}</Text>
                  )}
                </View>
                <View style={styles.fieldRowDivider} />
                <View style={[styles.fieldGroup, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>Purchase Price (₹)</Text>
                  <TextInput
                    style={[styles.input, errors.purchasePrice && styles.inputError]}
                    placeholder="0.00"
                    placeholderTextColor={colors.textMuted}
                    value={purchasePrice}
                    onChangeText={(t) => {
                      setPurchasePrice(t);
                      if (errors.purchasePrice)
                        setErrors((e) => ({ ...e, purchasePrice: "" }));
                    }}
                    keyboardType="decimal-pad"
                  />
                  {errors.purchasePrice && (
                    <Text style={styles.errorText}>{errors.purchasePrice}</Text>
                  )}
                </View>
              </View>

              <View style={styles.fieldDivider} />

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Tax %</Text>
                <View style={styles.taxRow}>
                  {["0", "5", "12", "18", "28"].map((rate) => (
                    <TouchableOpacity
                      key={rate}
                      style={[
                        styles.taxChip,
                        taxPercent === rate && styles.taxChipActive,
                      ]}
                      onPress={() => setTaxPercent(rate)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.taxChipText,
                          taxPercent === rate && styles.taxChipTextActive,
                        ]}
                      >
                        {rate}%
                      </Text>
                    </TouchableOpacity>
                  ))}
                  <TextInput
                    style={[styles.input, styles.taxCustomInput]}
                    placeholder="Custom"
                    placeholderTextColor={colors.textMuted}
                    value={
                      ["0", "5", "12", "18", "28"].includes(taxPercent)
                        ? ""
                        : taxPercent
                    }
                    onChangeText={(t) => {
                      setTaxPercent(t);
                      if (errors.taxPercent)
                        setErrors((e) => ({ ...e, taxPercent: "" }));
                    }}
                    keyboardType="decimal-pad"
                  />
                </View>
                {errors.taxPercent && (
                  <Text style={styles.errorText}>{errors.taxPercent}</Text>
                )}
              </View>
            </View>
          </View>

          {/* Unit */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Unit of Measure</Text>
            <View style={styles.card}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Unit</Text>
                <TouchableOpacity
                  style={styles.unitPicker}
                  onPress={() => setUnitPickerVisible(true)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.unitPickerValue}>{unit}</Text>
                  <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Low Stock Alert (Products only) */}
          {itemType === "product" && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Stock Settings</Text>
              <View style={styles.card}>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Low Stock Alert</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 10"
                    placeholderTextColor={colors.textMuted}
                    value={lowStockAlert}
                    onChangeText={setLowStockAlert}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Unit Picker Modal */}
      <Modal
        visible={unitPickerVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setUnitPickerVisible(false)}
      >
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHandle} />
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select Unit</Text>
              <TouchableOpacity onPress={() => setUnitPickerVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={UNITS}
              keyExtractor={(u) => u}
              renderItem={({ item: u }) => (
                <TouchableOpacity
                  style={[
                    styles.pickerItem,
                    unit === u && styles.pickerItemActive,
                  ]}
                  onPress={() => {
                    setUnit(u);
                    setUnitPickerVisible(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.pickerItemText,
                      unit === u && styles.pickerItemTextActive,
                    ]}
                  >
                    {u}
                  </Text>
                  {unit === u && (
                    <Ionicons name="checkmark" size={18} color={colors.brand} />
                  )}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.pickerDivider} />}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  saveButton: {
    backgroundColor: colors.brand,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 72,
    alignItems: "center",
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  scrollView: {
    flex: 1,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 10,
  },
  typeToggle: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 9,
    gap: 8,
  },
  typeOptionActive: {
    backgroundColor: colors.brand,
  },
  typeOptionText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textMuted,
  },
  typeOptionTextActive: {
    color: colors.textPrimary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
  },
  fieldGroup: {
    paddingVertical: 12,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
    marginBottom: 6,
  },
  required: {
    color: colors.danger,
  },
  input: {
    fontSize: 15,
    color: colors.textPrimary,
    padding: 0,
  },
  inputError: {
    color: colors.danger,
  },
  errorText: {
    fontSize: 12,
    color: colors.danger,
    marginTop: 4,
  },
  fieldDivider: {
    height: 1,
    backgroundColor: colors.border,
  },
  fieldRow: {
    flexDirection: "row",
    paddingVertical: 12,
  },
  fieldRowDivider: {
    width: 1,
    backgroundColor: colors.border,
    marginHorizontal: 16,
  },
  taxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  taxChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  taxChipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  taxChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
  },
  taxChipTextActive: {
    color: colors.textPrimary,
  },
  taxCustomInput: {
    flex: 1,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minWidth: 70,
  },
  unitPicker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  unitPickerValue: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  pickerSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "60%",
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  pickerHandle: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 12,
  },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pickerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  pickerItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  pickerItemActive: {
    backgroundColor: colors.brandLight,
  },
  pickerItemText: {
    fontSize: 15,
    color: colors.textSecondary,
    fontWeight: "500",
  },
  pickerItemTextActive: {
    color: colors.brand,
    fontWeight: "700",
  },
  pickerDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 20,
  },
}));
