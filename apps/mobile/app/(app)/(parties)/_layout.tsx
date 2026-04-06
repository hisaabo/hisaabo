import { Stack } from "expo-router";
import { colors } from "../../../src/lib/theme";

const headerStyle = { backgroundColor: colors.bg };
const headerTintColor = colors.textPrimary;

export default function PartiesLayout() {
  return (
    <Stack screenOptions={{ headerStyle, headerTintColor, headerShadowVisible: false }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[id]" options={{ headerShown: false }} />
      <Stack.Screen name="create" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="edit" options={{ headerShown: false, presentation: "modal" }} />
    </Stack>
  );
}
