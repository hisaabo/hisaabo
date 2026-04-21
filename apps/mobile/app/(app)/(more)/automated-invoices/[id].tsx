import { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";
import { formatCurrency, formatDate } from "../../../../src/lib/utils";
import { makeStyles } from "../../../../src/lib/makeStyles";
import { useColors } from "../../../../src/contexts/ThemeContext";
import { haptic } from "../../../../src/lib/haptics";
import { QueryError } from "../../../../src/components/ui";

/* ── Constants ────────────────────────────────────────────────── */

type TemplateStatus = "active" | "paused" | "completed" | "expired";

const STATUS_COLORS: Record<TemplateStatus, { bg: string; text: string; label: string }> = {
  active: { bg: "rgba(16, 185, 129, 0.15)", text: "#10b981", label: "Active" },
  paused: { bg: "rgba(245, 158, 11, 0.15)", text: "#f59e0b", label: "Paused" },
  completed: { bg: "rgba(59, 130, 246, 0.15)", text: "#3b82f6", label: "Completed" },
  expired: { bg: "rgba(156, 163, 175, 0.15)", text: "#9ca3af", label: "Expired" },
};

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_yearly: "Half Yearly",
  yearly: "Yearly",
  custom: "Custom",
};

const RUN_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  success: { bg: "rgba(16, 185, 129, 0.15)", text: "#10b981" },
  failed: { bg: "rgba(239, 68, 68, 0.15)", text: "#ef4444" },
  skipped: { bg: "rgba(245, 158, 11, 0.15)", text: "#f59e0b" },
};

/* ── Main Screen ──────────────────────────────────────────────── */

export default function RecurringInvoiceDetailScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editMaxRuns, setEditMaxRuns] = useState("");
  const [historyPage] = useState(1);

  const {
    data: template,
    isLoading,
    refetch,
    isRefetching,
  } = trpc.recurringInvoice.getById.useQuery(
    { id: id! },
    { enabled: !!id }
  );

  const { data: historyData, refetch: refetchHistory } = trpc.recurringInvoice.executionHistory.useQuery(
    { templateId: id!, page: historyPage, limit: 20 },
    { enabled: !!id }
  );

  const updateMutation = trpc.recurringInvoice.update.useMutation({
    onSuccess: () => {
      utils.recurringInvoice.getById.invalidate({ id: id! });
      utils.recurringInvoice.list.invalidate();
      setIsEditing(false);
      refetch();
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to update template");
    },
  });

  const deleteMutation = trpc.recurringInvoice.delete.useMutation({
    onSuccess: () => {
      utils.recurringInvoice.list.invalidate();
      router.back();
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to delete template");
    },
  });

  const pauseMutation = trpc.recurringInvoice.pause.useMutation({
    onSuccess: () => {
      haptic.success();
      utils.recurringInvoice.getById.invalidate({ id: id! });
      utils.recurringInvoice.list.invalidate();
      refetch();
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to pause template");
    },
  });

  const resumeMutation = trpc.recurringInvoice.resume.useMutation({
    onSuccess: () => {
      haptic.success();
      utils.recurringInvoice.getById.invalidate({ id: id! });
      utils.recurringInvoice.list.invalidate();
      refetch();
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to resume template");
    },
  });

  const runNowMutation = trpc.recurringInvoice.runNow.useMutation({
    onSuccess: () => {
      haptic.success();
      Alert.alert("Success", "Invoice generated successfully");
      utils.recurringInvoice.getById.invalidate({ id: id! });
      utils.recurringInvoice.list.invalidate();
      refetch();
      refetchHistory();
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to generate invoice");
    },
  });

  /* ── Handlers ─────────────────────────────────────────────── */

  const handleStartEdit = useCallback(() => {
    if (!template) return;
    setEditName(template.name);
    setEditNotes(template.notes ?? "");
    setEditMaxRuns(template.maxRuns != null ? String(template.maxRuns) : "");
    setIsEditing(true);
  }, [template]);

  const handleSave = useCallback(() => {
    if (!template) return;
    if (!editName.trim()) {
      Alert.alert("Validation", "Name is required");
      return;
    }
    haptic.success();
    updateMutation.mutate({
      id: template.id,
      data: {
        name: editName.trim(),
        notes: editNotes.trim() || undefined,
        maxRuns: editMaxRuns ? parseInt(editMaxRuns) : null,
      },
    });
  }, [template, editName, editNotes, editMaxRuns, updateMutation]);

  const handleDelete = useCallback(() => {
    if (!template) return;
    Alert.alert(
      "Delete Template",
      `Delete "${template.name}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            haptic.error();
            deleteMutation.mutate({ id: template.id });
          },
        },
      ]
    );
  }, [template, deleteMutation]);

  const handlePauseResume = useCallback(() => {
    if (!template) return;
    if (template.status === "active") {
      Alert.alert("Pause Template", "Pause this recurring invoice?", [
        { text: "Cancel", style: "cancel" },
        { text: "Pause", onPress: () => pauseMutation.mutate({ id: template.id }) },
      ]);
    } else if (template.status === "paused") {
      Alert.alert("Resume Template", "Resume this recurring invoice?", [
        { text: "Cancel", style: "cancel" },
        { text: "Resume", onPress: () => resumeMutation.mutate({ id: template.id }) },
      ]);
    }
  }, [template, pauseMutation, resumeMutation]);

  const handleRunNow = useCallback(() => {
    if (!template) return;
    Alert.alert("Run Now", "Generate an invoice from this template immediately?", [
      { text: "Cancel", style: "cancel" },
      { text: "Run Now", onPress: () => runNowMutation.mutate({ id: template.id }) },
    ]);
  }, [template, runNowMutation]);

  /* ── Loading / Error ──────────────────────────────────────── */

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!template) {
    return (
      <SafeAreaView style={styles.container}>
        <QueryError message="Recurring invoice template not found" onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  const statusColor = STATUS_COLORS[template.status as TemplateStatus] ?? STATUS_COLORS.expired;
  const freqLabel = FREQUENCY_LABELS[template.frequency] ?? template.frequency;
  const lineItems = (template.lineItems ?? []) as Array<{
    // Bug B: itemName is the required snapshot; description is optional notes.
    itemName: string;
    description?: string | null;
    quantity: string;
    unitPrice: string;
    taxPercent?: string;
    discountPercent?: string;
  }>;
  const runs = historyData?.data ?? [];
  const isMutating = pauseMutation.isPending || resumeMutation.isPending || runNowMutation.isPending;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {isEditing ? "Edit Template" : template.name}
          </Text>
        </View>
        <View style={styles.headerActions}>
          {!isEditing && (
            <>
              <TouchableOpacity onPress={handleStartEdit} style={styles.editBtn}>
                <Ionicons name="create-outline" size={20} color={colors.brand} />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleDelete} style={styles.deleteBtn}>
                <Ionicons name="trash-outline" size={20} color={colors.danger} />
              </TouchableOpacity>
            </>
          )}
          {isEditing && (
            <>
              <TouchableOpacity onPress={() => setIsEditing(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSave}
                style={[styles.saveBtn, updateMutation.isPending && styles.saveBtnDisabled]}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? (
                  <ActivityIndicator size="small" color={colors.textPrimary} />
                ) : (
                  <Text style={styles.saveBtnText}>Save</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => { refetch(); refetchHistory(); }}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
      >
        {/* Status & Summary Card */}
        <View style={styles.statusCard}>
          <View style={styles.statusCardRow}>
            <View style={[styles.statusBadgeLarge, { backgroundColor: statusColor.bg }]}>
              <Text style={[styles.statusBadgeLargeText, { color: statusColor.text }]}>
                {statusColor.label}
              </Text>
            </View>
            <Text style={styles.typeLabel}>
              {template.type === "sale" ? "Sale" : "Purchase"}
            </Text>
          </View>
          <Text style={styles.statusCardParty}>{template.partyName ?? "Unknown party"}</Text>
          <View style={styles.statusCardMeta}>
            <View style={styles.metaItem}>
              <Ionicons name="sync-outline" size={14} color={colors.textMuted} />
              <Text style={styles.metaText}>{freqLabel}</Text>
            </View>
            <View style={styles.metaItem}>
              <Ionicons name="checkmark-done-outline" size={14} color={colors.textMuted} />
              <Text style={styles.metaText}>
                {template.totalRuns ?? 0} runs{template.maxRuns ? ` / ${template.maxRuns}` : ""}
              </Text>
            </View>
          </View>
        </View>

        {/* Action Buttons */}
        {!isEditing && (template.status === "active" || template.status === "paused") && (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[
                styles.actionBtn,
                template.status === "active"
                  ? { backgroundColor: colors.amberBg, borderColor: colors.amber }
                  : { backgroundColor: colors.successBg, borderColor: colors.success },
              ]}
              onPress={handlePauseResume}
              disabled={isMutating}
              activeOpacity={0.8}
            >
              {(pauseMutation.isPending || resumeMutation.isPending) ? (
                <ActivityIndicator size="small" color={colors.textPrimary} />
              ) : (
                <>
                  <Ionicons
                    name={template.status === "active" ? "pause" : "play"}
                    size={18}
                    color={template.status === "active" ? colors.amber : colors.success}
                  />
                  <Text
                    style={[
                      styles.actionBtnText,
                      { color: template.status === "active" ? colors.amber : colors.success },
                    ]}
                  >
                    {template.status === "active" ? "Pause" : "Resume"}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.brandLight, borderColor: colors.brand }]}
              onPress={handleRunNow}
              disabled={isMutating}
              activeOpacity={0.8}
            >
              {runNowMutation.isPending ? (
                <ActivityIndicator size="small" color={colors.brand} />
              ) : (
                <>
                  <Ionicons name="flash" size={18} color={colors.brand} />
                  <Text style={[styles.actionBtnText, { color: colors.brand }]}>Run Now</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Details Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Template Details</Text>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Name</Text>
            {isEditing ? (
              <TextInput
                style={styles.inlineInput}
                value={editName}
                onChangeText={setEditName}
                placeholder="Template name"
                placeholderTextColor={colors.textMuted}
              />
            ) : (
              <Text style={styles.detailValue}>{template.name}</Text>
            )}
          </View>

          <View style={styles.detailDivider} />

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Party</Text>
            <Text style={styles.detailValue}>{template.partyName ?? "Unknown"}</Text>
          </View>

          <View style={styles.detailDivider} />

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Type</Text>
            <Text style={styles.detailValue}>
              {template.type === "sale" ? "Sale" : "Purchase"}
            </Text>
          </View>

          <View style={styles.detailDivider} />

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Frequency</Text>
            <Text style={styles.detailValue}>
              {freqLabel}
              {template.frequency === "custom" && template.customIntervalDays
                ? ` (${template.customIntervalDays} days)`
                : ""}
            </Text>
          </View>

          <View style={styles.detailDivider} />

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Start Date</Text>
            <Text style={styles.detailValue}>
              {template.startDate ? formatDate(template.startDate) : "--"}
            </Text>
          </View>

          <View style={styles.detailDivider} />

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>End Date</Text>
            <Text style={styles.detailValue}>
              {template.endDate ? formatDate(template.endDate) : "None"}
            </Text>
          </View>

          <View style={styles.detailDivider} />

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Next Run</Text>
            <Text style={styles.detailValue}>
              {template.nextRunDate && template.status === "active"
                ? formatDate(template.nextRunDate)
                : "--"}
            </Text>
          </View>

          <View style={styles.detailDivider} />

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Last Run</Text>
            <Text style={styles.detailValue}>
              {template.lastRunDate ? formatDate(template.lastRunDate) : "Never"}
            </Text>
          </View>

          <View style={styles.detailDivider} />

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Max Runs</Text>
            {isEditing ? (
              <TextInput
                style={styles.inlineInput}
                value={editMaxRuns}
                onChangeText={setEditMaxRuns}
                placeholder="Unlimited"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
              />
            ) : (
              <Text style={styles.detailValue}>
                {template.maxRuns != null ? String(template.maxRuns) : "Unlimited"}
              </Text>
            )}
          </View>

          <View style={styles.detailDivider} />

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Notes</Text>
            {isEditing ? (
              <TextInput
                style={[styles.inlineInput, styles.notesInput]}
                value={editNotes}
                onChangeText={setEditNotes}
                placeholder="Notes..."
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={2}
                textAlignVertical="top"
              />
            ) : (
              <Text style={styles.detailValue}>{template.notes ?? "--"}</Text>
            )}
          </View>
        </View>

        {/* Line Items Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Line Items</Text>
          {lineItems.length === 0 ? (
            <Text style={styles.emptyText}>No line items</Text>
          ) : (
            lineItems.map((li, i) => {
              const qty = parseFloat(li.quantity || "0");
              const price = parseFloat(li.unitPrice || "0");
              const total = qty * price;
              return (
                <View key={i}>
                  {i > 0 && <View style={styles.detailDivider} />}
                  <View style={styles.lineItemRow}>
                    <View style={{ flex: 1 }}>
                      {/* Bug B: itemName is the primary display; description
                          is the optional italic notes line beneath. */}
                      <Text style={styles.lineItemDesc}>{li.itemName}</Text>
                      {li.description && li.description.trim().length > 0 && (
                        <Text style={styles.lineItemNotes} numberOfLines={3}>{li.description}</Text>
                      )}
                      <Text style={styles.lineItemMeta}>
                        {li.quantity} x {formatCurrency(li.unitPrice)}
                        {li.taxPercent && li.taxPercent !== "0" ? ` (GST ${li.taxPercent}%)` : ""}
                        {li.discountPercent && li.discountPercent !== "0" ? ` (-${li.discountPercent}%)` : ""}
                      </Text>
                    </View>
                    <Text style={styles.lineItemTotal}>{formatCurrency(total)}</Text>
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* Execution History */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Execution History</Text>
          {runs.length === 0 ? (
            <Text style={styles.emptyText}>No runs yet</Text>
          ) : (
            runs.map((run, i) => {
              const runStatus = RUN_STATUS_COLORS[run.status] ?? RUN_STATUS_COLORS.failed;
              return (
                <View key={run.id}>
                  {i > 0 && <View style={styles.detailDivider} />}
                  <View style={styles.historyRow}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <View style={styles.historyRowTop}>
                        <View style={[styles.runStatusBadge, { backgroundColor: runStatus.bg }]}>
                          <Text style={[styles.runStatusText, { color: runStatus.text }]}>
                            {run.status.charAt(0).toUpperCase() + run.status.slice(1)}
                          </Text>
                        </View>
                        {run.invoiceNumber && (
                          <Text style={styles.invoiceNumber}>#{run.invoiceNumber}</Text>
                        )}
                      </View>
                      <Text style={styles.historyDate}>
                        {run.executedAt ? formatDate(run.executedAt) : "--"}
                      </Text>
                      {run.errorMessage && (
                        <Text style={styles.errorMessage} numberOfLines={2}>{run.errorMessage}</Text>
                      )}
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* Delete Button */}
        {!isEditing && (
          <TouchableOpacity
            style={styles.deleteBtnFull}
            onPress={handleDelete}
            activeOpacity={0.8}
          >
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
            <Text style={styles.deleteBtnText}>Delete Template</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* ── Styles ────────────────────────────────────────────────────── */

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: "700", color: colors.textPrimary },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  editBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(239,68,68,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelBtnText: { fontSize: 14, color: colors.textSecondary, fontWeight: "600" },
  saveBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.brand,
    minWidth: 60,
    alignItems: "center",
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  content: { padding: 16, paddingBottom: 40 },

  // Status Card
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 12,
  },
  statusCardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  statusBadgeLarge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  statusBadgeLargeText: { fontSize: 13, fontWeight: "700" },
  typeLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  statusCardParty: { fontSize: 18, fontWeight: "700", color: colors.textPrimary, marginBottom: 10 },
  statusCardMeta: { flexDirection: "row", gap: 16 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontSize: 13, color: colors.textMuted },

  // Action Buttons
  actionRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionBtnText: { fontSize: 14, fontWeight: "700" },

  // Details Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingVertical: 10,
    gap: 12,
  },
  detailLabel: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: "600",
    minWidth: 90,
  },
  detailValue: {
    fontSize: 14,
    color: colors.textPrimary,
    flex: 1,
    textAlign: "right",
  },
  detailDivider: { height: 1, backgroundColor: colors.border },
  inlineInput: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    textAlign: "right",
    borderBottomWidth: 1,
    borderBottomColor: colors.brand,
    paddingBottom: 2,
  },
  notesInput: {
    minHeight: 48,
    textAlign: "left",
    textAlignVertical: "top",
  },

  // Line Items
  lineItemRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    gap: 12,
  },
  lineItemDesc: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  lineItemNotes: { fontSize: 11, fontStyle: "italic", color: colors.textSecondary, marginTop: 2, lineHeight: 14 },
  lineItemMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  lineItemTotal: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },

  // Execution History
  historyRow: { paddingVertical: 10 },
  historyRowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  runStatusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  runStatusText: { fontSize: 11, fontWeight: "600" },
  invoiceNumber: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  historyDate: { fontSize: 12, color: colors.textMuted },
  errorMessage: { fontSize: 12, color: colors.danger, marginTop: 2 },
  emptyText: { fontSize: 13, color: colors.textMuted, paddingVertical: 8 },

  // Delete Button
  deleteBtnFull: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(239,68,68,0.08)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 4,
  },
  deleteBtnText: { fontSize: 15, fontWeight: "600", color: colors.danger },
}));
