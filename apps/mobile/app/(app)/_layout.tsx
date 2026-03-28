import { useEffect } from "react";
import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../src/lib/trpc";
import { useAuthStore } from "../../src/stores/auth";
import { useBusinessStore } from "../../src/stores/business";
import { colors } from "../../src/lib/theme";

export default function AppLayout() {
  const token = useAuthStore((s) => s.token);
  const { data: session } = trpc.auth.me.useQuery(undefined, { enabled: !!token });
  const { data: businesses } = trpc.business.list.useQuery(undefined, {
    enabled: !!session?.user && !!session?.tenantId,
  });
  const setBusiness = useBusinessStore((s) => s.setBusiness);
  const businessId = useBusinessStore((s) => s.businessId);

  const { data: lowStockCount } = trpc.item.lowStockCount.useQuery(undefined, {
    enabled: !!businessId,
  });

  // Auto-select first business
  useEffect(() => {
    if (businesses && businesses.length > 0 && !businessId) {
      setBusiness(businesses[0].id, businesses[0].name);
    }
  }, [businesses, businessId]);

  if (!token) return <Redirect href="/(auth)/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.surface },
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="(home)"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="(invoices)"
        options={{
          title: "Invoices",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="receipt-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="(parties)"
        options={{
          title: "Parties",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="(items)"
        options={{
          title: "Items",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cube-outline" size={size} color={color} />
          ),
          tabBarBadge: lowStockCount && lowStockCount > 0 ? lowStockCount : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.danger, fontSize: 10 },
        }}
      />
      <Tabs.Screen
        name="(more)"
        options={{
          title: "More",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="menu-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
