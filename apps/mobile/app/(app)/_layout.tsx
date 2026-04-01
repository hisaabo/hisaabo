import { useEffect, useCallback } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../src/lib/trpc";
import { useAuthStore } from "../../src/stores/auth";
import { useBusinessStore } from "../../src/stores/business";
import { colors } from "../../src/lib/theme";
import { queryClient } from "../../src/lib/query-client";
import { BusinessSwitcherProvider } from "../../src/contexts/BusinessSwitcherContext";

export default function AppLayout() {
  const token = useAuthStore((s) => s.token);
  const router = useRouter();
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

  const handleSwitchBusiness = useCallback(
    async (id: string, name: string) => {
      await setBusiness(id, name);
      utils.invalidate();
    },
    [setBusiness, utils],
  );

  const handleCreateNewBusiness = useCallback(() => {
    router.push("/(app)/create-business");
  }, [router]);

  // Low stock badge (only when business is ready)
  const { data: _lowStockCount } = trpc.item.lowStockCount.useQuery(undefined, {
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
    // If tenant is ready and businesses list loaded but empty — prompt to create one
    const bizListReady = !!session?.tenantId && businesses !== undefined;
    const noBusiness = bizListReady && businesses.length === 0;

    if (noBusiness) {
      return (
        <View style={styles.loading}>
          <View style={styles.emptyBizContainer}>
            <Ionicons name="business-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyBizTitle}>No businesses yet</Text>
            <Text style={styles.emptyBizSubtitle}>
              Create your first business to get started.
            </Text>
            <TouchableOpacity
              style={styles.createBizBtn}
              onPress={() => router.push("/(app)/create-business")}
              activeOpacity={0.8}
            >
              <Ionicons name="add" size={18} color={colors.textPrimary} />
              <Text style={styles.createBizBtnText}>Create Business</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

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
    <BusinessSwitcherProvider
      businesses={businesses ?? []}
      activeBusinessId={businessId ?? ""}
      onSwitch={handleSwitchBusiness}
      onCreateNew={handleCreateNewBusiness}
    >
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
          name="create-business"
          options={{
            href: null, // Hidden from tab bar — navigated to programmatically
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
    </BusinessSwitcherProvider>
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
  emptyBizContainer: {
    alignItems: "center",
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyBizTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
    marginTop: 8,
  },
  emptyBizSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },
  createBizBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.brand,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 8,
  },
  createBizBtnText: {
    color: colors.textPrimary,
    fontWeight: "700",
    fontSize: 15,
  },
});
