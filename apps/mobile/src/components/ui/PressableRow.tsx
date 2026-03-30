import { Pressable, Platform, ViewStyle, StyleProp } from "react-native";
import { haptic } from "../../lib/haptics";

interface Props {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  hapticOnPress?: boolean;
}

export function PressableRow({ children, onPress, onLongPress, style, disabled, hapticOnPress = true }: Props) {
  return (
    <Pressable
      onPress={() => {
        if (hapticOnPress) haptic.light();
        onPress?.();
      }}
      onLongPress={onLongPress}
      disabled={disabled}
      style={({ pressed }) => [
        style,
        Platform.OS === "ios" && pressed && { opacity: 0.7 },
        disabled && { opacity: 0.5 },
      ]}
      android_ripple={{ color: "rgba(99, 102, 241, 0.15)", borderless: false }}
    >
      {children}
    </Pressable>
  );
}
