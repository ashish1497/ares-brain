import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

export const alertVariants = cva(
  "rounded-nb border-[3px] border-edge p-3 text-sm shadow-[var(--nb-shadow)]",
  {
    variants: {
      variant: {
        default: "bg-card text-inherit",
        warn: "bg-soon text-black",
        bad: "bg-bad text-black",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type AlertProps = ComponentProps<"div"> & VariantProps<typeof alertVariants>;

export function Alert({ className, variant, ...props }: AlertProps) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mb-1 font-bold leading-none tracking-tight", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("text-sm opacity-90", className)} {...props} />;
}
