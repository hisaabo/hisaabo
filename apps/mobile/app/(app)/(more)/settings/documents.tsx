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
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState, useEffect } from "react";
import { trpc } from "../../../../src/lib/trpc";
import { useBusinessStore } from "../../../../src/stores/business";
import { colors } from "../../../../src/lib/theme";
import { QueryError, Skeleton } from "../../../../src/components/ui";

const DOC_TYPES = [
  { key: "invoice" as const, label: "Invoice", prefixField: "invoicePrefix", counterField: "nextInvoiceNumber" },
  { key: "payment" as const, label: "Payment Receipt", prefixField: "paymentPrefix", counterField: "nextPaymentNumber" },
  { key: "quotation" as const, label: "Quotation", prefixField: "quotationPrefix", counterField: "nextQuotationNumber" },
  { key: "credit_note" as const, label: "Credit Note", prefixField: "creditNotePrefix", counterField: "nextCreditNoteNumber" },
  { key: "delivery_challan" as const, label: "Delivery Challan", prefixField: "deliveryChallanPrefix", counterField: "nextDeliveryChallanNumber" },
  { key: "proforma" as const, label: "Proforma Invoice", prefixField: "proformaPrefix", counterField: "nextProformaNumber" },
] as const;

type DocTypeKey = typeof DOC_TYPES[number]["key"];
type PrefixField = typeof DOC_TYPES[number]["prefixField"];
interface SeqEditorState {
  docKey: DocTypeKey;
  label: string;
  currentValue: number;
}

