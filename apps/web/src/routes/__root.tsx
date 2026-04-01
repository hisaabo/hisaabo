import { createRootRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import React, { useState, useEffect } from "react";
import { trpc, setBusinessId, queryClient } from "@/lib/trpc";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useTheme } from "@/hooks/useTheme";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { KbdShortcut } from "@/components/ui/KbdShortcut";
import { ShortcutIndicator } from "@/components/ui/ShortcutIndicator";
import { Modal } from "@/components/ui/Modal";
import { Listbox } from "@/components/ui/Listbox";
import { getRegisteredHotkeys } from "@/hooks/useHotkeys";
import { cn } from "@/lib/utils";

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: RootError,
});

function RootError({ error }: { error: Error }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-1 p-8">
      <div className="max-w-md text-center">
        <div className="w-12 h-12 rounded-xl bg-red-100 dark:bg-red-950 flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-text-primary mb-2">Something went wrong</h1>
        <p className="text-sm text-text-tertiary mb-6">
          {error?.message || "An unexpected error occurred. Please try again."}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="btn-primary"
        >
          Reload Page
        </button>
      </div>
    </div>
  );
}

// ── Sidebar nav structure ──────────────────────────────────────

const navSections = [
  {
    label: "OVERVIEW",
    items: [
      { to: "/", label: "Dashboard", icon: DashboardIcon, exact: true },
    ],
  },
  {
    label: "SALES",
    items: [
      { to: "/invoices", label: "Invoices", icon: InvoiceIcon },
      { to: "/quotations", label: "Quotations", icon: QuotationIcon },
      { to: "/sales-returns", label: "Sales Returns", icon: SalesReturnIcon },
      { to: "/credit-notes", label: "Credit Notes", icon: CreditNoteIcon },
      { to: "/delivery-challans", label: "Delivery Challans", icon: DeliveryIcon },
      { to: "/proforma-invoices", label: "Proforma Invoices", icon: ProformaIcon },
      { to: "/store-orders", label: "Store Orders", icon: StoreOrdersIcon },
    ],
  },
  {
    label: "CONTACTS",
    items: [
      { to: "/parties", label: "Parties", icon: PartyIcon },
    ],
  },
  {
    label: "INVENTORY",
    items: [
      { to: "/items", label: "Items", icon: ItemIcon },
    ],
  },
  {
    label: "MONEY",
    items: [
      { to: "/payments", label: "Payments", icon: PaymentIcon },
      { to: "/cash-and-bank", label: "Cash & Bank", icon: BankIcon },
      { to: "/expenses", label: "Expenses", icon: ExpenseIcon },
      { to: "/shipments", label: "Shipments", icon: ShipmentsIcon },
    ],
  },
  {
    label: "COMPLIANCE",
    items: [
      { to: "/gst", label: "__REPORTS__", icon: GSTIcon }, // label set dynamically based on GST status
      { to: "/reports", label: "Reports", icon: ReportsIcon },
    ],
  },
  {
    label: "ACCOUNT",
    items: [
      { to: "/settings", label: "Settings", icon: SettingsIcon },
    ],
  },
] as const;

// ── TenantPicker ───────────────────────────────────────────────

type TenantMembership = {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: string;
};

