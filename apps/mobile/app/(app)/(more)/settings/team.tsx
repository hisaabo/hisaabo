import {
  View,
  Text,
  StyleSheet,
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
import { trpc } from "../../../../src/lib/trpc";
import { colors } from "../../../../src/lib/theme";
import { QueryError, Skeleton, Card } from "../../../../src/components/ui";

const ROLE_COLORS: Record<string, string> = {
  owner: colors.brand,
  superadmin: colors.brand,
  admin: colors.info,
  seller_manager: colors.warning,
  seller: colors.success,
  accountant: colors.amber,
  member: colors.textMuted,
  viewer: colors.textMuted,
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  superadmin: "Super Admin",
  admin: "Admin",
  seller_manager: "Seller Manager",
  seller: "Seller",
  accountant: "Accountant",
  member: "Member",
  viewer: "Viewer",
};

const INVITE_ROLES: Array<{ key: string; label: string }> = [
  { key: "admin", label: "Admin" },
  { key: "seller_manager", label: "Seller Manager" },
  { key: "seller", label: "Seller" },
  { key: "accountant", label: "Accountant" },
];

function RoleBadge({ role }: { role: string }) {
  const color = ROLE_COLORS[role] ?? colors.textMuted;
  const label = ROLE_LABELS[role] ?? role;
  return (
    <View style={[badgeStyles.badge, { backgroundColor: color + "20", borderColor: color + "40" }]}>
      <Text style={[badgeStyles.text, { color }]}>{label}</Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  text: {
    fontSize: 11,
    fontWeight: "700",
  },
});

export default function TeamScreen() {
  const router = useRouter();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("seller");

  const utils = trpc.useUtils();

  const { data: members, isLoading, isError, refetch, isRefetching } =
    trpc.tenant.members.useQuery(undefined);

  const { data: me } = trpc.auth.me.useQuery(undefined);
  const myRole = me?.role ?? "";
  const canManage = ["owner", "superadmin", "admin"].includes(myRole);

  const inviteMutation = trpc.tenant.inviteMember.useMutation({
    onSuccess: () => {
      utils.tenant.members.invalidate();
      setShowInviteModal(false);
      setInviteEmail("");
      setInviteRole("seller");
      Alert.alert(
        "Invitation sent",
        "An invitation link has been sent. Share it with the team member."
      );
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to send invitation.");
    },
  });

  const removeMutation = trpc.tenant.removeMember.useMutation({
    onSuccess: () => {
      utils.tenant.members.invalidate();
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to remove member.");
    },
  });

  const handleRemove = (userId: string, name: string) => {
    Alert.alert(
      "Remove Member",
      `Remove ${name} from your organization?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => removeMutation.mutate({ userId }),
        },
      ]
    );
  };

  const handleInvite = () => {
    if (!inviteEmail.trim()) {
      Alert.alert("Validation", "Email is required.");
      return;
    }
    inviteMutation.mutate({
      email: inviteEmail.trim().toLowerCase(),
      role: inviteRole as any,
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Team</Text>
        {canManage ? (
          <TouchableOpacity
            style={styles.inviteBtn}
            onPress={() => setShowInviteModal(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="person-add-outline" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

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
        {isLoading ? (
          <Card>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} width="100%" height={60} borderRadius={8} style={{ marginBottom: 8 }} />
            ))}
          </Card>
        ) : isError ? (
          <QueryError message="Failed to load team members" onRetry={refetch} />
        ) : members && members.length > 0 ? (
          <View style={styles.membersList}>
            {members.map((m, idx) => {
              const isLast = idx === members.length - 1;
              const isMe = m.userId === me?.user?.id;
              const isOwner = m.role === "owner" || m.role === "superadmin";
              const displayName = m.userName || m.userEmail || "Unknown";
              return (
                <View
                  key={m.id}
                  style={[styles.memberRow, !isLast && styles.memberRowBorder]}
                >
                  <View style={styles.memberAvatar}>
                    <Text style={styles.memberAvatarText}>
                      {displayName.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.memberInfo}>
                    <View style={styles.memberNameRow}>
                      <Text style={styles.memberName} numberOfLines={1}>
                        {displayName}
                      </Text>
                      {isMe && <Text style={styles.meLabel}>You</Text>}
                    </View>
                    <Text style={styles.memberEmail} numberOfLines={1}>
                      {m.userEmail}
                    </Text>
                    <View style={styles.memberRoleRow}>
                      <RoleBadge role={m.role} />
                    </View>
                  </View>
                  {canManage && !isOwner && !isMe && (
                    <TouchableOpacity
                      style={styles.removeBtn}
                      onPress={() => handleRemove(m.userId, displayName)}
                      activeOpacity={0.7}
                      disabled={removeMutation.isPending}
                    >
                      {removeMutation.isPending ? (
                        <ActivityIndicator size="small" color={colors.danger} />
                      ) : (
                        <Ionicons name="person-remove-outline" size={18} color={colors.danger} />
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        ) : (
          <Card>
            <Text style={styles.emptyText}>No team members found</Text>
          </Card>
        )}

        {canManage && (
          <TouchableOpacity
            style={styles.inviteLargeBtn}
            onPress={() => setShowInviteModal(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="person-add-outline" size={20} color={colors.brand} />
            <Text style={styles.inviteLargeBtnText}>Invite Team Member</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Invite Modal */}
      <Modal
        visible={showInviteModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowInviteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Invite Member</Text>
              <TouchableOpacity
                onPress={() => setShowInviteModal(false)}
                style={styles.modalClose}
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>Email Address</Text>
            <TextInput
              style={styles.input}
              value={inviteEmail}
              onChangeText={setInviteEmail}
              placeholder="member@example.com"
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.fieldLabel}>Role</Text>
            <View style={styles.roleGrid}>
              {INVITE_ROLES.map((r) => (
                <TouchableOpacity
                  key={r.key}
                  style={[styles.rolePill, inviteRole === r.key && styles.rolePillActive]}
                  onPress={() => setInviteRole(r.key)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.rolePillText, inviteRole === r.key && styles.rolePillTextActive]}>
                    {r.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.inviteSubmitBtn, inviteMutation.isPending && { opacity: 0.6 }]}
              onPress={handleInvite}
              disabled={inviteMutation.isPending}
              activeOpacity={0.8}
            >
              {inviteMutation.isPending ? (
                <ActivityIndicator color={colors.textPrimary} size="small" />
              ) : (
                <Text style={styles.inviteSubmitBtnText}>Send Invitation</Text>
              )}
            </TouchableOpacity>
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
  inviteBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { padding: 16, paddingBottom: 48 },
  membersList: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  memberRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(99,102,241,0.3)",
  },
  memberAvatarText: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.brand,
  },
  memberInfo: { flex: 1 },
  memberNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  memberName: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.textPrimary,
    flex: 1,
  },
  meLabel: {
    fontSize: 11,
    color: colors.brand,
    fontWeight: "600",
    backgroundColor: colors.brandLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  memberEmail: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 6,
  },
  memberRoleRow: {
    flexDirection: "row",
  },
  removeBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.dangerBg,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 16,
  },
  inviteLargeBtn: {
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
  inviteLargeBtnText: {
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
  roleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 20,
  },
  rolePill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rolePillActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  rolePillText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
  },
  rolePillTextActive: {
    color: colors.textPrimary,
  },
  inviteSubmitBtn: {
    backgroundColor: colors.brand,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  inviteSubmitBtnText: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
});
