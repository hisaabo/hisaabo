import { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { trpc } from "../../../../src/lib/trpc";
import { makeStyles } from "../../../../src/lib/makeStyles";
import { useColors } from "../../../../src/contexts/ThemeContext";
import { haptic } from "../../../../src/lib/haptics";
import { DatePickerField } from "../../../../src/components/ui";

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
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();

  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [expenseDate, setExpenseDate] = useState(new Date());
  const [referenceNumber, setReferenceNumber] = useState("");
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);

  const utils = trpc.useUtils();

  const createExpense = trpc.expense.create.useMutation({
    onSuccess: () => {
      utils.expense.list.invalidate();
      utils.dashboard.summary.invalidate();
      utils.bankAccount.list.invalidate();
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

    const dateStr = expenseDate.toISOString();

    haptic.success();
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
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Category */}
        <View style={styles.section}>
          <Text style={styles.label}>Category *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Rent, Utilities, Salaries..."
            placeholderTextColor={colors.textMuted}
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
            placeholderTextColor={colors.textMuted}
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
            placeholderTextColor={colors.textMuted}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            returnKeyType="done"
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
          <DatePickerField
            label="Date"
            value={expenseDate}
            onChange={setExpenseDate}
          />
        </View>

        {/* Reference Number */}
        <View style={styles.section}>
          <Text style={styles.label}>Reference Number (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="Bill no., receipt no., etc."
            placeholderTextColor={colors.textMuted}
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
            <ActivityIndicator color={colors.textPrimary} size="small" />
          ) : (
            <Text style={styles.submitBtnText}>Add Expense</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  section: { marginBottom: 20 },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 15,
  },
  textArea: { minHeight: 80, paddingTop: 12 },
  suggestions: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    marginTop: 4,
    overflow: "hidden",
  },
  suggestionItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  suggestionText: { fontSize: 14, color: colors.textPrimary },
  modeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  modeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  modeChipText: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  submitBtn: {
    backgroundColor: colors.brand,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: colors.textPrimary, fontSize: 16, fontWeight: "700" },
}));
