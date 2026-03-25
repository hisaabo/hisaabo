import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { BusinessTab, BusinessForm } from "@/components/settings/BusinessTab";
import { DocumentsTab } from "@/components/settings/DocumentsTab";
import { TeamTab } from "@/components/settings/TeamTab";
import { AppearanceTab } from "@/components/settings/AppearanceTab";
import { DataTab } from "@/components/settings/DataTab";
import { AccountTab } from "@/components/settings/AccountTab";
import { StoreTab } from "@/components/settings/StoreTab";
import { WhatsNextModal } from "@/components/settings/WhatsNextModal";
import { ImportWizard } from "@/components/ImportWizard";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const [tab, setTab] = useState("business");
  const { data: businesses, isLoading } = trpc.business.list.useQuery();
  const [showWhatsNext, setShowWhatsNext] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [newBizName, setNewBizName] = useState("");
  const biz = businesses?.[0];

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
          {tab === "team" && <TeamTab />}
          {tab === "appearance" && <AppearanceTab />}
          {tab === "data" && <DataTab />}
          {tab === "account" && <AccountTab />}
          {tab === "store" && <StoreTab />}
        </div>
      </div>
    </div>
  );
}
