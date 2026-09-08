import { cn } from "../lib/utils";

/** A 1px hairline divider — the middot replacement. `vertical` for inline metadata groups. */
export function Rule({ vertical, className }: { vertical?: boolean; className?: string }) {
  return (
    <div
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      className={cn(
        vertical ? "w-px self-stretch" : "h-px w-full",
        "bg-[color:var(--color-rule)]",
        className,
      )}
    />
  );
}
