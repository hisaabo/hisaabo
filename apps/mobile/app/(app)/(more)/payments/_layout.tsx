import { Stack } from "expo-router";
import { colors } from "../../../../src/lib/theme";

const headerStyle = { backgroundColor: colors.bg };
const headerTintColor = colors.textPrimary;

export default function PaymentsLayout() {
  return (
    <Stack screenOptions={{ headerStyle, headerTintColor, headerShadowVisible: false }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[id]" options={{ headerShown: false }} />
      <Stack.Screen name="create" options={{ headerTitle: "New Payment", presentation: "modal" }} />
    </Stack>
  );
}
