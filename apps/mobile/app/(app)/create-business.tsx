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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState, useRef, forwardRef } from "react";
import { trpc } from "../../src/lib/trpc";
import { useBusinessStore } from "../../src/stores/business";
import { colors } from "../../src/lib/theme";

interface FormState {
  name: string;
  legalName: string;
  phone: string;
  email: string;
  gstRegistrationType: "regular" | "composition" | "unregistered";
  gstin: string;
  pan: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  invoicePrefix: string;
  currency: string;
  paymentPrefix: string;
  quotationPrefix: string;
  creditNotePrefix: string;
  deliveryChallanPrefix: string;
  proformaPrefix: string;
}

const GST_TYPES: Array<{ key: "regular" | "composition" | "unregistered"; label: string }> = [
  { key: "regular", label: "Regular" },
  { key: "composition", label: "Composition" },
  { key: "unregistered", label: "Unregistered" },
];

export default function CreateBusinessScreen() {
  const router = useRouter();
  const setBusiness = useBusinessStore((s) => s.setBusiness);
  const utils = trpc.useUtils();

  const [prefixesExpanded, setPrefixesExpanded] = useState(false);

  const [form, setForm] = useState<FormState>({
    name: "",
    legalName: "",
    phone: "",
    email: "",
    gstRegistrationType: "unregistered",
    gstin: "",
    pan: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    invoicePrefix: "INV",
    currency: "INR",
    paymentPrefix: "PAY",
    quotationPrefix: "QTN",
    creditNotePrefix: "CN",
    deliveryChallanPrefix: "DC",
    proformaPrefix: "PI",
  });

  // Refs for keyboard navigation
  const legalNameRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const gstinRef = useRef<TextInput>(null);
  const panRef = useRef<TextInput>(null);
  const addressRef = useRef<TextInput>(null);
  const cityRef = useRef<TextInput>(null);
  const pincodeRef = useRef<TextInput>(null);
  const stateRef = useRef<TextInput>(null);
  const invoicePrefixRef = useRef<TextInput>(null);
  const paymentPrefixRef = useRef<TextInput>(null);
  const quotationPrefixRef = useRef<TextInput>(null);
  const creditNotePrefixRef = useRef<TextInput>(null);
  const deliveryChallanPrefixRef = useRef<TextInput>(null);
  const proformaPrefixRef = useRef<TextInput>(null);

  const createMutation = trpc.business.create.useMutation({
    onSuccess: async (newBiz) => {
      await setBusiness(newBiz.id, newBiz.name);
      utils.business.list.invalidate();
      router.replace("/(app)/(home)");
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to create business.");
    },
  });

  const handleSave = () => {
    if (!form.name.trim()) {
      Alert.alert("Validation", "Business name is required.");
      return;
    }
    if (!form.phone.trim()) {
      Alert.alert("Validation", "Phone number is required.");
      return;
    }
    if (!form.pan.trim()) {
      Alert.alert("Validation", "PAN is required.");
      return;
    }
    if (!form.address.trim()) {
      Alert.alert("Validation", "Address is required.");
      return;
    }

    createMutation.mutate({
      name: form.name.trim(),
      legalName: form.legalName.trim() || undefined,
      phone: form.phone.trim(),
      email: form.email.trim() || undefined,
      gstRegistrationType: form.gstRegistrationType,
      gstin: form.gstin.trim() || undefined,
      pan: form.pan.trim(),
      address: form.address.trim(),
      city: form.city.trim() || undefined,
      state: form.state.trim() || undefined,
      pincode: form.pincode.trim() || undefined,
      invoicePrefix: form.invoicePrefix.trim() || "INV",
      currency: form.currency.trim() || "INR",
      paymentPrefix: form.paymentPrefix.trim() || "PAY",
      quotationPrefix: form.quotationPrefix.trim() || "QTN",
      creditNotePrefix: form.creditNotePrefix.trim() || "CN",
      deliveryChallanPrefix: form.deliveryChallanPrefix.trim() || "DC",
      proformaPrefix: form.proformaPrefix.trim() || "PI",
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Create Business</Text>
        <TouchableOpacity
          onPress={handleSave}
          style={styles.saveBtn}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? (
            <ActivityIndicator size="small" color={colors.textPrimary} />
          ) : (
            <Text style={styles.saveBtnText}>Create</Text>
          )}
        </TouchableOpacity>
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
          {/* Business Info */}
          <Text style={styles.sectionLabel}>Business Info</Text>

          <Field
            label="Business Name"
            value={form.name}
            onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
            placeholder="Your business name"
            returnKeyType="next"
            onSubmitEditing={() => legalNameRef.current?.focus()}
          />
          <Field
            ref={legalNameRef}
            label="Legal Name"
            value={form.legalName}
            onChangeText={(v) => setForm((f) => ({ ...f, legalName: v }))}
            placeholder="Legal / registered name"
            returnKeyType="next"
            onSubmitEditing={() => phoneRef.current?.focus()}
          />
          <Field
            ref={phoneRef}
            label="Phone"
            value={form.phone}
            onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
            placeholder="+91 9999999999"
            keyboardType="phone-pad"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
          />
          <Field
            ref={emailRef}
            label="Email"
            value={form.email}
            onChangeText={(v) => setForm((f) => ({ ...f, email: v }))}
            placeholder="business@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            onSubmitEditing={() => gstinRef.current?.focus()}
          />

          {/* Tax */}
          <Text style={styles.sectionLabel}>Tax</Text>

          <View style={styles.gstTypeRow}>
            {GST_TYPES.map((t) => (
              <TouchableOpacity
                key={t.key}
                style={[styles.gstPill, form.gstRegistrationType === t.key && styles.gstPillActive]}
                onPress={() => setForm((f) => ({ ...f, gstRegistrationType: t.key }))}
                activeOpacity={0.7}
              >
                <Text style={[styles.gstPillText, form.gstRegistrationType === t.key && styles.gstPillTextActive]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Field
            ref={gstinRef}
            label="GSTIN"
            value={form.gstin}
            onChangeText={(v) => setForm((f) => ({ ...f, gstin: v.toUpperCase() }))}
            placeholder="22AAAAA0000A1Z5"
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="next"
            onSubmitEditing={() => panRef.current?.focus()}
          />
          <Field
            ref={panRef}
            label="PAN"
            value={form.pan}
            onChangeText={(v) => setForm((f) => ({ ...f, pan: v.toUpperCase() }))}
            placeholder="AAAAA0000A"
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="next"
            onSubmitEditing={() => addressRef.current?.focus()}
          />

          {/* Address */}
          <Text style={styles.sectionLabel}>Address</Text>

          <Field
            ref={addressRef}
            label="Street Address"
            value={form.address}
            onChangeText={(v) => setForm((f) => ({ ...f, address: v }))}
            placeholder="Building, Street, Area"
            multiline
            blurOnSubmit
            onSubmitEditing={() => cityRef.current?.focus()}
          />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field
                ref={cityRef}
                label="City"
                value={form.city}
                onChangeText={(v) => setForm((f) => ({ ...f, city: v }))}
                placeholder="City"
                returnKeyType="next"
                onSubmitEditing={() => pincodeRef.current?.focus()}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                ref={pincodeRef}
                label="Pincode"
                value={form.pincode}
                onChangeText={(v) => setForm((f) => ({ ...f, pincode: v }))}
                placeholder="400001"
                keyboardType="number-pad"
                returnKeyType="next"
                onSubmitEditing={() => stateRef.current?.focus()}
              />
            </View>
          </View>
          <Field
            ref={stateRef}
            label="State"
            value={form.state}
            onChangeText={(v) => setForm((f) => ({ ...f, state: v }))}
            placeholder="Maharashtra"
            returnKeyType="done"
          />

          {/* Document Prefixes — collapsible */}
          <TouchableOpacity
            style={styles.collapsibleHeader}
            onPress={() => setPrefixesExpanded((v) => !v)}
            activeOpacity={0.7}
          >
            <View style={styles.collapsibleHeaderLeft}>
              <Text style={styles.sectionLabel} accessibilityRole="none">Document Prefixes</Text>
              <Text style={styles.collapsibleSubtitle}>Customize invoice/document numbering</Text>
            </View>
            <Ionicons
              name={prefixesExpanded ? "chevron-up" : "chevron-down"}
              size={18}
              color={colors.textMuted}
            />
          </TouchableOpacity>

          {prefixesExpanded && (
            <View style={styles.prefixGrid}>
              <View style={styles.prefixRow}>
                <View style={{ flex: 1 }}>
                  <Field
                    ref={invoicePrefixRef}
                    label="Invoice"
                    value={form.invoicePrefix}
                    onChangeText={(v) => setForm((f) => ({ ...f, invoicePrefix: v.toUpperCase() }))}
                    placeholder="INV"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    returnKeyType="next"
                    onSubmitEditing={() => paymentPrefixRef.current?.focus()}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    ref={paymentPrefixRef}
                    label="Payment"
                    value={form.paymentPrefix}
                    onChangeText={(v) => setForm((f) => ({ ...f, paymentPrefix: v.toUpperCase() }))}
                    placeholder="PAY"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    returnKeyType="next"
                    onSubmitEditing={() => quotationPrefixRef.current?.focus()}
                  />
                </View>
              </View>
              <View style={styles.prefixRow}>
                <View style={{ flex: 1 }}>
                  <Field
                    ref={quotationPrefixRef}
                    label="Quotation"
                    value={form.quotationPrefix}
                    onChangeText={(v) => setForm((f) => ({ ...f, quotationPrefix: v.toUpperCase() }))}
                    placeholder="QTN"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    returnKeyType="next"
                    onSubmitEditing={() => creditNotePrefixRef.current?.focus()}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    ref={creditNotePrefixRef}
                    label="Credit Note"
                    value={form.creditNotePrefix}
                    onChangeText={(v) => setForm((f) => ({ ...f, creditNotePrefix: v.toUpperCase() }))}
                    placeholder="CN"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    returnKeyType="next"
                    onSubmitEditing={() => deliveryChallanPrefixRef.current?.focus()}
                  />
                </View>
              </View>
              <View style={styles.prefixRow}>
                <View style={{ flex: 1 }}>
                  <Field
                    ref={deliveryChallanPrefixRef}
                    label="Delivery Challan"
                    value={form.deliveryChallanPrefix}
                    onChangeText={(v) => setForm((f) => ({ ...f, deliveryChallanPrefix: v.toUpperCase() }))}
                    placeholder="DC"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    returnKeyType="next"
                    onSubmitEditing={() => proformaPrefixRef.current?.focus()}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    ref={proformaPrefixRef}
                    label="Proforma"
                    value={form.proformaPrefix}
                    onChangeText={(v) => setForm((f) => ({ ...f, proformaPrefix: v.toUpperCase() }))}
                    placeholder="PI"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    returnKeyType="done"
                  />
                </View>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const Field = forwardRef<
  TextInput,
  {
    label: string;
    value: string;
    onChangeText: (v: string) => void;
    placeholder?: string;
    keyboardType?: any;
    autoCapitalize?: any;
    autoCorrect?: boolean;
    multiline?: boolean;
    returnKeyType?: any;
    onSubmitEditing?: () => void;
    blurOnSubmit?: boolean;
  }
>(function Field(
  {
    label,
    value,
    onChangeText,
    placeholder,
    keyboardType,
    autoCapitalize,
    autoCorrect,
    multiline,
    returnKeyType,
    onSubmitEditing,
    blurOnSubmit,
  },
  ref
) {
  return (
    <View style={fieldStyles.wrapper}>
      <Text style={fieldStyles.label}>{label}</Text>
      <TextInput
        ref={ref}
        style={[fieldStyles.input, multiline && fieldStyles.multiline]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "words"}
        autoCorrect={autoCorrect}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
        returnKeyType={returnKeyType ?? (multiline ? "default" : "next")}
        onSubmitEditing={onSubmitEditing}
        blurOnSubmit={blurOnSubmit ?? (multiline ? true : false)}
      />
    </View>
  );
});

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
  multiline: {
    minHeight: 80,
    textAlignVertical: "top",
  },
});

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
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: { color: colors.textPrimary, fontWeight: "700", fontSize: 14 },
  content: { padding: 16, paddingBottom: 48 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
    marginTop: 8,
  },
  gstTypeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  gstPill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  gstPillActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  gstPillText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  gstPillTextActive: {
    color: colors.textPrimary,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  collapsibleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 8,
    marginBottom: 4,
  },
  collapsibleHeaderLeft: {
    flex: 1,
  },
  collapsibleSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  prefixGrid: {
    gap: 0,
  },
  prefixRow: {
    flexDirection: "row",
    gap: 12,
  },
});
