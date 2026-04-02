import { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";
import { formatDateShort } from "../../../../src/lib/utils";
import { colors } from "../../../../src/lib/theme";
import { FAB, EmptyState } from "../../../../src/components/ui";

/* ── Status styling ───────────────────────────────────────────── */

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

/* ── Filter chips ─────────────────────────────────────────────── */

const STATUS_FILTERS: { value: TemplateStatus | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
  { value: "expired", label: "Expired" },
];

const PAGE_SIZE = 20;

export default function AutomatedInvoicesScreen() {
  const router = useRouter();
  const [selectedStatus, setSelectedStatus] = useState<TemplateStatus | null>(null);
  const [page, setPage] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data, isLoading, refetch } = trpc.recurringInvoice.list.useQuery({
    page,
    limit: PAGE_SIZE,
    status: selectedStatus ?? undefined,
  });

  const { data: usageData } = trpc.recurringInvoice.planUsage.useQuery();

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setPage(1);
    await refetch();
    setIsRefreshing(false);
  }, [refetch]);

  const handleStatusSelect = useCallback((status: TemplateStatus | null) => {
    setSelectedStatus(status);
    setPage(1);
  }, []);

  const templates = data?.data ?? [];
  const usage = usageData ?? { runsThisMonth: 0, totalTemplates: 0 };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Recurring Invoices</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Usage Summary */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{usage.totalTemplates}</Text>
            <Text style={styles.summaryLabel}>Templates</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{usage.runsThisMonth}</Text>
            <Text style={styles.summaryLabel}>Runs This Month</Text>
          </View>
        </View>
      </View>

      {/* Status Filter Chips */}
      <FlatList
        data={STATUS_FILTERS}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        keyExtractor={(item) => item.label}
        renderItem={({ item }) => {
          const isActive = selectedStatus === item.value;
          const statusColor = item.value ? STATUS_COLORS[item.value] : null;
          return (
            <TouchableOpacity
              style={[
                styles.chip,
                isActive && (statusColor
                  ? { backgroundColor: statusColor.bg, borderColor: statusColor.text }
                  : styles.chipActive),
              ]}
              onPress={() => handleStatusSelect(item.value)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.chipText,
                  isActive && (statusColor
                    ? { color: statusColor.text }
                    : styles.chipTextActive),
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        }}
      />

      {/* List */}
      {isLoading && !data ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      ) : (
        <FlatList
          data={templates}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.brand}
              colors={[colors.brand]}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="repeat-outline"
              title="No recurring invoices"
              description="Set up automated invoicing using the + button"
            />
          }
          renderItem={({ item }) => {
            const statusColor = STATUS_COLORS[item.status as TemplateStatus] ?? STATUS_COLORS.expired;
            const freqLabel = FREQUENCY_LABELS[item.frequency] ?? item.frequency;
            return (
              <TouchableOpacity
                style={styles.card}
                onPress={() => router.push(`/(more)/automated-invoices/${item.id}` as never)}
                activeOpacity={0.8}
              >
                <View style={styles.cardRow}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.templateName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.partyName} numberOfLines={1}>{item.partyName ?? "Unknown party"}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: statusColor.bg }]}>
                    <Text style={[styles.statusBadgeText, { color: statusColor.text }]}>
                      {statusColor.label}
                    </Text>
                  </View>
                </View>

                <View style={styles.cardFooter}>
                  <View style={styles.footerItem}>
                    <Ionicons name="sync-outline" size={13} color={colors.textMuted} />
                    <Text style={styles.footerText}>{freqLabel}</Text>
                  </View>
                  <View style={styles.footerItem}>
                    <Ionicons name="checkmark-done-outline" size={13} color={colors.textMuted} />
                    <Text style={styles.footerText}>
                      {item.totalRuns ?? 0} runs{item.maxRuns ? ` / ${item.maxRuns}` : ""}
                    </Text>
                  </View>
                  {item.nextRunDate && item.status === "active" && (
                    <View style={styles.footerItem}>
                      <Ionicons name="calendar-outline" size={13} color={colors.textMuted} />
                      <Text style={styles.footerText}>
                        Next: {formatDateShort(item.nextRunDate)}
                      </Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
          onEndReached={() => {
            if (data && page * PAGE_SIZE < data.total) {
              setPage((p) => p + 1);
            }
          }}
          onEndReachedThreshold={0.4}
        />
      )}

      <FAB onPress={() => router.push("/(more)/automated-invoices/create" as never)} />
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

  // Summary
  summaryCard: {
    margin: 16,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  summaryRow: { flexDirection: "row", alignItems: "center" },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryValue: { fontSize: 24, fontWeight: "700", color: colors.textPrimary },
  summaryLabel: {
    fontSize: 11,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 4,
  },
  summaryDivider: { width: 1, height: 36, backgroundColor: colors.border },

  // Chips
  chipRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 12 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.brandLight, borderColor: colors.brand },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  chipTextActive: { color: colors.brand },

  // List
  listContent: { paddingHorizontal: 16, paddingBottom: 100 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
  },
  cardRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  templateName: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  partyName: { fontSize: 13, color: colors.textSecondary },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusBadgeText: { fontSize: 11, fontWeight: "600" },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 14,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  footerText: { fontSize: 12, color: colors.textMuted },
});
