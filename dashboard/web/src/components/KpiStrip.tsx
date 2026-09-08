import { cn } from "../lib/utils";
import type { OverviewKpis } from "../api";

function Tile({
  label,
  value,
  sub,
  amber,
}: {
  label: string;
  value: string;
  sub?: string;
  amber?: boolean;
}) {
  return (
    <div
      data-testid="kpi-tile"
      className={cn(
        "rounded-[var(--radius-nb)] border-[length:var(--nb-border)] border-[var(--color-edge)] bg-[var(--color-card)] p-2 shadow-[var(--nb-shadow)]",
        amber && "bg-soon",
      )}
    >
      <div className="text-[11px] font-bold uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-[24px] font-medium leading-tight">{value}</div>
      {sub && <div className="truncate text-[11px] opacity-70">{sub}</div>}
    </div>
  );
}

/**
 * Five stat tiles (spec §6.2). Amber fill when a KPI is in a warning band:
 * ≥3 due this week, next exam ≤7 days out, attendance below the assumed minimum.
 */
export function KpiStrip({ k, min }: { k: OverviewKpis; min: number }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
      <Tile label="Due this week" value={String(k.dueThisWeek)} amber={k.dueThisWeek >= 3} />
      <Tile
        label="Next exam"
        value={k.nextExamInDays != null ? `${k.nextExamInDays}d` : "—"}
        sub={k.nextExamName ?? undefined}
        amber={k.nextExamInDays != null && k.nextExamInDays <= 7}
      />
      <Tile label="CP avg" value={k.cpAvg != null ? k.cpAvg.toFixed(1) : "—"} />
      <Tile
        label="Attendance"
        value={`${k.attendanceNow}→${k.attendanceBestCase}%`}
        amber={k.attendanceNow < min}
      />
      <Tile label="Brain ready" value={`${k.brainReady}/${k.courseCount}`} />
    </div>
  );
}
