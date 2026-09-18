import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/**
 * Vendored from neobrutalism.dev's `card` (structure preserved), retargeted to
 * palette B tokens: 3px edge border + `4px 4px 0` offset shadow + 2px radius.
 */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex flex-col gap-4 rounded-nb border-[length:var(--nb-border)] border-edge bg-card p-4 text-inherit shadow-[var(--nb-shadow)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="card-header" className={cn("flex flex-col gap-1", className)} {...props} />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("font-bold leading-none tracking-tight", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="card-description" className={cn("text-sm opacity-70", className)} {...props} />
  );
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="card-content" className={cn("flex flex-col gap-2", className)} {...props} />
  );
}

export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center gap-2 pt-2", className)}
      {...props}
    />
  );
}
