import { createRootRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { trpc, setBusinessId } from "@/lib/trpc";
import { useHotkeys } from "@/hooks/useHotkeys";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { KbdShortcut } from "@/components/ui/KbdShortcut";
import { ShortcutIndicator } from "@/components/ui/ShortcutIndicator";
import { Modal } from "@/components/ui/Modal";
import { getRegisteredHotkeys } from "@/hooks/useHotkeys";

export const Route = createRootRoute({
  component: RootLayout,
});

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
    ],
  },
  {
    label: "COMPLIANCE",
    items: [
      { to: "/gst", label: "GST Reports", icon: GSTIcon },
    ],
  },
] as const;

function RootLayout() {
  const { data: session, isLoading: sessionLoading } = trpc.auth.me.useQuery();
  const { data: businesses } = trpc.business.list.useQuery(undefined, {
    enabled: !!session?.user,
  });
  const navigate = useNavigate();
  const [showPalette, setShowPalette] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

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
    { key: "g", alt: true, shift: true, handler: () => navigate({ to: "/gst" }), description: "GST Reports", scope: "navigation" },
    { key: "s", alt: true, shift: true, handler: () => navigate({ to: "/settings" }), description: "Settings", scope: "navigation" },
  ]);

  // Set business ID when businesses load
  if (businesses && businesses.length > 0) {
    setBusinessId(businesses[0].id);
  }

  // While checking auth, show nothing (prevents login flash)
  if (sessionLoading) {
    return null;
  }

  // Not authenticated — show login page without sidebar
  if (!session?.user) {
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      navigate({ to: "/login" });
      return null;
    }
    return <Outlet />;
  }

  const initials = session.user.name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex h-screen overflow-hidden bg-surface-0">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-border-light flex flex-col bg-surface-0 overflow-hidden">
        {/* Logo */}
        <div className="px-4 py-4 flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
            <span className="text-white font-semibold text-sm">B</span>
          </div>
          <span className="font-semibold text-[15px] tracking-tight text-text-primary">
            Billbook
          </span>
        </div>

        {/* Nav sections */}
        <nav className="flex-1 overflow-y-auto pb-2">
          {navSections.map((section) => (
            <div key={section.label}>
              <p className="px-3 pt-5 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                {section.label}
              </p>
              {section.items.map((item) => (
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
          ))}
        </nav>

        {/* Bottom: Settings + User card */}
        <div className="shrink-0 border-t border-border-light">
          <div className="pt-1 pb-1">
            <Link
              to="/settings"
              className="flex items-center gap-2.5 mx-2 px-3 py-[7px] rounded-lg text-[13px] transition-colors"
              activeProps={{
                className: "flex items-center gap-2.5 mx-2 px-3 py-[7px] rounded-lg text-[13px] transition-colors bg-brand-600/10 text-brand-700 font-medium",
              }}
              inactiveProps={{
                className: "flex items-center gap-2.5 mx-2 px-3 py-[7px] rounded-lg text-[13px] transition-colors text-text-secondary hover:bg-surface-2 hover:text-text-primary",
              }}
            >
              <SettingsIcon />
              Settings
            </Link>
          </div>

          {/* User card */}
          <div className="px-3 py-3">
            <div className="flex items-center gap-2.5 px-2">
              <div className="w-7 h-7 rounded-full bg-brand-100 dark:bg-brand-900 flex items-center justify-center text-brand-700 dark:text-brand-300 text-[11px] font-semibold shrink-0">
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium truncate text-text-primary">
                  {session.user.name}
                </p>
                <p className="text-[11px] truncate text-text-tertiary">
                  {session.user.email}
                </p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden bg-surface-1">
        {/* Top bar */}
        <div className="h-14 border-b border-border-light flex items-center justify-between px-6 shrink-0 bg-surface-0">
          <div />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPalette(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-text-tertiary hover:bg-surface-1 transition-colors border border-border-light"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              Search...
              <KbdShortcut keys={["⌘", "K"]} />
            </button>
            <button
              onClick={() => setShowShortcuts(true)}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-sm text-text-tertiary hover:bg-surface-1 transition-colors border border-border-light"
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
            >
              <span className="font-mono text-xs">?</span>
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[1200px] mx-auto px-6 py-6">
            <Outlet />
          </div>
        </div>
      </main>

      <CommandPalette open={showPalette} onClose={() => setShowPalette(false)} />
      <ShortcutsDialog open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      <ShortcutIndicator />
    </div>
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
    general: "General",
  };

  // Sort scopes: global first, navigation second, then page-specific
  const scopeOrder = ["global", "navigation", "parties", "items", "payments", "invoices", "general"];

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

function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v2M8 12.5v2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M1.5 8h2M12.5 8h2M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </svg>
  );
}
