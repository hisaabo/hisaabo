import { Stack } from "expo-router";
import { colors } from "../../../src/lib/theme";

const headerStyle = { backgroundColor: colors.bg };
const headerTintColor = colors.textPrimary;

export default function MoreLayout() {
  return (
    <Stack screenOptions={{ headerStyle, headerTintColor, headerShadowVisible: false }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="payments" options={{ headerShown: false }} />
      <Stack.Screen name="expenses" options={{ headerShown: false }} />
      <Stack.Screen name="bank" options={{ headerShown: false }} />
      <Stack.Screen name="settings" options={{ headerShown: false }} />
      <Stack.Screen name="gst" options={{ headerTitle: "GST Returns" }} />
      <Stack.Screen name="quotations" options={{ headerShown: false }} />
      <Stack.Screen name="credit-notes" options={{ headerShown: false }} />
      <Stack.Screen name="delivery-challans" options={{ headerShown: false }} />
      <Stack.Screen name="proforma-invoices" options={{ headerShown: false }} />
      <Stack.Screen name="sales-returns" options={{ headerShown: false }} />
      <Stack.Screen name="store-orders" options={{ headerShown: false }} />
      <Stack.Screen name="reports" options={{ headerShown: false }} />
      <Stack.Screen name="shipments" options={{ headerShown: false }} />
    </Stack>
  );
}
