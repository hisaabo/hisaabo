import { useState, useCallback } from "react";
import {
  View,
  Text,
  SafeAreaView,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";

type PaymentMode = "cash" | "bank" | "upi" | "cheque" | "other";

const PAYMENT_MODES: { value: PaymentMode; label: string; color: string }[] = [
  { value: "cash", label: "Cash", color: "#22c55e" },
  { value: "upi", label: "UPI", color: "#a855f7" },
  { value: "bank", label: "Bank", color: "#3b82f6" },
  { value: "cheque", label: "Cheque", color: "#f59e0b" },
  { value: "other", label: "Other", color: "#9ca3af" },
];

const COMMON_CATEGORIES = [
  "Rent", "Utilities", "Salaries", "Office Supplies", "Travel", "Marketing",
  "Maintenance", "Insurance", "Fuel", "Food & Entertainment",
];

export default function CreateExpenseScreen() {
  const router = useRouter();

  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [referenceNumber, setReferenceNumber] = useState("");
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);

  const createExpense = trpc.expense.create.useMutation({
    onSuccess: () => {
      Alert.alert("Success", "Expense recorded successfully", [
        { text: "OK", onPress: () => router.back() },
      ]);
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to create expense");
    },
  });

  const filteredCategories = COMMON_CATEGORIES.filter((c) =>
    c.toLowerCase().includes(category.toLowerCase())
  );

  const handleSubmit = useCallback(() => {
    if (!category.trim()) {
      Alert.alert("Validation", "Please enter a category");
      return;
    }
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      Alert.alert("Validation", "Please enter a valid amount");
      return;
    }

    const dateStr = new Date(expenseDate + "T00:00:00.000Z").toISOString();

    createExpense.mutate({
      category: category.trim(),
      description: description.trim() || undefined,
      amount: parseFloat(amount).toFixed(2),
      mode,
      expenseDate: dateStr,
      referenceNumber: referenceNumber.trim() || undefined,
    });
  }, [category, description, amount, mode, expenseDate, referenceNumber, createExpense]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.title}>Add Expense</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Category */}
        <View style={styles.section}>
          <Text style={styles.label}>Category *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Rent, Utilities, Salaries..."
            placeholderTextColor="#6b7280"
            value={category}
            onChangeText={(v) => { setCategory(v); setShowCategorySuggestions(true); }}
            onFocus={() => setShowCategorySuggestions(true)}
            onBlur={() => setTimeout(() => setShowCategorySuggestions(false), 150)}
          />
          {showCategorySuggestions && filteredCategories.length > 0 && (
            <View style={styles.suggestions}>
              {filteredCategories.slice(0, 5).map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={styles.suggestionItem}
                  onPress={() => { setCategory(cat); setShowCategorySuggestions(false); }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.suggestionText}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Description */}
        <View style={styles.section}>
          <Text style={styles.label}>Description (optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Describe the expense..."
            placeholderTextColor="#6b7280"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        {/* Amount */}
        <View style={styles.section}>
          <Text style={styles.label}>Amount *</Text>
          <TextInput
            style={styles.input}
            placeholder="0.00"
            placeholderTextColor="#6b7280"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />
        </View>

        {/* Payment Mode */}
        <View style={styles.section}>
          <Text style={styles.label}>Payment Mode *</Text>
          <View style={styles.modeRow}>
            {PAYMENT_MODES.map((m) => (
              <TouchableOpacity
                key={m.value}
                style={[
                  styles.modeChip,
                  mode === m.value && { backgroundColor: m.color + "22", borderColor: m.color },
                ]}
                onPress={() => setMode(m.value)}
                activeOpacity={0.7}
              >
                <Text style={[styles.modeChipText, mode === m.value && { color: m.color }]}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Date */}
        <View style={styles.section}>
          <Text style={styles.label}>Date</Text>
          <TextInput
            style={styles.input}
            value={expenseDate}
            onChangeText={setExpenseDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#6b7280"
          />
        </View>

        {/* Reference Number */}
        <View style={styles.section}>
          <Text style={styles.label}>Reference Number (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="Bill no., receipt no., etc."
            placeholderTextColor="#6b7280"
            value={referenceNumber}
            onChangeText={setReferenceNumber}
          />
        </View>

        {/* Submit */}
        <TouchableOpacity
          style={[styles.submitBtn, createExpense.isPending && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={createExpense.isPending}
          activeOpacity={0.85}
        >
          {createExpense.isPending ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Text style={styles.submitBtnText}>Add Expense</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f1a" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#2d2d44",
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "700", color: "#ffffff" },
  content: { padding: 16, paddingBottom: 40 },
  section: { marginBottom: 20 },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: "#9ca3af",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: "#1a1a2e",
    borderWidth: 1,
    borderColor: "#2d2d44",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#ffffff",
    fontSize: 15,
  },
  textArea: { minHeight: 80, paddingTop: 12 },
  suggestions: {
    backgroundColor: "#1a1a2e",
    borderWidth: 1,
    borderColor: "#2d2d44",
    borderRadius: 12,
    marginTop: 4,
    overflow: "hidden",
  },
  suggestionItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#2d2d44",
  },
  suggestionText: { fontSize: 14, color: "#ffffff" },
  modeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  modeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#2d2d44",
    backgroundColor: "#1a1a2e",
  },
  modeChipText: { fontSize: 13, fontWeight: "600", color: "#9ca3af" },
  submitBtn: {
    backgroundColor: "#6366f1",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: "#ffffff", fontSize: 16, fontWeight: "700" },
});
