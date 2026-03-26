import { useState } from "react";
import {
  View,
  Text,
  SafeAreaView,
  StyleSheet,
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
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../src/lib/trpc";

const UNITS = [
  "pcs",
  "kg",
  "g",
  "l",
  "ml",
  "m",
  "cm",
  "ft",
  "in",
  "box",
  "dozen",
  "pair",
  "set",
  "pkt",
  "bag",
  "btl",
  "ton",
  "pack",
  "person",
  "other",
] as const;

type Unit = (typeof UNITS)[number];

export default function CreateItemScreen() {
  const router = useRouter();
  const utils = trpc.useUtils();

  const [itemType, setItemType] = useState<"product" | "service">("product");
  const [name, setName] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [taxPercent, setTaxPercent] = useState("0");
  const [unit, setUnit] = useState<Unit>("pcs");
  const [category, setCategory] = useState("");
  const [sku, setSku] = useState("");
  const [hsn, setHsn] = useState("");
  const [stockQuantity, setStockQuantity] = useState("0");
  const [lowStockAlert, setLowStockAlert] = useState("");
  const [unitPickerVisible, setUnitPickerVisible] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const createItem = trpc.item.create.useMutation({
    onSuccess: () => {
      utils.item.list.invalidate();
      router.back();
    },
    onError: (error) => {
      Alert.alert("Error", error.message || "Failed to create item");
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

    createItem.mutate({
      name: name.trim(),
      itemType,
      itemMode: "simple",
      salePrice: salePrice.trim() || undefined,
      purchasePrice: purchasePrice.trim() || undefined,
      taxPercent: taxPercent.trim() || "0",
      unit,
      category: category.trim() || undefined,
      sku: sku.trim() || undefined,
      hsn: hsn.trim() || undefined,
      stockQuantity: itemType === "product" ? (stockQuantity.trim() || "0") : "0",
      lowStockAlert: lowStockAlert.trim() || undefined,
    });
  };

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
            <Ionicons name="close" size={22} color="#ffffff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New Item</Text>
          <TouchableOpacity
            style={[
              styles.saveButton,
              createItem.isPending && styles.saveButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={createItem.isPending}
            activeOpacity={0.8}
          >
            {createItem.isPending ? (
              <ActivityIndicator size="small" color="#ffffff" />
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
                  color={itemType === "product" ? "#ffffff" : "#6b7280"}
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
                  color={itemType === "service" ? "#ffffff" : "#6b7280"}
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
                  placeholderTextColor="#6b7280"
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
                  placeholderTextColor="#6b7280"
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
                  placeholderTextColor="#6b7280"
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
                  placeholderTextColor="#6b7280"
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
                    style={[
                      styles.input,
                      errors.salePrice && styles.inputError,
                    ]}
                    placeholder="0.00"
                    placeholderTextColor="#6b7280"
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
                    style={[
                      styles.input,
                      errors.purchasePrice && styles.inputError,
                    ]}
                    placeholder="0.00"
                    placeholderTextColor="#6b7280"
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
                    placeholderTextColor="#6b7280"
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
                  <Ionicons name="chevron-down" size={18} color="#6b7280" />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Stock (Products only) */}
          {itemType === "product" && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Stock</Text>
              <View style={styles.card}>
                <View style={styles.fieldRow}>
                  <View style={[styles.fieldGroup, { flex: 1 }]}>
                    <Text style={styles.fieldLabel}>Opening Stock</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="0"
                      placeholderTextColor="#6b7280"
                      value={stockQuantity}
                      onChangeText={setStockQuantity}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <View style={styles.fieldRowDivider} />
                  <View style={[styles.fieldGroup, { flex: 1 }]}>
                    <Text style={styles.fieldLabel}>Low Stock Alert</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. 10"
                      placeholderTextColor="#6b7280"
                      value={lowStockAlert}
                      onChangeText={setLowStockAlert}
                      keyboardType="decimal-pad"
                    />
                  </View>
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
                <Ionicons name="close" size={22} color="#9ca3af" />
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
                    <Ionicons name="checkmark" size={18} color="#6366f1" />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f0f1a",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a2e",
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1a1a2e",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#ffffff",
  },
  saveButton: {
    backgroundColor: "#6366f1",
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
    color: "#ffffff",
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
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 10,
  },
  typeToggle: {
    flexDirection: "row",
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: "#2d2d44",
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
    backgroundColor: "#6366f1",
  },
  typeOptionText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#6b7280",
  },
  typeOptionTextActive: {
    color: "#ffffff",
  },
  card: {
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#2d2d44",
    paddingHorizontal: 16,
  },
  fieldGroup: {
    paddingVertical: 12,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#9ca3af",
    marginBottom: 6,
  },
  required: {
    color: "#ef4444",
  },
  input: {
    fontSize: 15,
    color: "#ffffff",
    padding: 0,
  },
  inputError: {
    color: "#ef4444",
  },
  errorText: {
    fontSize: 12,
    color: "#ef4444",
    marginTop: 4,
  },
  fieldDivider: {
    height: 1,
    backgroundColor: "#2d2d44",
  },
  fieldRow: {
    flexDirection: "row",
    paddingVertical: 12,
  },
  fieldRowDivider: {
    width: 1,
    backgroundColor: "#2d2d44",
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
    backgroundColor: "#0f0f1a",
    borderWidth: 1,
    borderColor: "#2d2d44",
  },
  taxChipActive: {
    backgroundColor: "#6366f1",
    borderColor: "#6366f1",
  },
  taxChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6b7280",
  },
  taxChipTextActive: {
    color: "#ffffff",
  },
  taxCustomInput: {
    flex: 1,
    backgroundColor: "#0f0f1a",
    borderWidth: 1,
    borderColor: "#2d2d44",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minWidth: 70,
  },
  unitPicker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#0f0f1a",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2d2d44",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  unitPickerValue: {
    fontSize: 15,
    fontWeight: "600",
    color: "#ffffff",
  },
  // Picker Modal
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  pickerSheet: {
    backgroundColor: "#1a1a2e",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "60%",
    borderTopWidth: 1,
    borderColor: "#2d2d44",
  },
  pickerHandle: {
    width: 40,
    height: 4,
    backgroundColor: "#2d2d44",
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
    borderBottomColor: "#2d2d44",
  },
  pickerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#ffffff",
  },
  pickerItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  pickerItemActive: {
    backgroundColor: "rgba(99,102,241,0.1)",
  },
  pickerItemText: {
    fontSize: 15,
    color: "#9ca3af",
    fontWeight: "500",
  },
  pickerItemTextActive: {
    color: "#6366f1",
    fontWeight: "700",
  },
  pickerDivider: {
    height: 1,
    backgroundColor: "#2d2d44",
    marginLeft: 20,
  },
});
