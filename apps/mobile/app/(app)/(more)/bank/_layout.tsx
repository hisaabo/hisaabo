import { Stack } from "expo-router";
import { colors } from "../../../../src/lib/theme";

const headerStyle = { backgroundColor: colors.bg };
const headerTintColor = colors.textPrimary;

export default function BankLayout() {
  return (
    <Stack screenOptions={{ headerStyle, headerTintColor, headerShadowVisible: false }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[id]" options={{ headerShown: false }} />
      <Stack.Screen name="create" options={{ headerShown: false }} />
      <Stack.Screen name="transfer" options={{ headerShown: false }} />
      <Stack.Screen name="edit" options={{ headerShown: false }} />
    </Stack>
  );
}
