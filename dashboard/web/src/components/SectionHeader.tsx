import type { ReactNode } from "react";

/** Uppercase 11px section label with a 3px edge rule beneath (spec §3). */
export function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-4 border-b-[3px] border-edge pb-2 text-[11px] font-bold uppercase tracking-[0.08em]">
      {children}
    </h2>
  );
}
