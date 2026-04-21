import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Easing,
  ScrollView,
  Dimensions,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles } from "../lib/makeStyles";
import { useColors } from "../contexts/ThemeContext";
import { haptic } from "../lib/haptics";

interface OrgItem {
  tenantId: string;
  tenantName: string;
  role: string;
}

interface OrgSwitcherSheetProps {
  visible: boolean;
  onClose: () => void;
  orgs: OrgItem[];
  activeTenantId: string | null;
  onSwitch: (tenantId: string) => void;
  canCreateOrg?: boolean;
  onCreateNew?: () => void;
  isCreating?: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  superadmin: "Super Admin",
  admin: "Admin",
  seller_manager: "Sales Manager",
  seller: "Seller",
  accountant: "Accountant",
  member: "Member",
};

function formatRole(role: string): string {
  return ROLE_LABELS[role] ?? role.charAt(0).toUpperCase() + role.slice(1).replace(/_/g, " ");
}

export function OrgSwitcherSheet({
  visible,
  onClose,
  orgs,
  activeTenantId,
  onSwitch,
  canCreateOrg,
  onCreateNew,
  isCreating,
}: OrgSwitcherSheetProps) {
  const [slideAnim] = useState(() => new Animated.Value(0));
  const styles = useStyles();
  const colors = useColors();

  useEffect(() => {
    if (visible) {
      haptic.light();
      Animated.spring(slideAnim, {
        toValue: 1,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim]);

  const handleClose = () => {
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  };

  const handleSwitch = (tenantId: string) => {
    if (tenantId === activeTenantId) {
      handleClose();
      return;
    }
    haptic.medium();
    onSwitch(tenantId);
  };

  const handleCreateNew = () => {
    haptic.light();
    onCreateNew?.();
  };

  const screenHeight = Dimensions.get("window").height;

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [screenHeight, 0],
  });

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="none" statusBarTranslucent>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          {/* Handle bar */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Switch Organization</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={handleClose} activeOpacity={0.7}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Org list */}
          <ScrollView
            style={{ maxHeight: screenHeight * 0.5 }}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {orgs.map((org) => {
              const isActive = org.tenantId === activeTenantId;
              return (
                <TouchableOpacity
                  key={org.tenantId}
                  style={styles.orgRow}
                  onPress={() => handleSwitch(org.tenantId)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.avatar, isActive && styles.avatarActive]}>
                    <Text style={[styles.avatarText, isActive && styles.avatarTextActive]}>
                      {org.tenantName.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.orgInfo}>
                    <Text
                      style={[styles.orgName, isActive && styles.orgNameActive]}
                      numberOfLines={1}
                    >
                      {org.tenantName}
                    </Text>
                    <Text style={styles.orgRole}>{formatRole(org.role)}</Text>
                  </View>
                  {isActive && (
                    <Ionicons name="checkmark" size={20} color={colors.brand} />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Create new org */}
          {canCreateOrg && onCreateNew && (
            <>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.orgRow}
                onPress={handleCreateNew}
                activeOpacity={0.7}
                disabled={isCreating}
              >
                <View style={styles.createAvatar}>
                  {isCreating ? (
                    <ActivityIndicator size="small" color={colors.textSecondary} />
                  ) : (
                    <Ionicons name="add" size={20} color={colors.textSecondary} />
                  )}
                </View>
                <Text style={styles.createText}>
                  {isCreating ? "Creating..." : "Create New Organization"}
                </Text>
              </TouchableOpacity>
            </>
          )}

          <SafeAreaView edges={["bottom"]} />
        </Animated.View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 8 : 16,
  },
  handle: {
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginBottom: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  orgRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 56,
    gap: 12,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarActive: {
    backgroundColor: colors.brand,
  },
  avatarText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textSecondary,
  },
  avatarTextActive: {
    color: colors.textPrimary,
  },
  orgInfo: {
    flex: 1,
    minWidth: 0,
  },
  orgName: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.textSecondary,
  },
  orgNameActive: {
    fontWeight: "700",
    color: colors.textPrimary,
  },
  orgRole: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  createAvatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  createText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    color: colors.textSecondary,
  },
}));
