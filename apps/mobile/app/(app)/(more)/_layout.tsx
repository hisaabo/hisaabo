import { Stack } from "expo-router";

export default function MoreLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="payments" />
      <Stack.Screen name="expenses" />
      <Stack.Screen name="bank" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="gst" />
      <Stack.Screen name="quotations" />
      <Stack.Screen name="credit-notes" />
      <Stack.Screen name="delivery-challans" />
      <Stack.Screen name="proforma-invoices" />
      <Stack.Screen name="sales-returns" />
      <Stack.Screen name="store-orders" />
      <Stack.Screen name="reports" />
      <Stack.Screen name="shipments" />
      <Stack.Screen name="automated-invoices" />
    </Stack>
  );
}
