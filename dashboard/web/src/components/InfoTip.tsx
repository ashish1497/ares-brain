import { useId, useState, type ReactNode } from "react";
import { cn } from "../lib/utils";

/**
 * An accessible "what does this mean" tooltip: an `ⓘ` button trigger that opens a
 * neubrutalist panel below it on hover, focus, or click/tap — never hover-only.
 * `label` is the trigger's accessible name; `children` is the explanation.
 */
export function InfoTip({
  label,
  children,
  className,
  align = "left",
}: {
  label: string;
  children: ReactNode;
  className?: string;
  /** Which side of the trigger the panel is anchored to. Use "right" for the rightmost
   * column of a table so a definite-width panel doesn't overflow the scroll container. */
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        className="text-[color:var(--color-ink-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        ⓘ
      </button>
      {open && (
        <span
          role="tooltip"
          id={id}
          className={cn(
            "absolute top-full z-30 mt-1 w-[260px] max-w-[280px] rounded-nb border-[3px] border-edge bg-card p-3 text-[13px] text-[color:var(--color-ink)] shadow-[var(--nb-shadow)]",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {children}
        </span>
      )}
    </span>
  );
}
