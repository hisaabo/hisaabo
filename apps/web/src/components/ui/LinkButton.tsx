import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface LinkButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export function LinkButton({ children, className, ...props }: LinkButtonProps) {
  return (
    <button
      type="button"
      className={cn("text-sm text-brand-600 dark:text-brand-400 hover:underline", className)}
      {...props}
    >
      {children}
    </button>
  );
}
