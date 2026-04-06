import { Stack } from "expo-router";

export default function InvoicesLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="create" options={{ presentation: "modal" }} />
      <Stack.Screen name="edit" options={{ presentation: "modal" }} />
    </Stack>
  );
}
