import { useNavigate } from "@tanstack/react-router";
import { Modal } from "@/components/ui/Modal";

function UploadIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function InvoiceIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h5" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

interface WhatsNextModalProps {
  open: boolean;
  businessName: string;
  onImport: () => void;
}

export function WhatsNextModal({ open, businessName, onImport }: WhatsNextModalProps) {
  const navigate = useNavigate();

  const options = [
    {
      icon: <UploadIcon />,
      title: "Import from another app",
      description: "Migrate parties, items, and invoices from myBillBook, Tally, or CSV files",
      onClick: onImport,
    },
    {
      icon: <InvoiceIcon />,
      title: "Create your first invoice",
      description: "Start billing right away with a new sale invoice",
      onClick: () => navigate({ to: "/invoices", search: { create: "true" } }),
    },
    {
      icon: <DashboardIcon />,
      title: "Explore the dashboard",
      description: "See an overview of your business at a glance",
      onClick: () => navigate({ to: "/" }),
    },
  ];

  return (
    <Modal open={open} onClose={() => {}} className="max-w-md">
      <div className="text-center mb-6">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
          <svg className="w-6 h-6 text-emerald-600" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-text-primary">Your business is ready!</h2>
        <p className="text-sm text-text-tertiary mt-1">
          <span className="font-medium text-text-secondary">{businessName}</span> has been set up. What would you like to do first?
        </p>
      </div>

      <div className="space-y-2">
        {options.map((opt) => (
          <button
            key={opt.title}
            onClick={opt.onClick}
            className="w-full flex items-start gap-3 px-4 py-3 rounded-xl border border-border-light hover:border-brand-400 hover:bg-brand-600/[0.03] transition-colors text-left group"
          >
            <span className="w-9 h-9 shrink-0 rounded-lg bg-surface-2 group-hover:bg-brand-600/10 flex items-center justify-center text-text-tertiary group-hover:text-brand-600 transition-colors">
              {opt.icon}
            </span>
            <div>
              <p className="text-sm font-medium text-text-primary">{opt.title}</p>
              <p className="text-xs text-text-tertiary mt-0.5">{opt.description}</p>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}
