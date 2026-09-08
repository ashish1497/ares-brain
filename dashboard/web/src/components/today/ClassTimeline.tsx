import type { OverviewClass } from "../../api";
import { fmtTime } from "../../lib/format";
import { cn } from "../../lib/utils";
import { MetaRow } from "../MetaRow";
import { SectionHeader } from "../SectionHeader";
import { Card } from "../ui/card";

/** Whether `cls` is currently in progress, still upcoming, or already over, relative to `now`. */
function classState(cls: OverviewClass, now: Date): "now" | "future" | "past" {
  const start = new Date(cls.start).getTime();
  const end = new Date(cls.end).getTime();
  const n = now.getTime();
  if (n >= start && n <= end) return "now";
  return n < start ? "future" : "past";
}

/** Today's class schedule as a vertical rail — a filled dot marks the class happening now. */
export function ClassTimeline({
  classes,
  now = new Date(),
}: {
  classes: OverviewClass[];
  now?: Date;
}) {
  if (classes.length === 0) {
    return (
      <Card className="md:p-6">
        <SectionHeader>Today</SectionHeader>
        <p className="text-[13px] text-[color:var(--color-ink-muted)]">no classes today</p>
      </Card>
    );
  }
  return (
    <Card className="md:p-6">
      <SectionHeader>Today</SectionHeader>
      <ol className="space-y-4 border-l-[3px] border-edge">
        {classes.map((cls, i) => {
          const state = classState(cls, now);
          return (
            <li key={i} className="relative pl-4">
              <span
                data-testid="class-dot"
                data-state={state}
                className={cn(
                  "absolute -left-[7px] top-1 size-3 rounded-full border-[3px] border-edge",
                  state === "now" && "bg-ok",
                  state === "future" && "bg-card",
                  state === "past" && "bg-[color:var(--color-ink-muted)]",
                )}
              />
              <div className="font-bold">
                {fmtTime(cls.start)}–{fmtTime(cls.end)}
              </div>
              <div>{cls.course}</div>
              <MetaRow items={[cls.room, cls.instructor].filter(Boolean)} />
              {cls.prereadPaths.length > 0 && (
                <span
                  title={cls.prereadPaths.join(", ")}
                  className="mt-1 inline-block rounded-nb border-[3px] border-edge bg-accent px-2 py-0.5 text-[11px] font-bold uppercase text-black"
                >
                  pre-read
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
