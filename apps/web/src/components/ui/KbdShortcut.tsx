import { cn } from "@/lib/utils";

interface KbdShortcutProps {
  keys: string[];
  className?: string;
  /** Hide from assistive tech (e.g. a hint inside a button, so its name stays stable). */
  "aria-hidden"?: boolean;
}

export function KbdShortcut({ keys, className, "aria-hidden": ariaHidden }: KbdShortcutProps) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-hidden={ariaHidden}>
      {keys.map((key, i) => (
        <kbd
          key={i}
          className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded bg-surface-2 text-[11px] font-mono font-medium text-text-tertiary border border-border-light"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}
