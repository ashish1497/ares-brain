import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export type ProgressProps = ComponentProps<"div"> & { value?: number };

/** Neobrutalism progress bar: 3px edge border, hard-filled track, no radius flourish. */
export function Progress({ className, value = 0, ...props }: ProgressProps) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "h-4 w-full overflow-hidden rounded-nb border-[3px] border-edge bg-card",
        className,
      )}
      {...props}
    >
      <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}
