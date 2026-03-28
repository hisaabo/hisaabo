import { Stack } from "expo-router";
import { colors } from "../../../src/lib/theme";

const headerStyle = { backgroundColor: colors.bg };
const headerTintColor = colors.textPrimary;

export default function PartiesLayout() {
  return (
    <Stack screenOptions={{ headerStyle, headerTintColor, headerShadowVisible: false }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[id]" options={{ headerTitle: "", headerBackTitle: "Parties" }} />
      <Stack.Screen name="create" options={{ headerTitle: "New Party", presentation: "modal" }} />
      <Stack.Screen name="edit" options={{ headerTitle: "Edit Party", presentation: "modal" }} />
    </Stack>
  );
}