export default function DocumentsScreen() {
  const router = useRouter();
  const businessId = useBusinessStore((s) => s.businessId);

  const [prefixes, setPrefixes] = useState<Record<PrefixField, string>>({
    invoicePrefix: "",
    paymentPrefix: "",
    quotationPrefix: "",
    creditNotePrefix: "",
    deliveryChallanPrefix: "",
    proformaPrefix: "",
  });
  const [prefixesDirty, setPrefixesDirty] = useState(false);
  const [seqEditor, setSeqEditor] = useState<SeqEditorState | null>(null);
  const [seqValue, setSeqValue] = useState("");

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
      setPrefixes({
        invoicePrefix: biz.invoicePrefix ?? "INV",
        paymentPrefix: biz.paymentPrefix ?? "PAY",
        quotationPrefix: biz.quotationPrefix ?? "QTN",
        creditNotePrefix: biz.creditNotePrefix ?? "CN",
        deliveryChallanPrefix: biz.deliveryChallanPrefix ?? "DC",
        proformaPrefix: biz.proformaPrefix ?? "PI",
      });
      setPrefixesDirty(false);
    }
  }, [biz]);

  const utils = trpc.useUtils();

  const updateMutation = trpc.business.update.useMutation({
    onSuccess: () => {
      utils.business.list.invalidate();
      utils.business.getById.invalidate({ id: businessId ?? "" });
      setPrefixesDirty(false);
      Alert.alert("Saved", "Document prefixes updated.");
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to save prefixes.");
    },
  });

  const updateSeqMutation = trpc.business.updateSequenceNumber.useMutation({
    onSuccess: () => {
      utils.business.list.invalidate();
      utils.business.getById.invalidate({ id: businessId ?? "" });
      setSeqEditor(null);
      Alert.alert("Updated", "Sequence number updated.");
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to update sequence number.");
    },
  });

  const handlePrefixChange = (field: PrefixField, value: string) => {
    setPrefixes((prev) => ({ ...prev, [field]: value.toUpperCase() }));
    setPrefixesDirty(true);
  };

  const handleSavePrefixes = () => {
    if (!businessId) return;
    updateMutation.mutate({
      id: businessId,
      data: {
        invoicePrefix: prefixes.invoicePrefix || undefined,
        paymentPrefix: prefixes.paymentPrefix || undefined,
        quotationPrefix: prefixes.quotationPrefix || undefined,
        creditNotePrefix: prefixes.creditNotePrefix || undefined,
        deliveryChallanPrefix: prefixes.deliveryChallanPrefix || undefined,
        proformaPrefix: prefixes.proformaPrefix || undefined,
      },
    });
  };

  const handleOpenSeqEditor = (doc: typeof DOC_TYPES[number]) => {
    if (!biz) return;
    const currentValue = (biz as any)[doc.counterField] ?? 1;
    setSeqValue(String(currentValue));
    setSeqEditor({ docKey: doc.key, label: doc.label, currentValue });
  };

  const handleConfirmSeq = () => {
    if (!businessId || !seqEditor) return;
    const parsed = parseInt(seqValue, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      Alert.alert("Validation", "Enter a valid number (minimum 1).");
      return;
    }
    updateSeqMutation.mutate({
      businessId,
      documentType: seqEditor.docKey,
      newNumber: parsed,
    });
  };

  const formatPreview = (prefix: string, counter: number) => {
    const padded = String(counter).padStart(5, "0");
    return `${prefix || "..."}-${padded}`;
  };

  if (isError) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Documents</Text>
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
        <Text style={styles.title}>Documents</Text>
        {prefixesDirty ? (
          <TouchableOpacity
            onPress={handleSavePrefixes}
            style={styles.saveBtn}
            disabled={updateMutation.isPending}
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
                <Skeleton key={i} width="100%" height={72} borderRadius={12} style={{ marginBottom: 12 }} />
              ))}
            </>
          ) : (
            <>
              {/* Document Prefixes */}
              <Text style={styles.sectionLabel}>Document Prefixes</Text>
              <Text style={styles.sectionHint}>
                Prefix used when generating document numbers (e.g. INV-00001)
              </Text>

              <View style={styles.prefixCard}>
                {DOC_TYPES.map((doc, index) => {
                  const isLast = index === DOC_TYPES.length - 1;
                  const currentCounter = biz ? ((biz as any)[doc.counterField] ?? 1) : 1;
                  return (
                    <View
                      key={doc.key}
                      style={[styles.prefixRow, !isLast && styles.prefixRowBorder]}
                    >
                      <View style={styles.prefixLeft}>
                        <Text style={styles.prefixDocLabel}>{doc.label}</Text>
                        <Text style={styles.prefixPreview}>
                          {formatPreview(prefixes[doc.prefixField], currentCounter)}
                        </Text>
                      </View>
                      <TextInput
                        style={styles.prefixInput}
                        value={prefixes[doc.prefixField]}
                        onChangeText={(v) => handlePrefixChange(doc.prefixField, v)}
                        placeholder="INV"
                        placeholderTextColor={colors.textMuted}
                        autoCapitalize="characters"
                        maxLength={10}
                        returnKeyType="done"
                      />
                    </View>
                  );
                })}
              </View>

              {/* Sequence Numbers */}
              <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Current Sequence Numbers</Text>
              <Text style={styles.sectionHint}>
                The next document number that will be assigned. Tap to advance.
              </Text>

              <View style={styles.seqCard}>
                {DOC_TYPES.map((doc, index) => {
                  const isLast = index === DOC_TYPES.length - 1;
                  const currentCounter = biz ? ((biz as any)[doc.counterField] ?? 1) : 1;
                  return (
                    <View
                      key={doc.key}
                      style={[styles.seqRow, !isLast && styles.seqRowBorder]}
                    >
                      <View style={styles.seqLeft}>
                        <Text style={styles.seqDocLabel}>{doc.label}</Text>
                        <Text style={styles.seqNext}>
                          Next: {prefixes[doc.prefixField] || "..."}-
                          {String(currentCounter).padStart(5, "0")}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.seqChangeBtn}
                        onPress={() => handleOpenSeqEditor(doc)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.seqChangeBtnText}>Change</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Sequence Number Editor Modal */}
      <Modal
        visible={seqEditor !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSeqEditor(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change Sequence Number</Text>
              <TouchableOpacity
                onPress={() => setSeqEditor(null)}
                style={styles.modalClose}
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {seqEditor && (
              <>
                <View style={styles.warningBanner}>
                  <Ionicons name="warning-outline" size={16} color={colors.amber} />
                  <Text style={styles.warningText}>
                    Changing the sequence number for{" "}
                    <Text style={styles.warningBold}>{seqEditor.label}</Text> will
                    affect future document numbering. This cannot be decreased below
                    the current value ({seqEditor.currentValue}).
                  </Text>
                </View>

                <Text style={styles.fieldLabel}>Next Number</Text>
                <TextInput
                  style={styles.seqInput}
                  value={seqValue}
                  onChangeText={setSeqValue}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  placeholderTextColor={colors.textMuted}
                  autoFocus
                />

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={() => setSeqEditor(null)}
                    disabled={updateSeqMutation.isPending}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmBtn, updateSeqMutation.isPending && { opacity: 0.6 }]}
                    onPress={handleConfirmSeq}
                    disabled={updateSeqMutation.isPending}
                    activeOpacity={0.8}
                  >
                    {updateSeqMutation.isPending ? (
                      <ActivityIndicator color={colors.textPrimary} size="small" />
                    ) : (
                      <Text style={styles.confirmBtnText}>Confirm Change</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

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
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  sectionHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 12,
    lineHeight: 17,
  },

  // Prefix card
  prefixCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  prefixRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  prefixRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  prefixLeft: { flex: 1 },
  prefixDocLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: 2,
  },
  prefixPreview: {
    fontSize: 11,
    color: colors.textMuted,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  prefixInput: {
    width: 80,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },

  // Sequence card
  seqCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  seqRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  seqRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  seqLeft: { flex: 1 },
  seqDocLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: 3,
  },
  seqNext: {
    fontSize: 12,
    color: colors.brand,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontWeight: "600",
  },
  seqChangeBtn: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  seqChangeBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  modalClose: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: colors.amber + "18",
    borderWidth: 1,
    borderColor: colors.amber + "40",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  warningBold: {
    fontWeight: "700",
    color: colors.textPrimary,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  seqInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 20,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelBtnText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: "600",
  },
  confirmBtn: {
    flex: 2,
    backgroundColor: colors.brand,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  confirmBtnText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
});
