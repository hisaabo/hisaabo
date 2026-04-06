import { Stack } from "expo-router";

export default function ExpensesLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="create" options={{ presentation: "modal" }} />
    </Stack>
  );
}
