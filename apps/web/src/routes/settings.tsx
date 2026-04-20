import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { BusinessTab, BusinessForm } from "@/components/settings/BusinessTab";
import { DocumentsTab } from "@/components/settings/DocumentsTab";
import { TeamTab } from "@/components/settings/TeamTab";
import { SalesTargetsTab } from "@/components/settings/SalesTargetsTab";
import { AppearanceTab } from "@/components/settings/AppearanceTab";
import { DataTab } from "@/components/settings/DataTab";
import { AccountTab } from "@/components/settings/AccountTab";
import { BackupTab } from "@/components/settings/BackupTab";
import { StoreTab } from "@/components/settings/StoreTab";
import { POSTab } from "@/components/settings/POSTab";
import { ShippingTab } from "@/components/settings/ShippingTab";
import { WhatsNextModal } from "@/components/settings/WhatsNextModal";
import { ImportWizard } from "@/components/ImportWizard";
import { RestoreOnboarding } from "@/components/settings/RestoreOnboarding";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const [tab, setTab] = useState(() => sessionStorage.getItem("settings-tab") || "business");
  const handleTabChange = (t: string) => { setTab(t); sessionStorage.setItem("settings-tab", t); };
  const { data: businesses, isLoading } = trpc.business.list.useQuery();
  const { data: session } = trpc.auth.me.useQuery();
  const [showWhatsNext, setShowWhatsNext] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [newBizName, setNewBizName] = useState("");
  const [showCreateBusiness, setShowCreateBusiness] = useState(
    () => new URLSearchParams(window.location.search).get("action") === "create-business",
  );
  // "create" = show BusinessForm, "restore" = show RestoreOnboarding
  const [onboardingPath, setOnboardingPath] = useState<"choose" | "create" | "restore">("choose");
  const biz = businesses?.[0];
  const hasRole = ["owner", "admin", "superadmin"].includes(session?.role ?? "");
  const { data: canCreateBizPlan } = trpc.business.canCreate.useQuery(undefined, {
    enabled: !!session?.tenantId && hasRole,
  });
  const canCreateBusiness = hasRole && (canCreateBizPlan ?? true);
  const isOwner = session?.role === "owner" || session?.role === "superadmin";

  // Listen for "create-business" event from BusinessSwitcher (when already on settings)
  useEffect(() => {
    const handler = () => setShowCreateBusiness(true);
    window.addEventListener("create-business", handler);
    return () => window.removeEventListener("create-business", handler);
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-32" />
        <div className="skeleton h-64 rounded-xl" />
      </div>
    );
  }

  // First-run: no business yet
  if (!biz && !showWhatsNext) {
    if (!canCreateBusiness) {
      // Invited user (seller, accountant, etc.) — they can't create businesses.
      // Show a waiting message instead of the creation form.
      return (
        <div>
          <PageHeader title="Welcome!" description="" />
          <div className="card px-6 py-8 text-center">
            <p className="text-sm text-text-primary font-medium mb-1">
              No business has been set up yet.
            </p>
            <p className="text-sm text-text-tertiary">
              Your organization admin needs to create a business first. You'll see it here once it's ready.
            </p>
          </div>
        </div>
      );
    }

    // Restore path — owner is restoring from a previous backup
    if (onboardingPath === "restore" && isOwner && session?.tenantId) {
      return (
        <div>
          <PageHeader title="Restore from backup" description="Import a previously exported Hisaabo backup" />
          <RestoreOnboarding
            tenantId={session.tenantId}
            onBack={() => setOnboardingPath("choose")}
          />
        </div>
      );
    }

    // Create path — standard new business form
    if (onboardingPath === "create") {
      return (
        <div>
          <PageHeader title="Almost there!" description="Set up your business to start creating invoices" />
          {isOwner && (
            <button
              className="btn-ghost text-xs mb-4"
              onClick={() => setOnboardingPath("choose")}
            >
              &larr; Back to options
            </button>
          )}
          <BusinessForm
            onDone={(name) => {
              if (name) setNewBizName(name);
              setShowWhatsNext(true);
            }}
          />
        </div>
      );
    }

    // Choice screen — owners can choose between creating fresh or restoring
    // Non-owners go straight to create (they can't restore)
    if (!isOwner) {
      return (
        <div>
          <PageHeader title="Almost there!" description="Set up your business to start creating invoices" />
          <BusinessForm
            onDone={(name) => {
              if (name) setNewBizName(name);
              setShowWhatsNext(true);
            }}
          />
        </div>
      );
    }

    return (
      <div>
        <PageHeader title="Get started" description="Set up your organization" />
        <div className="max-w-lg space-y-3">
          <button
            onClick={() => setOnboardingPath("create")}
            className="w-full flex items-start gap-3 px-5 py-4 rounded-xl border border-border-light hover:border-brand-400 hover:bg-brand-600/[0.03] transition-colors text-left group card"
          >
            <span className="w-9 h-9 shrink-0 rounded-lg bg-surface-2 group-hover:bg-brand-600/10 flex items-center justify-center text-text-tertiary group-hover:text-brand-600 transition-colors mt-0.5">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <div>
              <p className="text-sm font-medium text-text-primary">Create a new business</p>
              <p className="text-xs text-text-tertiary mt-0.5">Start fresh — set up your business profile and begin invoicing</p>
            </div>
          </button>

          <button
            onClick={() => setOnboardingPath("restore")}
            className="w-full flex items-start gap-3 px-5 py-4 rounded-xl border border-border-light hover:border-brand-400 hover:bg-brand-600/[0.03] transition-colors text-left group card"
          >
            <span className="w-9 h-9 shrink-0 rounded-lg bg-surface-2 group-hover:bg-brand-600/10 flex items-center justify-center text-text-tertiary group-hover:text-brand-600 transition-colors mt-0.5">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </span>
            <div>
              <p className="text-sm font-medium text-text-primary">Restore from a backup</p>
              <p className="text-xs text-text-tertiary mt-0.5">Import a previously exported Hisaabo backup to restore all your data</p>
            </div>
          </button>
        </div>
      </div>
    );
  }

  // Create additional business (triggered from BusinessSwitcher)
  if (showCreateBusiness && biz) {
    if (!canCreateBusiness) {
      return (
        <div>
          <PageHeader title="Cannot create business" description="" />
          <div className="card px-6 py-8 text-center">
            <p className="text-sm text-text-primary font-medium mb-1">
              Your role in this organization doesn't allow creating businesses.
            </p>
            <p className="text-sm text-text-tertiary mb-4">
              To create your own business, sign out and create a new organization at login.
            </p>
            <button
              className="btn-ghost text-sm"
              onClick={() => {
                window.history.replaceState({}, "", "/settings");
                setShowCreateBusiness(false);
              }}
            >
              Back to settings
            </button>
          </div>
        </div>
      );
    }
    return (
      <div>
        <PageHeader title="Create New Business" description="Add another business to your organization" />
        <BusinessForm
          onDone={(name) => {
            window.history.replaceState({}, "", "/settings");
            if (name) setNewBizName(name);
            setShowCreateBusiness(false);
            setShowWhatsNext(true);
          }}
        />
      </div>
    );
  }

  // WhatsNext modal shown after business creation (survives the biz refetch)
  if (showWhatsNext) {
    return (
      <>
        <WhatsNextModal
          open
          businessName={newBizName}
          onImport={() => {
            setShowWhatsNext(false);
            setShowImport(true);
          }}
        />
        <ImportWizard open={showImport} onClose={() => setShowImport(false)} />
      </>
    );
  }

  // Import launched from WhatsNext
  if (showImport) {
    return <ImportWizard open onClose={() => setShowImport(false)} />;
  }

  return (
    <div>
      <PageHeader title="Settings" description="Manage your business and preferences" />
      <div className="flex gap-8 mt-2">
        <SettingsNav value={tab} onChange={handleTabChange} role={session?.role} />
        <div className="flex-1 min-w-0">
          {tab === "business" && <BusinessTab biz={biz} />}
          {tab === "documents" && <DocumentsTab biz={biz} />}
          {tab === "shipping" && biz && <ShippingTab biz={biz} />}
          {tab === "team" && <TeamTab />}
          {tab === "targets" && <SalesTargetsTab />}
          {tab === "appearance" && <AppearanceTab />}
          {tab === "data" && <DataTab />}
          {tab === "account" && <AccountTab />}
          {tab === "store" && <StoreTab />}
          {tab === "pos" && biz && <POSTab biz={biz} />}
          {tab === "backup" && <BackupTab />}
        </div>
      </div>
    </div>
  );
}
