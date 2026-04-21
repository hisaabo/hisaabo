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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState, useEffect, useRef, forwardRef } from "react";
import { trpc } from "../../../../src/lib/trpc";
import { useBusinessStore } from "../../../../src/stores/business";
import { makeStyles } from "../../../../src/lib/makeStyles";
import { useColors } from "../../../../src/contexts/ThemeContext";
import { QueryError, Skeleton } from "../../../../src/components/ui";

interface FormState {
  name: string;
  legalName: string;
  gstRegistrationType: "regular" | "composition" | "unregistered";
  gstin: string;
  pan: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
}

const GST_TYPES: Array<{ key: "regular" | "composition" | "unregistered"; label: string }> = [
  { key: "regular", label: "Regular" },
  { key: "composition", label: "Composition" },
  { key: "unregistered", label: "Unregistered" },
];

export default function BusinessSettingsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const businessId = useBusinessStore((s) => s.businessId);
  const setBusiness = useBusinessStore((s) => s.setBusiness);

  const legalNameRef = useRef<TextInput>(null);
  const gstinRef = useRef<TextInput>(null);
  const panRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const addressRef = useRef<TextInput>(null);
  const cityRef = useRef<TextInput>(null);
  const pincodeRef = useRef<TextInput>(null);
  const stateRef = useRef<TextInput>(null);

  const [form, setForm] = useState<FormState>({
    name: "",
    legalName: "",
    gstRegistrationType: "unregistered",
    gstin: "",
    pan: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
  });

  const {
    data: biz,
    isLoading,
    isError,
    refetch,
  } = trpc.business.getById.useQuery(
    { id: businessId ?? "" },
    { enabled: !!businessId }
  );

  useEffect(() => {
    if (biz) {
      setForm({
        name: biz.name ?? "",
        legalName: biz.legalName ?? "",
        gstRegistrationType: (biz.gstRegistrationType as any) ?? "unregistered",
        gstin: biz.gstin ?? "",
        pan: biz.pan ?? "",
        phone: biz.phone ?? "",
        email: biz.email ?? "",
        address: biz.address ?? "",
        city: biz.city ?? "",
        state: biz.state ?? "",
        pincode: biz.pincode ?? "",
      });
    }
  }, [biz]);

  const utils = trpc.useUtils();

  const updateMutation = trpc.business.update.useMutation({
    onSuccess: (updated) => {
      if (updated) {
        setBusiness(updated.id, updated.name);
        utils.business.list.invalidate();
        utils.business.getById.invalidate({ id: businessId ?? "" });
      }
      Alert.alert("Saved", "Business details updated successfully.");
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to save changes.");
    },
  });

  const handleSave = () => {
    if (!businessId) return;
    if (!form.name.trim()) {
      Alert.alert("Validation", "Business name is required.");
      return;
    }
    updateMutation.mutate({
      id: businessId,
      data: {
        name: form.name.trim(),
        legalName: form.legalName.trim() || undefined,
        gstRegistrationType: form.gstRegistrationType,
        gstin: form.gstin.trim() || undefined,
        pan: form.pan.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        address: form.address.trim(),
        city: form.city.trim() || undefined,
        state: form.state.trim() || undefined,
        pincode: form.pincode.trim() || undefined,
      },
    });
  };

  if (isError) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Business Details</Text>
          <View style={{ width: 40 }} />
        </View>
        <QueryError message="Failed to load business" onRetry={refetch} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Business Details</Text>
        <TouchableOpacity
          onPress={handleSave}
          style={styles.saveBtn}
          disabled={updateMutation.isPending}
        >
          {updateMutation.isPending ? (
            <ActivityIndicator size="small" color={colors.textPrimary} />
          ) : (
            <Text style={styles.saveBtnText}>Save</Text>
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
        {isLoading ? (
          <>
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} width="100%" height={56} borderRadius={12} style={{ marginBottom: 12 }} />
            ))}
          </>
        ) : (
          <>
            <Text style={styles.sectionLabel}>Basic Info</Text>

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
              onSubmitEditing={() => gstinRef.current?.focus()}
            />

            <Text style={styles.sectionLabel}>GST & Tax</Text>

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
              returnKeyType="next"
              onSubmitEditing={() => phoneRef.current?.focus()}
            />

            <Text style={styles.sectionLabel}>Contact</Text>

            <Field
              ref={phoneRef}
              label="Phone"
              value={form.phone}
              onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
              placeholder="+91 9999999999"
              keyboardType="phone-pad"
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
              onSubmitEditing={() => addressRef.current?.focus()}
            />

            <Text style={styles.sectionLabel}>Address</Text>

            <Field
              ref={addressRef}
              label="Street Address"
              value={form.address}
              onChangeText={(v) => setForm((f) => ({ ...f, address: v }))}
              placeholder="Building, Street, Area"
              multiline
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
              onSubmitEditing={handleSave}
            />

          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const Field = forwardRef<TextInput, {
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
}>(function Field(
  { label, value, onChangeText, placeholder, keyboardType, autoCapitalize, autoCorrect, multiline, returnKeyType, onSubmitEditing, blurOnSubmit },
  ref
) {
  const fieldStyles = useFieldStyles();
  const colors = useColors();
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
  multiline: {
    minHeight: 80,
    textAlignVertical: "top",
  },
}));

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
}));
