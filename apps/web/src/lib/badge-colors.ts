export type BadgeColorName =
  | "emerald"
  | "blue"
  | "red"
  | "amber"
  | "brand"
  | "teal"
  | "orange";

export function badgeColor(color: BadgeColorName): string {
  return `bg-${color}-600/[0.08] text-${color}-700 dark:text-${color}-400`;
}

export const badgeColorFallback = "bg-surface-2 text-text-secondary";
