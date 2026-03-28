import { Stack } from "expo-router";
import { colors } from "../../../src/lib/theme";

const headerStyle = { backgroundColor: colors.bg };
const headerTintColor = colors.textPrimary;

export default function InvoicesLayout() {
  return (
    <Stack screenOptions={{ headerStyle, headerTintColor, headerShadowVisible: false }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[id]" options={{ headerTitle: "", headerBackTitle: "Invoices" }} />
      <Stack.Screen name="create" options={{ headerTitle: "New Invoice", presentation: "modal" }} />
      <Stack.Screen name="edit" options={{ headerTitle: "Edit Invoice", presentation: "modal" }} />
    </Stack>
  );
}
