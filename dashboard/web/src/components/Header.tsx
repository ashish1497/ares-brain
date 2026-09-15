import { useEffect } from "react";
import type { ReactNode } from "react";
import { Button } from "./ui/button";
import { MetaRow } from "./MetaRow";
import { fmtDate, relTime } from "../lib/format";
import { cn } from "../lib/utils";
import type { Overview } from "../api";

function Chip({ label, value, soon }: { label: string; value: ReactNode; soon?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-nb border-[3px] border-edge px-2 py-0.5 text-[12px] font-bold",
        soon ? "bg-soon text-black" : "bg-card text-inherit",
      )}
    >
      <span>{value}</span>
      <span
        className={cn(
          "text-[11px] font-normal uppercase",
          !soon && "text-[color:var(--color-ink-muted)]",
        )}
      >
        {label}
      </span>
    </div>
  );
}

/** Sticky summary bar: wordmark + date/term, stat chips, updated time, Re-sync, Settings gear. */
export function Header({
  ov,
  busy,
  onResync,
  onRefresh,
  onOpenSettings,
  onOutreach = () => {},
}: {
  ov: Overview;
  busy: boolean;
  onResync: () => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onOutreach?: () => void;
}) {
  const { kpis } = ov;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "r" || e.metaKey || e.ctrlKey || e.altKey || busy) return;
      const active = document.activeElement;
      const tag = active?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      onResync();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onResync]);

  return (
    <header className="sticky top-0 z-20 border-b-[3px] border-edge bg-paper">
      {/* overflow-x-auto contains any overflow to this bar — without it, content
          wider than the viewport (all the buttons + chips) pushed the whole
          <body> wider and caused page-level horizontal scroll on mobile,
          same class of bug the Tabs nav below already guards against. */}
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 overflow-x-auto px-4 md:px-8">
        <span className="rounded-nb border-[3px] border-edge bg-cta px-2 py-0.5 text-[12px] font-bold text-black">
          ARES BRAIN
        </span>
        <MetaRow items={[fmtDate(ov.date), ov.term]} />
        <div className="ml-2 hidden items-center gap-3 md:flex">
          <Chip label="due" value={kpis.dueThisWeek} soon={kpis.dueThisWeek >= 3} />
          <Chip
            label="att"
            value={`${Math.round(kpis.attendanceNow)}→${Math.round(kpis.attendanceBestCase)}%`}
            soon={kpis.attendanceNow < ov.attendanceMin}
          />
          <Chip
            label="exam"
            value={kpis.nextExamInDays == null ? "—" : `${kpis.nextExamInDays}d`}
            soon={kpis.nextExamInDays != null && kpis.nextExamInDays <= 7}
          />
          <Chip
            label="brain"
            value={`${kpis.brainReady}/${kpis.courseCount}`}
            soon={kpis.brainReady < ov.chatUnlockAt}
          />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-[12px] text-[color:var(--color-ink-muted)] sm:inline">
            digest · {relTime(ov.generatedAt)}
          </span>
          <Button
            type="button"
            variant="neutral"
            size="icon"
            onClick={onRefresh}
            aria-label="Refresh digest"
          >
            ⟳
          </Button>
          <Button type="button" variant="default" disabled={busy} onClick={onResync}>
            {busy ? "syncing…" : "⟲ Re-sync"}
          </Button>
          <Button type="button" variant="neutral" size="sm" onClick={onOutreach}>
            Outreach agent
          </Button>
          <Button
            type="button"
            variant="neutral"
            size="icon"
            onClick={onOpenSettings}
            aria-label="Settings"
          >
            ⚙
          </Button>
        </div>
      </div>
    </header>
  );
}
