import type { ComponentChildren } from "preact";

export function Card({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: ComponentChildren;
}) {
  return (
    <div class="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-5">
      <div class="mb-1 flex items-center gap-2 text-sm font-medium">
        <i class={`ti ti-${icon}`} aria-hidden="true" /> {title}
      </div>
      {children}
    </div>
  );
}