function TenantPicker({
  tenants,
  onSelect,
}: {
  tenants: TenantMembership[];
  onSelect: (tenantId: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="w-full max-w-sm rounded-xl bg-surface-0 border border-border-light shadow-modal p-6 animate-scale-in">
        <h2 className="text-base font-semibold text-text-primary mb-1">
          Select Organization
        </h2>
        <p className="text-xs text-text-tertiary mb-5">
          Choose which organization to work in
        </p>
        <div className="space-y-2">
          {tenants.map((t) => (
            <button
              key={t.tenantId}
              onClick={() => onSelect(t.tenantId)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-border-light hover:border-brand-400 hover:bg-brand-600/5 transition-colors text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 text-sm font-semibold shrink-0">
                  {t.tenantName.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm font-medium text-text-primary group-hover:text-brand-700 transition-colors">
                  {t.tenantName}
                </span>
              </div>
              <span
                className={cn(
                  "text-[11px] font-medium px-2 py-0.5 rounded",
                  t.role === "owner"
                    ? "bg-brand-50 text-brand-700"
                    : t.role === "admin"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-surface-2 text-text-secondary",
                )}
              >
                {t.role}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── RootLayout ─────────────────────────────────────────────────

function RootLayout() {
  const utils = trpc.useUtils();
  const { data: session, isLoading: sessionLoading, isFetching: sessionFetching } = trpc.auth.me.useQuery();
  const { data: tenantList } = trpc.tenant.list.useQuery(undefined, {
    enabled: !!session?.user && !session?.tenantId,
  });
  const { data: businesses } = trpc.business.list.useQuery(undefined, {
    enabled: !!session?.user && !!session?.tenantId,
  });

  const navigate = useNavigate();
  useTheme();
  const [showPalette, setShowPalette] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showTenantPicker, setShowTenantPicker] = useState(false);
  const [currentBusinessId, setCurrentBusinessId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const selectTenantMutation = trpc.tenant.select.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      queryClient.invalidateQueries();
    },
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      setBusinessId(null);
      queryClient.clear();
      navigate({ to: "/login" });
    },
  });

  useHotkeys([
    {
      key: "k",
      ctrl: true,
      handler: () => setShowPalette(true),
      description: "Command palette",
      scope: "global",
    },
    {
      key: "/",
      handler: () => setShowPalette(true),
      description: "Search",
      scope: "global",
    },
    {
      key: "?",
      shift: true,
      handler: () => setShowShortcuts((v) => !v),
      description: "Keyboard shortcuts",
      scope: "global",
    },
    // ── Navigation shortcuts (Alt+Shift+Key) ──
    { key: "d", alt: true, shift: true, handler: () => navigate({ to: "/" }), description: "Dashboard", scope: "navigation" },
    { key: "i", alt: true, shift: true, handler: () => navigate({ to: "/invoices" }), description: "Invoices", scope: "navigation" },
    { key: "q", alt: true, shift: true, handler: () => navigate({ to: "/quotations" }), description: "Quotations", scope: "navigation" },
    { key: "c", alt: true, shift: true, handler: () => navigate({ to: "/credit-notes" }), description: "Credit Notes", scope: "navigation" },
    { key: "p", alt: true, shift: true, handler: () => navigate({ to: "/parties" }), description: "Parties", scope: "navigation" },
    { key: "t", alt: true, shift: true, handler: () => navigate({ to: "/items" }), description: "Items", scope: "navigation" },
    { key: "m", alt: true, shift: true, handler: () => navigate({ to: "/payments" }), description: "Payments", scope: "navigation" },
    { key: "b", alt: true, shift: true, handler: () => navigate({ to: "/cash-and-bank" }), description: "Cash & Bank", scope: "navigation" },
    { key: "e", alt: true, shift: true, handler: () => navigate({ to: "/expenses" }), description: "Expenses", scope: "navigation" },
    { key: "g", alt: true, shift: true, handler: () => navigate({ to: "/gst" }), description: "GST Returns", scope: "navigation" },
    { key: "r", alt: true, shift: true, handler: () => navigate({ to: "/reports" }), description: "Business Reports", scope: "navigation" },
    { key: "s", alt: true, shift: true, handler: () => navigate({ to: "/settings" }), description: "Settings", scope: "navigation" },
  ]);

  // Set business ID when businesses load — auto-select first
  useEffect(() => {
    if (businesses && businesses.length > 0 && !currentBusinessId) {
      setBusinessId(businesses[0].id);
      setCurrentBusinessId(businesses[0].id);
    }
  }, [businesses, currentBusinessId]);

  // Single consolidated redirect — priority order matters
  const publicPaths = ["/login", "/auth/verify", "/auth/complete-profile", "/auth/verify-email-change"];
  useEffect(() => {
    if (sessionLoading || sessionFetching) return;
    const path = typeof window !== "undefined" ? window.location.pathname : "";

    // Priority 1: Not authenticated → login
    if (!session?.user) {
      if (!publicPaths.some((p) => path.startsWith(p))) {
        navigate({ to: "/login" });
      }
      return;
    }

    // Priority 2: No name → complete profile
    if ((session as any)?.needsProfile) {
      if (path !== "/auth/complete-profile") {
        navigate({ to: "/auth/complete-profile" });
      }
      return;
    }

    // Priority 3: Authenticated with name but no business → settings
    if (session?.tenantId && businesses !== undefined && businesses.length === 0) {
      if (path !== "/settings") {
        navigate({ to: "/settings" });
      }
      return;
    }
  }, [sessionLoading, sessionFetching, session, businesses, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select single tenant
  const shouldAutoSelectTenant = !!(session?.user && !session?.tenantId && tenantList?.length === 1 && !selectTenantMutation.isPending && !selectTenantMutation.isSuccess);
  useEffect(() => {
    if (shouldAutoSelectTenant && tenantList) {
      selectTenantMutation.mutate({ tenantId: tenantList[0].tenantId });
    }
  }, [shouldAutoSelectTenant]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render logic (NO early returns before here — all hooks are above) ──

  const loadingSpinner = (
    <div className="min-h-screen flex items-center justify-center bg-surface-0">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center">
          <span className="text-white font-semibold text-lg">H</span>
        </div>
        <div className="w-5 h-5 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  );

  // Loading session
  if (sessionLoading) return loadingSpinner;

  // Not authenticated
  if (!session?.user) {
    const path = typeof window !== "undefined" ? window.location.pathname : "";
    const isPublic = publicPaths.some((p) => path.startsWith(p));
    if (!isPublic) return null; // redirect in flight
    return <Outlet />;
  }

  // Authenticated but no tenant selected
  if (!session.tenantId) {
    if (!tenantList) return loadingSpinner;

    if (tenantList.length === 0) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-surface-1">
          <div className="text-center">
            <p className="text-text-primary font-medium">No organization found</p>
            <p className="text-text-tertiary text-sm mt-1">
              Please contact support or try logging in again.
            </p>
          </div>
        </div>
      );
    }

    if (tenantList.length === 1) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-surface-0">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center">
              <span className="text-white font-semibold text-lg">H</span>
            </div>
            <div className="w-5 h-5 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      );
    }

    // Multiple tenants — show picker
    return (
      <TenantPicker
        tenants={tenantList}
        onSelect={(tenantId) => selectTenantMutation.mutate({ tenantId })}
      />
    );
  }

  const displayName = session.user.name || session.user.email.split("@")[0];
  const initials = displayName
    .split(" ")
    .map((w: string) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const _hasMultipleTenants = (tenantList?.length ?? 0) > 1;
  const _tenantName = session.tenantName ?? "Organization";

  function handleBusinessSwitch(id: string) {
    setBusinessId(id);
    setCurrentBusinessId(id);
    queryClient.invalidateQueries();
  }

  const activeBusiness = businesses?.find((b) => b.id === (currentBusinessId ?? businesses?.[0]?.id)) ?? businesses?.[0];
  const isGstRegistered =
    activeBusiness?.gstRegistrationType !== "unregistered" || !!activeBusiness?.gstin;

  return (
    <div className="flex h-screen overflow-hidden bg-surface-0">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "w-56 shrink-0 border-r border-border-light flex flex-col bg-surface-0 overflow-hidden",
          // On mobile: fixed drawer that slides in/out
          "fixed inset-y-0 left-0 z-50 transition-transform duration-200 md:relative md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="px-4 py-4 flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
            <span className="text-white font-semibold text-sm">H</span>
          </div>
          <span className="font-semibold text-[15px] tracking-tight text-text-primary">
            Hisaabo
          </span>
        </div>

        {/* Business switcher — only shown when multiple businesses */}
        {businesses && businesses.length > 1 && (
          <div className="px-3 py-2 border-b border-border-light shrink-0">
            <Listbox
              value={currentBusinessId ?? businesses[0].id}
              onChange={handleBusinessSwitch}
              options={businesses.map((b) => ({ value: b.id, label: b.name }))}
              placeholder="Select business"
            />
          </div>
        )}

        {/* Nav sections */}
        <nav className="flex-1 overflow-y-auto pb-2" onClick={() => setSidebarOpen(false)}>
          {navSections.map((section) => {
            const visibleItems = section.items.map((item) => {
              // Rename reports label based on GST status (always visible)
              if (item.to === "/gst") {
                return { ...item, label: (isGstRegistered ? "GST Returns" : "Tax Reports") as typeof item.label };
              }
              if (item.to === "/reports") {
                return { ...item, label: "Business Reports" as typeof item.label };
              }
              return item;
            });
            if (visibleItems.length === 0) return null;
            return (
              <div key={section.label}>
                <p className="px-3 pt-5 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                  {section.label}
                </p>
                {visibleItems.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="flex items-center gap-2.5 mx-2 px-3 py-[7px] rounded-lg text-[13px] transition-colors"
                    activeProps={{
                      className: "flex items-center gap-2.5 mx-2 px-3 py-[7px] rounded-lg text-[13px] transition-colors bg-brand-600/10 text-brand-700 font-medium",
                    }}
                    inactiveProps={{
                      className: "flex items-center gap-2.5 mx-2 px-3 py-[7px] rounded-lg text-[13px] transition-colors text-text-secondary hover:bg-surface-2 hover:text-text-primary",
                    }}
                    activeOptions={{ exact: "exact" in item ? item.exact : false }}
                  >
                    <item.icon />
                    {item.label}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>

      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden bg-surface-1 md:ml-0">
        {/* Top bar */}
        <div className="h-14 border-b border-border-light flex items-center gap-2 px-4 md:px-6 shrink-0 bg-surface-0">
          {/* Hamburger — mobile only */}
          <button
            type="button"
            className="md:hidden flex items-center justify-center w-8 h-8 rounded-lg text-text-secondary hover:bg-surface-1 transition-colors shrink-0"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation menu"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 4.5h14M2 9h14M2 13.5h14" />
            </svg>
          </button>

          {/* Theme + shortcuts */}
          <ThemeToggle />
          <button
            onClick={() => setShowShortcuts(true)}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-sm text-text-tertiary hover:bg-surface-1 transition-colors border border-border-light shrink-0"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
          >
            <span className="font-mono text-xs">?</span>
          </button>

          {/* User info — pushed to the right */}
          <div className="ml-auto flex items-center gap-3 min-w-0">
            {/* Business name */}
            {activeBusiness && (
              <span className="hidden sm:block text-xs text-text-tertiary truncate max-w-[140px]">
                {activeBusiness.name}
              </span>
            )}

            {/* Divider */}
            {activeBusiness && (
              <span className="hidden sm:block w-px h-4 bg-border-light shrink-0" aria-hidden="true" />
            )}

            {/* Avatar + name + role */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-full bg-brand-100 dark:bg-brand-900 flex items-center justify-center text-brand-700 dark:text-brand-300 text-[10px] font-semibold shrink-0">
                {initials}
              </div>
              <span className="hidden sm:block text-sm font-medium text-text-primary truncate max-w-[120px]">
                {displayName}
              </span>
              {session.role && (
                <span className="hidden sm:block shrink-0">
                  <RoleBadge role={session.role} />
                </span>
              )}
            </div>

            {/* Logout */}
            <button
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              className="flex items-center justify-center w-7 h-7 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-surface-1 transition-colors border border-border-light shrink-0"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogoutIcon />
            </button>

            {/* Version */}
            <span className="hidden md:block text-[10px] text-text-tertiary/50 select-none shrink-0">
              v{__APP_VERSION__}
            </span>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[1400px] mx-auto px-6 py-6">
            <Outlet />
          </div>
        </div>
      </main>

      <CommandPalette open={showPalette} onClose={() => setShowPalette(false)} />
      <ShortcutsDialog open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      <ShortcutIndicator />

      {/* Tenant picker overlay — shown when user clicks the tenant name */}
      {showTenantPicker && tenantList && tenantList.length > 1 && (
        <TenantPicker
          tenants={tenantList}
          onSelect={(tenantId) => {
            setShowTenantPicker(false);
            selectTenantMutation.mutate({ tenantId });
          }}
        />
      )}
    </div>
  );
}

// ── Theme Toggle ───────────────────────────────────────────────

type Theme = "light" | "dark" | "system";

function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const next: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
  const icons: Record<Theme, React.ReactNode> = {
    system: <MonitorIcon />,
    light: <SunIcon />,
    dark: <MoonIcon />,
  };
  const labels: Record<Theme, string> = {
    system: "System theme",
    light: "Light mode",
    dark: "Dark mode",
  };

  return (
    <button
      onClick={() => setTheme(next[theme])}
      className="flex items-center justify-center w-8 h-8 rounded-lg text-text-tertiary hover:bg-surface-1 transition-colors border border-border-light"
      aria-label={labels[theme]}
      title={labels[theme]}
    >
      {icons[theme]}
    </button>
  );
}

// ── Role Badge ────────────────────────────────────────────────

const roleStyles: Record<string, string> = {
  owner: "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300",
  admin: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  member: "bg-surface-2 text-text-secondary",
  seller: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  accountant: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
};

const roleLabels: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  seller: "Seller",
  accountant: "Accountant",
};

function RoleBadge({ role }: { role: string }) {
  const style = roleStyles[role] ?? "bg-surface-2 text-text-secondary";
  const label = roleLabels[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
  return (
    <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 leading-none", style)}>
      {label}
    </span>
  );
}

// ── Keyboard Shortcuts Dialog ──────────────────────────────────

function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const hotkeys = open ? getRegisteredHotkeys() : [];

  // Group by scope
  const grouped: Record<string, typeof hotkeys> = {};
  for (const h of hotkeys) {
    const scope = h.scope || "general";
    if (!grouped[scope]) grouped[scope] = [];
    grouped[scope].push(h);
  }

  // Deduplicate by description (some shortcuts register twice across re-renders)
  for (const scope of Object.keys(grouped)) {
    const seen = new Set<string>();
    grouped[scope] = grouped[scope].filter((h) => {
      if (seen.has(h.description)) return false;
      seen.add(h.description);
      return true;
    });
  }

  function formatKey(h: (typeof hotkeys)[0]): string[] {
    const keys: string[] = [];
    if (h.ctrl) keys.push("⌘");
    if (h.alt) keys.push("Alt");
    if (h.shift) keys.push("⇧");
    keys.push(h.key.length === 1 ? h.key.toUpperCase() : h.key);
    return keys;
  }

  const scopeLabels: Record<string, string> = {
    global: "Global",
    navigation: "Navigation (Alt+Shift + Key)",
    parties: "Parties",
    items: "Items",
    payments: "Payments",
    invoices: "Invoices",
    expenses: "Expenses",
    general: "General",
  };

  // Sort scopes: global first, navigation second, then page-specific
  const scopeOrder = ["global", "navigation", "parties", "items", "payments", "invoices", "expenses", "general"];

  return (
    <Modal open={open} onClose={onClose} title="Keyboard Shortcuts" className="max-w-md">
      <div className="space-y-4">
        {scopeOrder.filter((s) => grouped[s]?.length).map((scope) => ({ scope, defs: grouped[scope] })).concat(
          Object.entries(grouped).filter(([s]) => !scopeOrder.includes(s)).map(([scope, defs]) => ({ scope, defs }))
        ).map(({ scope, defs }) => (
          <div key={scope}>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">
              {scopeLabels[scope] || scope}
            </p>
            <div className="space-y-0.5">
              {defs.map((h) => (
                <div
                  key={h.description}
                  className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-surface-1"
                >
                  <span className="text-sm text-text-secondary">{h.description}</span>
                  <KbdShortcut keys={formatKey(h)} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ── SVG Icons ──────────────────────────────────────────────────

function DashboardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
    </svg>
  );
}

function InvoiceIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2.5h10a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1v-9a1 1 0 011-1z" />
      <path d="M5 6h6M5 8.5h4" />
    </svg>
  );
}

function QuotationIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2.5h10a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1v-9a1 1 0 011-1z" />
      <path d="M5 6h4M5 8.5h3" />
      <path d="M10.5 10l1.5-1.5-1.5-1.5" />
    </svg>
  );
}

function CreditNoteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2.5h10a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1v-9a1 1 0 011-1z" />
      <path d="M5 8.5h6" />
    </svg>
  );
}

function DeliveryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 9.5h8V3.5H1.5v6z" />
      <path d="M9.5 5.5h2.5l2 2.5v1.5h-4.5V5.5z" />
      <circle cx="4" cy="11.5" r="1.2" />
      <circle cx="11.5" cy="11.5" r="1.2" />
    </svg>
  );
}

function ProformaIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2.5h10a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1v-9a1 1 0 011-1z" />
      <path d="M5 6h6M5 8.5h3" />
      <path d="M9.5 10.5l1.5 1 2-2" />
    </svg>
  );
}

function PartyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="5" r="2.5" />
      <path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4" />
    </svg>
  );
}

function ItemIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4l6-2.5L14 4v8l-6 2.5L2 12V4z" />
      <path d="M8 6.5V14.5M2 4l6 2.5L14 4" />
    </svg>
  );
}

function PaymentIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
      <path d="M1.5 7h13" />
    </svg>
  );
}

function BankIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 13.5h13M1.5 6.5h13" />
      <path d="M8 2.5l6 4H2l6-4z" />
      <path d="M3.5 6.5v7M6.5 6.5v7M9.5 6.5v7M12.5 6.5v7" />
    </svg>
  );
}

function GSTIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 13V3a1 1 0 011-1h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1z" />
      <path d="M5 6h6M5 8.5h4M5 11h2" />
    </svg>
  );
}

function SalesReturnIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2.5h10a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1v-9a1 1 0 011-1z" />
      <path d="M6 6l-2 2 2 2" />
      <path d="M4 8h5.5a1.5 1.5 0 000-3H9" />
    </svg>
  );
}

function ExpenseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="1.5" width="10" height="13" rx="1" />
      <path d="M6 5h4M6 8h4M6 11h2" />
    </svg>
  );
}

function ShipmentsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 5.5h8v7H1z" />
      <path d="M9 7h3.5l2 2.5V12.5H9V7z" />
      <circle cx="3.5" cy="13" r="1.2" />
      <circle cx="11.5" cy="13" r="1.2" />
      <path d="M3.5 5.5V3a1 1 0 011-1h3a1 1 0 011 1v2.5" />
    </svg>
  );
}

function ReportsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12.5V4l3 3 3-3.5L11 6l3-3" />
      <path d="M2 14.5h12" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v2M8 12.5v2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M1.5 8h2M12.5 8h2M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </svg>
  );
}

function StoreOrdersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 2.5h13l-1.5 6h-10z" />
      <circle cx="5.5" cy="13" r="1.2" />
      <circle cx="10.5" cy="13" r="1.2" />
      <path d="M5.5 11.8V9.5M10.5 11.8V9.5" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v2M8 12.5v2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M1.5 8h2M12.5 8h2M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M13.5 8.5a5.5 5.5 0 01-7-7 5.5 5.5 0 107 7z" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" />
      <path d="M5.5 14h5M8 11.5v2.5" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3" />
      <path d="M11 11l3-3-3-3" />
      <path d="M14 8H6" />
    </svg>
  );
}
