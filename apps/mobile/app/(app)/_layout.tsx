import { useEffect } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../src/lib/trpc";
import { useAuthStore } from "../../src/stores/auth";
import { useBusinessStore } from "../../src/stores/business";
import { colors } from "../../src/lib/theme";
import { queryClient } from "../../src/lib/query-client";

export default function AppLayout() {
  const token = useAuthStore((s) => s.token);
  const utils = trpc.useUtils();
  const { data: session, isLoading: sessionLoading } = trpc.auth.me.useQuery(undefined, { enabled: !!token });

  // Auto-select tenant if only one (same pattern as web root layout)
  const { data: tenantList } = trpc.tenant.list.useQuery(undefined, {
    enabled: !!session?.user && !session?.tenantId,
  });

  const selectTenantMutation = trpc.tenant.select.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      queryClient.invalidateQueries();
    },
  });

  useEffect(() => {
    if (session?.user && !session?.tenantId && tenantList?.length === 1 && !selectTenantMutation.isPending) {
      selectTenantMutation.mutate({ tenantId: tenantList[0].tenantId });
    }
  }, [session?.user, session?.tenantId, tenantList]);

  // Fetch businesses once tenant is selected
  const { data: businesses } = trpc.business.list.useQuery(undefined, {
    enabled: !!session?.user && !!session?.tenantId,
  });

  const setBusiness = useBusinessStore((s) => s.setBusiness);
  const businessId = useBusinessStore((s) => s.businessId);

  // Auto-select first business
  useEffect(() => {
    if (businesses && businesses.length > 0 && !businessId) {
      setBusiness(businesses[0].id, businesses[0].name);
    }
  }, [businesses, businessId]);

  // Low stock badge (only when business is ready)
  const { data: lowStockCount } = trpc.item.lowStockCount.useQuery(undefined, {
    enabled: !!businessId,
  });

  // Not logged in — the root layout's auth gate handles the login redirect.
  // We show a loading state here rather than redirecting, which prevents a
  // flash of the login screen when re-mounting after lock screen unlock.
  if (!token) {
    if (__DEV__) console.log("[AppLayout] No token — showing loading spinner (NOT redirecting to login)");
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={colors.brand} />
      </View>
    );
  }

  // Wait until business is ready before rendering any screens
  // This prevents child screens from firing queries without x-business-id
  if (!businessId) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={colors.brand} />
        {sessionLoading ? null : (
          <Text style={styles.loadingText}>
            {!session?.tenantId ? "Selecting organization..." : "Loading business..."}
          </Text>
        )}
      </View>
    );
  }

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
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="(invoices)"
        options={{
          title: "Invoices",
          tabBarIcon: ({ color, size }) => <Ionicons name="receipt-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="(parties)"
        options={{
          title: "Parties",
          tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="(payments)"
        options={{
          title: "Payments",
          tabBarIcon: ({ color, size }) => <Ionicons name="card-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="(items)"
        options={{
          href: null, // Hidden from tab bar — accessible via More
        }}
      />
      <Tabs.Screen
        name="(more)"
        options={{
          title: "More",
          tabBarIcon: ({ color, size }) => <Ionicons name="menu-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 13,
  },
});
