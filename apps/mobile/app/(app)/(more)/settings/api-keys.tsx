import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  Modal,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import * as Clipboard from "expo-clipboard";
import { trpc } from "../../../../src/lib/trpc";
import { makeStyles } from "../../../../src/lib/makeStyles";
import { useColors } from "../../../../src/contexts/ThemeContext";
import { fonts } from "../../../../src/lib/theme";
import { Card, Skeleton, QueryError } from "../../../../src/components/ui";
import { formatDateTime } from "../../../../src/lib/utils";

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(date: Date | string | null): string {
  if (!date) return "Never used";
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDateTime(date);
}

function formatExpiry(expiresAt: Date | string | null): string {
  if (!expiresAt) return "Never expires";
  const d = new Date(expiresAt);
  const now = new Date();
  if (d < now) return "Expired";
  return `Expires ${formatDateTime(expiresAt)}`;
}

// ── Expiry picker options ────────────────────────────────────────────────────

const EXPIRY_OPTIONS: Array<{ label: string; days: number | null }> = [
  { label: "No expiry", days: null },
  { label: "30 days", days: 30 },
  { label: "60 days", days: 60 },
  { label: "90 days", days: 90 },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function ApiKeysScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const utils = trpc.useUtils();

  // State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [selectedExpiryDays, setSelectedExpiryDays] = useState<number | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Queries
  const { data: session } = trpc.auth.me.useQuery(undefined);
  const { data: tenantList } = trpc.tenant.list.useQuery(undefined);
  const {
    data: keys,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = trpc.apiKey.list.useQuery(undefined);

  // Plan check
  const currentTenant = tenantList?.find((t) => t.tenantId === session?.tenantId);
  const isFree = currentTenant?.tenantPlan === "free";

  // Mutations
  const createMutation = trpc.apiKey.create.useMutation({
    onSuccess: (data) => {
      setCreatedKey(data.key);
      utils.apiKey.list.invalidate();
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to create API key.");
    },
  });

  const revokeMutation = trpc.apiKey.revoke.useMutation({
    onSuccess: () => {
      utils.apiKey.list.invalidate();
      Alert.alert("Revoked", "API key has been revoked.");
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to revoke API key.");
    },
  });

  // Handlers
  const handleCreate = () => {
    if (!newKeyName.trim()) {
      Alert.alert("Validation", "Key name is required.");
      return;
    }
    const expiresAt = selectedExpiryDays
      ? new Date(Date.now() + selectedExpiryDays * 86400000).toISOString()
      : undefined;
    createMutation.mutate({
      name: newKeyName.trim(),
      expiresAt,
    });
  };

  const handleCloseCreateModal = () => {
    setShowCreateModal(false);
    setNewKeyName("");
    setSelectedExpiryDays(null);
    setCreatedKey(null);
    setCopied(false);
    createMutation.reset();
  };

  const handleCopy = async () => {
    if (createdKey) {
      await Clipboard.setStringAsync(createdKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRevoke = (id: string, name: string) => {
    Alert.alert(
      "Revoke API Key",
      `Revoke "${name}"? This action cannot be undone. Any integrations using this key will stop working.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: () => revokeMutation.mutate({ id }),
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>API Keys</Text>
        {!isFree ? (
          <TouchableOpacity
            style={styles.createBtn}
            onPress={() => setShowCreateModal(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="add" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {/* Content */}
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
      >
        {isFree ? (
          /* Free plan paywall */
          <Card>
            <View style={styles.paywallCard}>
              <View style={styles.paywallIconWrapper}>
                <Ionicons name="lock-closed-outline" size={28} color={colors.amber} />
              </View>
              <Text style={styles.paywallTitle}>Paid Feature</Text>
              <Text style={styles.paywallDescription}>
                API keys are available on paid plans. Upgrade to create programmatic access tokens
                for the CLI and MCP server.
              </Text>
            </View>
          </Card>
        ) : isLoading ? (
          <Card>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton
                key={i}
                width="100%"
                height={72}
                borderRadius={8}
                style={{ marginBottom: 8 }}
              />
            ))}
          </Card>
        ) : isError ? (
          <QueryError message="Failed to load API keys" onRetry={refetch} />
        ) : keys && keys.length > 0 ? (
          <View style={styles.keysList}>
            {keys.map((k, idx) => {
              const isLast = idx === keys.length - 1;
              const isExpired = k.expiresAt ? new Date(k.expiresAt) < new Date() : false;
              return (
                <View
                  key={k.id}
                  style={[styles.keyRow, !isLast && styles.keyRowBorder]}
                >
                  <View style={[styles.keyIcon, isExpired && styles.keyIconExpired]}>
                    <Ionicons
                      name="key-outline"
                      size={18}
                      color={isExpired ? colors.danger : colors.brand}
                    />
                  </View>
                  <View style={styles.keyInfo}>
                    <View style={styles.keyNameRow}>
                      <Text style={styles.keyName} numberOfLines={1}>
                        {k.name}
                      </Text>
                      <Text style={styles.keyPrefix} numberOfLines={1}>
                        {k.keyPrefix}...
                      </Text>
                    </View>
                    <View style={styles.keyMetaRow}>
                      <Text style={styles.keyMeta}>
                        {k.lastUsedAt
                          ? `Used ${timeAgo(k.lastUsedAt)}`
                          : "Never used"}
                      </Text>
                      <Text style={styles.keyMetaDot}>&middot;</Text>
                      <Text
                        style={[
                          styles.keyMeta,
                          isExpired && styles.keyMetaExpired,
                        ]}
                      >
                        {formatExpiry(k.expiresAt)}
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.revokeBtn}
                    onPress={() => handleRevoke(k.id, k.name)}
                    activeOpacity={0.7}
                    disabled={revokeMutation.isPending}
                  >
                    {revokeMutation.isPending ? (
                      <ActivityIndicator size="small" color={colors.danger} />
                    ) : (
                      <Ionicons name="trash-outline" size={16} color={colors.danger} />
                    )}
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        ) : (
          <Card>
            <View style={styles.emptyContainer}>
              <Ionicons name="key-outline" size={36} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>No API keys</Text>
              <Text style={styles.emptyDescription}>
                Create an API key to access Hisaabo programmatically via the CLI or MCP server.
              </Text>
            </View>
          </Card>
        )}

        {/* Create key large button at bottom (non-free) */}
        {!isFree && !isLoading && !isError && (
          <TouchableOpacity
            style={styles.createLargeBtn}
            onPress={() => setShowCreateModal(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="add-circle-outline" size={20} color={colors.brand} />
            <Text style={styles.createLargeBtnText}>Create API Key</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Create API Key Modal */}
      <Modal
        visible={showCreateModal}
        transparent
        animationType="slide"
        onRequestClose={handleCloseCreateModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {createdKey ? "API Key Created" : "Create API Key"}
              </Text>
              <TouchableOpacity
                onPress={handleCloseCreateModal}
                style={styles.modalClose}
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {createdKey ? (
              /* Key created — show the raw key */
              <View>
                <View style={styles.warningBanner}>
                  <Ionicons name="warning-outline" size={18} color={colors.amber} />
                  <Text style={styles.warningText}>
                    Copy this key now. It won't be shown again.
                  </Text>
                </View>

                <View style={styles.keyDisplay}>
                  <Text style={styles.keyDisplayText} selectable>
                    {createdKey}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.copyBtn, copied && styles.copyBtnCopied]}
                  onPress={handleCopy}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={copied ? "checkmark-circle" : "copy-outline"}
                    size={18}
                    color={copied ? colors.success : colors.textPrimary}
                  />
                  <Text
                    style={[
                      styles.copyBtnText,
                      copied && styles.copyBtnTextCopied,
                    ]}
                  >
                    {copied ? "Copied!" : "Copy to Clipboard"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.doneBtn}
                  onPress={handleCloseCreateModal}
                  activeOpacity={0.8}
                >
                  <Text style={styles.doneBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            ) : (
              /* Create form */
              <View>
                <Text style={styles.fieldLabel}>Key Name *</Text>
                <TextInput
                  style={styles.input}
                  value={newKeyName}
                  onChangeText={setNewKeyName}
                  placeholder="e.g. CLI Access Key"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <Text style={styles.fieldLabel}>Expiry (optional)</Text>
                <View style={styles.expiryGrid}>
                  {EXPIRY_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.label}
                      style={[
                        styles.expiryPill,
                        selectedExpiryDays === opt.days && styles.expiryPillActive,
                      ]}
                      onPress={() => setSelectedExpiryDays(opt.days)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.expiryPillText,
                          selectedExpiryDays === opt.days &&
                            styles.expiryPillTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity
                  style={[
                    styles.submitBtn,
                    createMutation.isPending && { opacity: 0.6 },
                  ]}
                  onPress={handleCreate}
                  disabled={createMutation.isPending}
                  activeOpacity={0.8}
                >
                  {createMutation.isPending ? (
                    <ActivityIndicator color={colors.textPrimary} size="small" />
                  ) : (
                    <Text style={styles.submitBtnText}>Create</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

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
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
  createBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { padding: 16, paddingBottom: 48 },

  // Key list
  keysList: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  keyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  keyRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  keyIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  keyIconExpired: {
    backgroundColor: colors.dangerBg,
  },
  keyInfo: { flex: 1 },
  keyNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  keyName: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.textPrimary,
    flexShrink: 1,
  },
  keyPrefix: {
    fontSize: 11,
    color: colors.textMuted,
    fontFamily: fonts.mono,
  },
  keyMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  keyMeta: {
    fontSize: 11,
    color: colors.textMuted,
  },
  keyMetaDot: {
    fontSize: 11,
    color: colors.textMuted,
  },
  keyMetaExpired: {
    color: colors.danger,
    fontWeight: "600",
  },
  revokeBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.dangerBg,
    alignItems: "center",
    justifyContent: "center",
  },

  // Empty state
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 24,
    paddingHorizontal: 16,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
    marginTop: 4,
  },
  emptyDescription: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 18,
  },

  // Paywall
  paywallCard: {
    alignItems: "center",
    paddingVertical: 28,
    paddingHorizontal: 20,
    gap: 10,
  },
  paywallIconWrapper: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.amberBg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  paywallTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  paywallDescription: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 19,
  },

  // Create large button
  createLargeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 16,
    paddingVertical: 14,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.brand + "60",
    borderStyle: "dashed",
  },
  createLargeBtnText: {
    color: colors.brand,
    fontSize: 15,
    fontWeight: "600",
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
    marginBottom: 20,
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

  // Form
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 14,
    marginBottom: 16,
  },
  expiryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 20,
  },
  expiryPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  expiryPillActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  expiryPillText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
  },
  expiryPillTextActive: {
    color: colors.textPrimary,
  },
  submitBtn: {
    backgroundColor: colors.brand,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  submitBtnText: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },

  // Created key display
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.amberBg,
    borderWidth: 1,
    borderColor: colors.amber + "40",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: colors.amber,
    lineHeight: 18,
  },
  keyDisplay: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  keyDisplayText: {
    fontSize: 12,
    fontFamily: fonts.mono,
    color: colors.textPrimary,
    lineHeight: 18,
  },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.brand,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  copyBtnCopied: {
    backgroundColor: colors.successBg,
    borderWidth: 1,
    borderColor: colors.success + "40",
  },
  copyBtnText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
  copyBtnTextCopied: {
    color: colors.success,
  },
  doneBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  doneBtnText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: "600",
  },
}));
