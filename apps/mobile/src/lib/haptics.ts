import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export const haptic = {
  light: () => Platform.OS !== "web" && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  medium: () => Platform.OS !== "web" && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  heavy: () => Platform.OS !== "web" && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  success: () => Platform.OS !== "web" && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  error: () => Platform.OS !== "web" && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  warning: () => Platform.OS !== "web" && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  selection: () => Platform.OS !== "web" && Haptics.selectionAsync(),
};
