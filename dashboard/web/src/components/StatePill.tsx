import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const pillVariants = cva(
  "inline-flex items-center rounded-nb border-[3px] border-edge px-2 py-0.5 text-[11px] font-bold uppercase",
  {
    variants: {
      state: {
        ok: "bg-ok text-black",
        soon: "bg-soon text-black",
        bad: "bg-bad text-black",
        neutral: "bg-card text-inherit",
      },
    },
    defaultVariants: { state: "neutral" },
  },
);

export type StatePillProps = VariantProps<typeof pillVariants> & {
  state: "ok" | "soon" | "bad" | "neutral";
  children: ReactNode;
  className?: string;
};

/** A solid status pill — `ok`/`soon`/`bad`/`neutral` are the only allowed status colours. */
export function StatePill({ state, children, className }: StatePillProps) {
  return <span className={cn(pillVariants({ state }), className)}>{children}</span>;
}
