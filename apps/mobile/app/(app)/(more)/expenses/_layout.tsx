import { Stack } from "expo-router";
import { colors } from "../../../../src/lib/theme";

const headerStyle = { backgroundColor: colors.bg };
const headerTintColor = colors.textPrimary;

export default function ExpensesLayout() {
  return (
    <Stack screenOptions={{ headerStyle, headerTintColor, headerShadowVisible: false }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[id]" options={{ headerShown: false }} />
      <Stack.Screen name="create" options={{ headerTitle: "New Expense", presentation: "modal" }} />
    </Stack>
  );
}
