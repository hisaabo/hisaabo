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
import { StoreTab } from "@/components/settings/StoreTab";
import { ShippingTab } from "@/components/settings/ShippingTab";
import { WhatsNextModal } from "@/components/settings/WhatsNextModal";
import { ImportWizard } from "@/components/ImportWizard";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const [tab, setTab] = useState("business");
  const { data: businesses, isLoading } = trpc.business.list.useQuery();
  const { data: session } = trpc.auth.me.useQuery();
  const [showWhatsNext, setShowWhatsNext] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [newBizName, setNewBizName] = useState("");
  const [showCreateBusiness, setShowCreateBusiness] = useState(
    () => new URLSearchParams(window.location.search).get("action") === "create-business",
  );
  const biz = businesses?.[0];
  const canCreateBusiness = ["owner", "admin", "superadmin"].includes(session?.role ?? "");

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

  // First-run: no business yet — show creation form full-width
  if (!biz && !showWhatsNext) {
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
        <SettingsNav value={tab} onChange={setTab} />
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
        </div>
      </div>
    </div>
  );
}
