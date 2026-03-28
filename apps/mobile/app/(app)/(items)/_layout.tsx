import { Stack } from "expo-router";
import { colors } from "../../../src/lib/theme";

const headerStyle = { backgroundColor: colors.bg };
const headerTintColor = colors.textPrimary;

export default function ItemsLayout() {
  return (
    <Stack screenOptions={{ headerStyle, headerTintColor, headerShadowVisible: false }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[id]" options={{ headerTitle: "", headerBackTitle: "Items" }} />
      <Stack.Screen name="create" options={{ headerTitle: "New Item", presentation: "modal" }} />
      <Stack.Screen name="edit" options={{ headerTitle: "Edit Item", presentation: "modal" }} />
    </Stack>
  );
}
