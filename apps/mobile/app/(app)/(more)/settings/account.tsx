import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState, useMemo } from "react";
import { trpc } from "../../../../src/lib/trpc";
import { useAuthStore } from "../../../../src/stores/auth";
import { useBusinessStore } from "../../../../src/stores/business";
import { makeStyles } from "../../../../src/lib/makeStyles";
import { useColors } from "../../../../src/contexts/ThemeContext";
import { QueryError, Skeleton, Card } from "../../../../src/components/ui";
import { parseUserAgent } from "../../../../src/lib/parse-user-agent";

/* ─── Constants ────────────────────────────────────────────────────────────── */

type MainTab = "sessions" | "activity";
type SessionFilter = "active" | "old";
type TimeFilter = "week" | "month" | "all";

const ACTION_LABELS: Record<string, string> = {
  "invoice.create": "Invoice created",
  "invoice.update": "Invoice updated",
  "invoice.updateStatus": "Status changed",
  "invoice.delete": "Invoice deleted",
  "payment.create": "Payment recorded",
  "payment.update": "Payment updated",
  "payment.delete": "Payment deleted",
  "party.create": "Party created",
  "party.update": "Party updated",
  "party.delete": "Party deleted",
  "party.merge": "Parties merged",
  "item.create": "Item created",
  "item.update": "Item updated",
  "item.delete": "Item deleted",
  "expense.create": "Expense recorded",
  "expense.update": "Expense updated",
  "expense.delete": "Expense deleted",
  "bankAccount.create": "Account added",
  "bankAccount.update": "Account updated",
  "bankAccount.delete": "Account deleted",
  "business.update": "Business updated",
  "document.convert": "Document converted",
  "shipment.create": "Shipment created",
  "shipment.update": "Shipment updated",
};

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

function relativeTime(date: Date | string | null): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 0) return "just now";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function getDeviceIcon(deviceType: "desktop" | "mobile" | "tablet"): string {
  switch (deviceType) {
    case "mobile":
      return "phone-portrait-outline";
    case "tablet":
      return "tablet-portrait-outline";
    default:
      return "desktop-outline";
  }
}

function getTimeRange(filter: TimeFilter): { fromDate?: string; toDate?: string } {
  if (filter === "all") return {};
  const now = new Date();
  const from = new Date(now);
  if (filter === "week") from.setDate(from.getDate() - 7);
  else if (filter === "month") from.setMonth(from.getMonth() - 1);
  return { fromDate: from.toISOString(), toDate: now.toISOString() };
}

/* ─── Pill Tab Component ───────────────────────────────────────────────────── */

