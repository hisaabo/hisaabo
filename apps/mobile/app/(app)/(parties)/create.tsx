import { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../src/lib/trpc";
import { colors } from "../../../src/lib/theme";
import { haptic } from "../../../src/lib/haptics";

type PartyType = "customer" | "supplier";

export default function CreatePartyScreen() {
  const router = useRouter();
  const utils = trpc.useUtils();

  const [type, setType] = useState<PartyType>("customer");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [gstin, setGstin] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const phoneRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const gstinRef = useRef<TextInput>(null);
  const addressRef = useRef<TextInput>(null);
  const cityRef = useRef<TextInput>(null);
  const stateRef = useRef<TextInput>(null);

  const createParty = trpc.party.create.useMutation({
    onSuccess: () => {
      utils.party.list.invalidate();
      router.back();
    },
    onError: (error) => {
      Alert.alert("Error", error.message || "Failed to create party");
    },
  });

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Name is required";
    if (phone && !/^\d{7,15}$/.test(phone.replace(/[\s+\-()]/g, ""))) {
      newErrors.phone = "Enter a valid phone number";
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = "Enter a valid email";
    }
    if (
      gstin &&
      !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(
        gstin
      )
    ) {
      newErrors.gstin = "Enter a valid GSTIN";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    haptic.success();
    createParty.mutate({
      type,
      name: name.trim(),
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      gstin: gstin.trim() || undefined,
      billingAddress: billingAddress.trim() || undefined,
      city: city.trim() || undefined,
      state: state.trim() || undefined,
      openingBalance: "0",
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
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New Party</Text>
          <TouchableOpacity
            style={[
              styles.saveButton,
              createParty.isPending && styles.saveButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={createParty.isPending}
            activeOpacity={0.8}
          >
            {createParty.isPending ? (
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
          {/* Type Toggle */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Party Type</Text>
            <View style={styles.typeToggle}>
              <TouchableOpacity
                style={[
                  styles.typeOption,
                  type === "customer" && styles.typeOptionActive,
                ]}
                onPress={() => setType("customer")}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="person-outline"
                  size={18}
                  color={type === "customer" ? colors.textPrimary : colors.textMuted}
                />
                <Text
                  style={[
                    styles.typeOptionText,
                    type === "customer" && styles.typeOptionTextActive,
                  ]}
                >
                  Customer
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.typeOption,
                  type === "supplier" && styles.typeOptionActive,
                ]}
                onPress={() => setType("supplier")}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="business-outline"
                  size={18}
                  color={type === "supplier" ? colors.textPrimary : colors.textMuted}
                />
                <Text
                  style={[
                    styles.typeOptionText,
                    type === "supplier" && styles.typeOptionTextActive,
                  ]}
                >
                  Supplier
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
                  placeholder={`${type === "customer" ? "Customer" : "Supplier"} name`}
                  placeholderTextColor={colors.textMuted}
                  value={name}
                  onChangeText={(t) => {
                    setName(t);
                    if (errors.name) setErrors((e) => ({ ...e, name: "" }));
                  }}
                  autoCapitalize="words"
                  returnKeyType="next"
                  onSubmitEditing={() => phoneRef.current?.focus()}
                  blurOnSubmit={false}
                />
                {errors.name && (
                  <Text style={styles.errorText}>{errors.name}</Text>
                )}
              </View>

              <View style={styles.fieldDivider} />

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Phone</Text>
                <TextInput
                  ref={phoneRef}
                  style={[styles.input, errors.phone && styles.inputError]}
                  placeholder="Mobile number"
                  placeholderTextColor={colors.textMuted}
                  value={phone}
                  onChangeText={(t) => {
                    setPhone(t);
                    if (errors.phone) setErrors((e) => ({ ...e, phone: "" }));
                  }}
                  keyboardType="phone-pad"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => emailRef.current?.focus()}
                  blurOnSubmit={false}
                />
                {errors.phone && (
                  <Text style={styles.errorText}>{errors.phone}</Text>
                )}
              </View>

              <View style={styles.fieldDivider} />

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Email</Text>
                <TextInput
                  ref={emailRef}
                  style={[styles.input, errors.email && styles.inputError]}
                  placeholder="email@example.com"
                  placeholderTextColor={colors.textMuted}
                  value={email}
                  onChangeText={(t) => {
                    setEmail(t);
                    if (errors.email) setErrors((e) => ({ ...e, email: "" }));
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => gstinRef.current?.focus()}
                  blurOnSubmit={false}
                />
                {errors.email && (
                  <Text style={styles.errorText}>{errors.email}</Text>
                )}
              </View>
            </View>
          </View>

          {/* Tax Info */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Tax Information</Text>
            <View style={styles.card}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>GSTIN</Text>
                <TextInput
                  ref={gstinRef}
                  style={[styles.input, errors.gstin && styles.inputError]}
                  placeholder="22AAAAA0000A1Z5"
                  placeholderTextColor={colors.textMuted}
                  value={gstin}
                  onChangeText={(t) => {
                    setGstin(t.toUpperCase());
                    if (errors.gstin) setErrors((e) => ({ ...e, gstin: "" }));
                  }}
                  autoCapitalize="characters"
                  maxLength={15}
                  returnKeyType="next"
                  onSubmitEditing={() => addressRef.current?.focus()}
                  blurOnSubmit={false}
                />
                {errors.gstin && (
                  <Text style={styles.errorText}>{errors.gstin}</Text>
                )}
              </View>
            </View>
          </View>

          {/* Address */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Address</Text>
            <View style={styles.card}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Billing Address</Text>
                <TextInput
                  ref={addressRef}
                  style={[styles.input, styles.textArea]}
                  placeholder="Street address"
                  placeholderTextColor={colors.textMuted}
                  value={billingAddress}
                  onChangeText={setBillingAddress}
                  multiline
                  numberOfLines={3}
                  blurOnSubmit={true}
                  returnKeyType="next"
                  onSubmitEditing={() => cityRef.current?.focus()}
                />
              </View>

              <View style={styles.fieldDivider} />

              <View style={styles.fieldRow}>
                <View style={[styles.fieldGroup, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>City</Text>
                  <TextInput
                    ref={cityRef}
                    style={styles.input}
                    placeholder="City"
                    placeholderTextColor={colors.textMuted}
                    value={city}
                    onChangeText={setCity}
                    autoCapitalize="words"
                    returnKeyType="next"
                    onSubmitEditing={() => stateRef.current?.focus()}
                    blurOnSubmit={false}
                  />
                </View>
                <View style={styles.fieldRowDivider} />
                <View style={[styles.fieldGroup, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>State</Text>
                  <TextInput
                    ref={stateRef}
                    style={styles.input}
                    placeholder="State"
                    placeholderTextColor={colors.textMuted}
                    value={state}
                    onChangeText={setState}
                    autoCapitalize="words"
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit}
                  />
                </View>
              </View>
            </View>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
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
  textArea: {
    height: 72,
    textAlignVertical: "top",
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
});
