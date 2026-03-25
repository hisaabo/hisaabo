import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

type ThemeOption = { value: "light" | "dark" | "system"; label: string; description: string };

const themeOptions: ThemeOption[] = [
  { value: "system", label: "System", description: "Follows your OS preference" },
  { value: "light", label: "Light", description: "Always use the light theme" },
  { value: "dark", label: "Dark", description: "Always use the dark theme" },
];

export function AppearanceTab() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="card px-6 py-5">
      <h3 className="text-sm font-semibold text-text-primary mb-1">Appearance</h3>
      <p className="text-sm text-text-tertiary mb-4">Choose how Hisaabo looks on this device</p>
      <div className="flex gap-3">
        {themeOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setTheme(opt.value)}
            className={cn(
              "flex-1 flex flex-col items-start px-4 py-3 rounded-lg border text-left transition-colors",
              theme === opt.value
                ? "border-brand-500 bg-brand-600/5 text-brand-700 dark:text-brand-400"
                : "border-border-light hover:border-border-color hover:bg-surface-1 text-text-secondary",
            )}
          >
            <span className="text-sm font-medium">{opt.label}</span>
            <span className="text-xs mt-0.5 text-text-tertiary">{opt.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