function PillTabs<T extends string>({
  tabs,
  active,
  onPress,
}: {
  tabs: { key: T; label: string }[];
  active: T;
  onPress: (key: T) => void;
}) {
  const s = useS();
  return (
    <View style={s.pillRow}>
      {tabs.map((t) => (
        <TouchableOpacity
          key={t.key}
          style={[s.pill, active === t.key && s.pillActive]}
          onPress={() => onPress(t.key)}
          activeOpacity={0.7}
        >
          <Text style={[s.pillText, active === t.key && s.pillTextActive]}>
            {t.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/* ─── Sessions Tab ─────────────────────────────────────────────────────────── */

function SessionsTab() {
  const s = useS();
  const colors = useColors();
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const clearBusiness = useBusinessStore((s) => s.clearBusiness);
  const [filter, setFilter] = useState<SessionFilter>("active");
  const isOld = filter === "old";

  const { data: sessions, isLoading, isError, refetch, isRefetching } =
    trpc.auth.listSessions.useQuery({ expired: isOld });

  const utils = trpc.useUtils();

  const revokeMutation = trpc.auth.revokeSession.useMutation({
    onSuccess: () => {
      utils.auth.listSessions.invalidate();
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to revoke session.");
    },
  });

  const logoutAllMutation = trpc.auth.logoutAll.useMutation({
    onSuccess: async () => {
      await logout();
      clearBusiness();
      router.replace("/(auth)/login");
    },
    onError: async () => {
      await logout();
      clearBusiness();
      router.replace("/(auth)/login");
    },
  });

  const handleRevoke = (sessionId: string) => {
    Alert.alert("Sign Out Device", "End this session?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: () => revokeMutation.mutate({ sessionId }),
      },
    ]);
  };

  const handleLogoutAll = () => {
    Alert.alert(
      "Sign Out All Devices",
      "This will sign you out from all devices, including this one. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign Out All",
          style: "destructive",
          onPress: () => logoutAllMutation.mutate(),
        },
      ]
    );
  };

  const otherActiveSessions = useMemo(
    () => (sessions ?? []).filter((ses) => !ses.isCurrent),
    [sessions],
  );

  return (
    <View style={s.tabContent}>
      <PillTabs
        tabs={[
          { key: "active" as SessionFilter, label: "Active" },
          { key: "old" as SessionFilter, label: "Old" },
        ]}
        active={filter}
        onPress={setFilter}
      />

      <ScrollView
        style={s.innerScroll}
        contentContainerStyle={s.innerScrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => refetch()}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
      >
        {isLoading ? (
          <Card>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton
                key={i}
                width="100%"
                height={60}
                borderRadius={8}
                style={{ marginBottom: 8 }}
              />
            ))}
          </Card>
        ) : isError ? (
          <QueryError message="Failed to load sessions" onRetry={refetch} />
        ) : sessions && sessions.length > 0 ? (
          <View style={s.list}>
            {sessions.map((ses, idx) => {
              const isLast = idx === sessions.length - 1;
              const parsed = parseUserAgent(ses.userAgent);
              const icon = getDeviceIcon(parsed.deviceType);
              const timeLabel = ses.isCurrent
                ? "Active now"
                : relativeTime(ses.lastUsedAt ?? ses.createdAt);

              return (
                <View
                  key={ses.id}
                  style={[s.sessionRow, !isLast && s.sessionRowBorder]}
                >
                  <View style={s.sessionIcon}>
                    <Ionicons
                      name={icon as any}
                      size={20}
                      color={ses.isCurrent ? colors.success : colors.textMuted}
                    />
                  </View>
                  <View style={s.sessionInfo}>
                    <View style={s.sessionNameRow}>
                      <Text style={s.sessionName} numberOfLines={1}>
                        {parsed.browser} on {parsed.os}
                      </Text>
                      {ses.isCurrent && (
                        <View style={s.currentBadge}>
                          <Text style={s.currentBadgeText}>This device</Text>
                        </View>
                      )}
                    </View>
                    <Text style={s.sessionMeta}>
                      {ses.ipAddress ?? "Unknown IP"} &middot; {timeLabel}
                    </Text>
                  </View>
                  {!ses.isCurrent && !isOld && (
                    <TouchableOpacity
                      style={s.revokeBtn}
                      onPress={() => handleRevoke(ses.id)}
                      activeOpacity={0.7}
                      disabled={revokeMutation.isPending}
                    >
                      {revokeMutation.isPending ? (
                        <ActivityIndicator size="small" color={colors.danger} />
                      ) : (
                        <Text style={s.revokeBtnText}>Sign out</Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        ) : (
          <Card>
            <Text style={s.emptyText}>
              {isOld ? "No old sessions found" : "No active sessions found"}
            </Text>
          </Card>
        )}

        {/* Sign out all other devices */}
        {!isOld && otherActiveSessions.length > 0 && (
          <TouchableOpacity
            style={s.dangerButton}
            onPress={handleLogoutAll}
            activeOpacity={0.7}
            disabled={logoutAllMutation.isPending}
          >
            {logoutAllMutation.isPending ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <>
                <Ionicons name="log-out-outline" size={18} color={colors.danger} />
                <Text style={s.dangerButtonText}>
                  Sign out all other devices
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

/* ─── Activity Log Tab ─────────────────────────────────────────────────────── */

function ActivityTab() {
  const s = useS();
  const colors = useColors();
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [page, setPage] = useState(1);

  const range = useMemo(() => getTimeRange(timeFilter), [timeFilter]);

  const { data, isLoading, isError, refetch, isRefetching } =
    trpc.business.auditTrail.useQuery({
      page,
      limit: 30,
      fromDate: range.fromDate ?? null,
      toDate: range.toDate ?? null,
    });

  const entries = data?.data ?? [];
  const total = (data?.total ?? 0) as number;
  const hasMore = page * 30 < total;

  const handleTimeChange = (key: TimeFilter) => {
    setTimeFilter(key);
    setPage(1);
  };

  return (
    <View style={s.tabContent}>
      <PillTabs
        tabs={[
          { key: "week" as TimeFilter, label: "This Week" },
          { key: "month" as TimeFilter, label: "This Month" },
          { key: "all" as TimeFilter, label: "All Time" },
        ]}
        active={timeFilter}
        onPress={handleTimeChange}
      />

      <ScrollView
        style={s.innerScroll}
        contentContainerStyle={s.innerScrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => {
              setPage(1);
              refetch();
            }}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
      >
        {isLoading ? (
          <Card>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton
                key={i}
                width="100%"
                height={52}
                borderRadius={8}
                style={{ marginBottom: 8 }}
              />
            ))}
          </Card>
        ) : isError ? (
          <QueryError message="Failed to load activity log" onRetry={refetch} />
        ) : entries.length > 0 ? (
          <View style={s.list}>
            {entries.map((entry: any, idx: number) => {
              const isLast = idx === entries.length - 1;
              let meta: Record<string, unknown> = {};
              try {
                if (entry.metadata) meta = JSON.parse(entry.metadata);
              } catch {
                /* ignore */
              }

              const label = ACTION_LABELS[entry.action] ?? entry.action;
              const detail =
                (meta.invoiceNumber as string) ||
                (meta.paymentNumber as string) ||
                (meta.name as string) ||
                (meta.accountName as string) ||
                (meta.sourceName
                  ? `${meta.sourceName} \u2192 ${meta.targetName}`
                  : null) ||
                null;

              return (
                <View
                  key={entry.id}
                  style={[s.activityRow, !isLast && s.activityRowBorder]}
                >
                  <View style={s.activityContent}>
                    <Text style={s.activityLabel}>
                      {label}
                      {detail ? (
                        <Text style={s.activityDetail}> &middot; {detail}</Text>
                      ) : null}
                    </Text>
                    <Text style={s.activityMeta}>
                      by {entry.userName} &middot;{" "}
                      {relativeTime(entry.createdAt)}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <Card>
            <Text style={s.emptyText}>No activity recorded yet</Text>
          </Card>
        )}

        {/* Load more */}
        {hasMore && !isLoading && (
          <TouchableOpacity
            style={s.loadMoreBtn}
            onPress={() => setPage((p) => p + 1)}
            activeOpacity={0.7}
          >
            <Text style={s.loadMoreText}>Load more</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

/* ─── Main Account Screen ──────────────────────────────────────────────────── */

export default function AccountScreen() {
  const s = useS();
  const colors = useColors();
  const router = useRouter();
  const [mainTab, setMainTab] = useState<MainTab>("sessions");

  return (
    <SafeAreaView style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={s.title}>Account</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Main tabs */}
      <View style={s.mainTabRow}>
        <PillTabs
          tabs={[
            { key: "sessions" as MainTab, label: "Sessions" },
            { key: "activity" as MainTab, label: "Activity Log" },
          ]}
          active={mainTab}
          onPress={setMainTab}
        />
      </View>

      {/* Tab content */}
      {mainTab === "sessions" ? <SessionsTab /> : <ActivityTab />}
    </SafeAreaView>
  );
}

/* ─── Styles ───────────────────────────────────────────────────────────────── */

const useS = makeStyles((colors) => ({
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
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },

  /* Main tab row */
  mainTabRow: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },

  /* Pill tabs */
  pillRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  pillText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
  },
  pillTextActive: {
    color: colors.textPrimary,
  },

  /* Tab content */
  tabContent: {
    flex: 1,
    paddingHorizontal: 16,
  },
  innerScroll: {
    flex: 1,
  },
  innerScrollContent: {
    paddingBottom: 48,
  },

  /* Shared list card */
  list: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 16,
  },

  /* ── Sessions ── */
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  sessionRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sessionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  sessionInfo: { flex: 1 },
  sessionNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  sessionName: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
    flexShrink: 1,
  },
  currentBadge: {
    backgroundColor: colors.successBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
  },
  currentBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.success,
  },
  sessionMeta: {
    fontSize: 12,
    color: colors.textMuted,
  },
  revokeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.25)",
  },
  revokeBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.danger,
  },

  /* Danger button */
  dangerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 16,
    paddingVertical: 14,
    backgroundColor: colors.dangerBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.25)",
  },
  dangerButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.danger,
  },

  /* ── Activity Log ── */
  activityRow: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  activityRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  activityContent: {
    gap: 3,
  },
  activityLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  activityDetail: {
    fontWeight: "400",
    color: colors.textSecondary,
  },
  activityMeta: {
    fontSize: 12,
    color: colors.textMuted,
  },

  /* Load more */
  loadMoreBtn: {
    alignItems: "center",
    marginTop: 12,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  loadMoreText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.brand,
  },
}));
