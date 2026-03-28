import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { TRPCProvider } from "../src/providers/TRPCProvider";
import { useAuthStore } from "../src/stores/auth";
import { useBusinessStore } from "../src/stores/business";

// Keep the splash screen visible while we hydrate stores
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const hydrate = useAuthStore((s) => s.hydrate);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const hydrateBusinessStore = useBusinessStore((s) => s.hydrate);

  useEffect(() => {
    Promise.all([hydrate(), hydrateBusinessStore()]).then(() => {
      SplashScreen.hideAsync();
    });
  }, []);

  if (!isHydrated) return null;

  return (
    <TRPCProvider>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
      </Stack>
    </TRPCProvider>
  );
}
