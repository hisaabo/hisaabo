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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../lib/theme";
import { haptic } from "../lib/haptics";

interface BusinessSwitcherSheetProps {
  visible: boolean;
  onClose: () => void;
  businesses: Array<{ id: string; name: string }>;
  activeBusinessId: string;
  onSwitch: (id: string, name: string) => void;
  onCreateNew?: () => void;
}

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function BusinessSwitcherSheet({
  visible,
  onClose,
  businesses,
  activeBusinessId,
  onSwitch,
  onCreateNew,
}: BusinessSwitcherSheetProps) {
  const [slideAnim] = useState(() => new Animated.Value(0));

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

  const handleSwitch = (id: string, name: string) => {
    if (id === activeBusinessId) {
      handleClose();
      return;
    }
    haptic.medium();
    onSwitch(id, name);
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
            <Text style={styles.headerTitle}>Switch Business</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={handleClose} activeOpacity={0.7}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Business list */}
          <ScrollView
            style={{ maxHeight: screenHeight * 0.5 }}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {businesses.map((biz) => {
              const isActive = biz.id === activeBusinessId;
              return (
                <TouchableOpacity
                  key={biz.id}
                  style={styles.bizRow}
                  onPress={() => handleSwitch(biz.id, biz.name)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.avatar, isActive && styles.avatarActive]}>
                    <Text style={[styles.avatarText, isActive && styles.avatarTextActive]}>
                      {getInitials(biz.name)}
                    </Text>
                  </View>
                  <Text
                    style={[styles.bizName, isActive && styles.bizNameActive]}
                    numberOfLines={1}
                  >
                    {biz.name}
                  </Text>
                  {isActive && (
                    <Ionicons name="checkmark" size={20} color={colors.brand} />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {onCreateNew && (
            <>
              {/* Divider */}
              <View style={styles.divider} />

              {/* Create new business row */}
              <TouchableOpacity style={styles.bizRow} onPress={handleCreateNew} activeOpacity={0.7}>
                <View style={styles.createAvatar}>
                  <Ionicons name="add" size={20} color={colors.textSecondary} />
                </View>
                <Text style={styles.createText}>Create New Business</Text>
              </TouchableOpacity>
            </>
          )}

          {/* Safe area bottom padding */}
          <SafeAreaView edges={["bottom"]} />
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  bizRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 56,
    gap: 12,
    paddingHorizontal: 4,
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
  bizName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    color: colors.textSecondary,
  },
  bizNameActive: {
    fontWeight: "700",
    color: colors.textPrimary,
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
});
