import type { ReactNode } from "react";

/**
 * Neubrutalist card wrapper (spec §5): 3px edge border, `4px 4px 0` offset shadow,
 * 2px radius, flat palette-B card fill. Uppercase section heading, optional right slot.
 */
export function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-4 rounded-[var(--radius-nb)] border-[length:var(--nb-border)] border-[var(--color-edge)] bg-[var(--color-card)] p-4 shadow-[var(--nb-shadow)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}
