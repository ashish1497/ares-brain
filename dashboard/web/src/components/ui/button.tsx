import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-nb border-[3px] border-edge font-bold transition-all disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge",
  {
    variants: {
      variant: {
        default:
          "bg-cta text-black shadow-[var(--nb-shadow)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none",
        neutral:
          "bg-card text-inherit shadow-[var(--nb-shadow)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none",
        ghost: "border-transparent hover:bg-card",
      },
      size: {
        default: "h-9 px-4 text-sm",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-6 text-base",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
