import type { ReactNode } from "react";
import { Rule } from "./Rule";

/** Inline metadata spans joined by a 1px vertical rule — never a middot. */
export function MetaRow({ items }: { items: ReactNode[] }) {
  return (
    <div className="flex items-center gap-3 text-[13px]">
      {items.flatMap((it, i) =>
        i === 0
          ? [<span key={i}>{it}</span>]
          : [<Rule vertical key={`r${i}`} />, <span key={i}>{it}</span>],
      )}
    </div>
  );
}
