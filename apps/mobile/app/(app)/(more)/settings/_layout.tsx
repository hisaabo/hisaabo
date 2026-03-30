import { Stack } from "expo-router";
import { colors } from "../../../../src/lib/theme";

const headerStyle = { backgroundColor: colors.bg };
const headerTintColor = colors.textPrimary;

export default function SettingsLayout() {
  return (
    <Stack screenOptions={{ headerStyle, headerTintColor, headerShadowVisible: false }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="business" options={{ headerShown: false }} />
      <Stack.Screen name="team" options={{ headerShown: false }} />
      <Stack.Screen name="profile" options={{ headerShown: false }} />
      <Stack.Screen name="documents" options={{ headerShown: false }} />
    </Stack>
  );
}
