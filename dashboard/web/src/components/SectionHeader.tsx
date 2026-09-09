import type { ReactNode } from "react";
import { cn } from "../lib/utils";
import { InfoTip } from "./InfoTip";

/**
 * Uppercase 11px section label. By default carries a 3px edge rule beneath (spec §3) — the
 * one-per-tab heading. Pass `rule={false}` for a lighter, ruleless sub-heading (e.g. a panel
 * heading nested inside a tab) that keeps the same type scale but drops the structural rule and
 * uses the muted ink color instead. Pass `info` to render an `InfoTip` explaining the section.
 */
export function SectionHeader({
  children,
  rule = true,
  info,
}: {
  children: ReactNode;
  rule?: boolean;
  info?: ReactNode;
}) {
  if (!info) {
    return (
      <h2
        className={cn(
          "mb-4 text-[11px] font-bold uppercase tracking-[0.08em]",
          rule ? "border-b-[3px] border-edge pb-2" : "text-[color:var(--color-ink-muted)]",
        )}
      >
        {children}
      </h2>
    );
  }

  return (
    <div className={cn("mb-4 flex items-center gap-1", rule && "border-b-[3px] border-edge pb-2")}>
      <h2
        className={cn(
          "text-[11px] font-bold uppercase tracking-[0.08em]",
          !rule && "text-[color:var(--color-ink-muted)]",
        )}
      >
        {children}
      </h2>
      <InfoTip label={`about ${typeof children === "string" ? children : "this"}`}>{info}</InfoTip>
    </div>
  );
}
