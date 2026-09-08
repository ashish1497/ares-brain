import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-nb border-[3px] border-edge px-2 py-0.5 text-xs font-bold",
  {
    variants: {
      variant: {
        default: "bg-card text-inherit",
        ok: "bg-ok text-black",
        soon: "bg-soon text-black",
        bad: "bg-bad text-black",
        cta: "bg-cta text-black",
        accent: "bg-accent text-black",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
