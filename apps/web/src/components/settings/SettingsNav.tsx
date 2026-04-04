import { cn } from "@/lib/utils";

interface SettingsTab {
  value: string;
  label: string;
  icon: React.ReactNode;
}

function BuildingIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h5" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a10 10 0 000 20c1.1 0 2-.9 2-2v-.5c0-.8.7-1.5 1.5-1.5H17a3 3 0 003-3 8 8 0 00-8-8z" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function StoreIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 01-8 0" />
    </svg>
  );
}

function TargetIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

function TruckIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
      <path d="M1 3h15v13H1z" /><path d="M16 8h4l3 3v5h-7V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}

const SETTINGS_TABS: SettingsTab[] = [
  { value: "business", label: "Business", icon: <BuildingIcon /> },
  { value: "documents", label: "Documents", icon: <DocumentIcon /> },
  { value: "shipping", label: "Shipping", icon: <TruckIcon /> },
  { value: "team", label: "Team", icon: <UsersIcon /> },
  { value: "targets", label: "Sales Targets", icon: <TargetIcon /> },
  { value: "appearance", label: "Appearance", icon: <PaletteIcon /> },
  { value: "data", label: "Data", icon: <DatabaseIcon /> },
  { value: "account", label: "Account", icon: <UserIcon /> },
  { value: "store", label: "Online Store", icon: <StoreIcon /> },
];

interface SettingsNavProps {
  value: string;
  onChange: (value: string) => void;
}

export function SettingsNav({ value, onChange }: SettingsNavProps) {
  return (
    <>
      {/* Desktop: vertical sidebar — sticky */}
      <nav className="hidden md:block w-[220px] shrink-0 sticky top-0 self-start">
        <div className="space-y-0.5">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => onChange(tab.value)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-left",
                tab.value === value
                  ? "bg-surface-2 text-text-primary font-medium"
                  : "text-text-secondary hover:bg-surface-1 hover:text-text-primary"
              )}
            >
              <span className="w-[18px] h-[18px] shrink-0">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Mobile: horizontal scrollable tabs — sticky */}
      <div className="md:hidden flex gap-1 overflow-x-auto pb-4 -mx-1 px-1 sticky top-0 z-10 bg-surface-1">
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => onChange(tab.value)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors",
              tab.value === value
                ? "bg-brand-600/10 text-brand-700 dark:text-brand-400"
                : "text-text-tertiary hover:text-text-secondary hover:bg-surface-2"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </>
  );
}
