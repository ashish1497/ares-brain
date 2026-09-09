import { useState } from "react";
import type { Overview, OverviewClass } from "../../api";
import { fmtTime } from "../../lib/format";
import { cn } from "../../lib/utils";
import { MetaRow } from "../MetaRow";
import { Rule } from "../Rule";
import { SectionHeader } from "../SectionHeader";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { DaySummary } from "./DaySummary";
import { MindsetModal } from "./MindsetModal";

/** Whether `cls` is currently in progress, still upcoming, or already over, relative to `now`. */
function classState(cls: OverviewClass, now: Date): "now" | "future" | "past" {
  const start = new Date(cls.start).getTime();
  const end = new Date(cls.end).getTime();
  const n = now.getTime();
  if (n >= start && n <= end) return "now";
  return n < start ? "future" : "past";
}

/**
 * The Today tab's left card: a point-format day summary (`DaySummary`), a divider, then
 * today's class schedule as a vertical rail — a filled dot marks the class happening now. Each
 * row carries a "Mindset" button that opens the per-class `MindsetModal`.
 */
export function ClassTimeline({ ov, now = new Date() }: { ov: Overview; now?: Date }) {
  const classes = ov.today.classes;
  const [mindsetIndex, setMindsetIndex] = useState<number | null>(null);

  return (
    <Card className="gap-0 md:p-6">
      <DaySummary ov={ov} />

      <Rule className="my-6" />

      <SectionHeader info="Every class you have today, in order, with the room and instructor.">
        Today
      </SectionHeader>
      {classes.length === 0 ? (
        <p className="text-[13px] text-[color:var(--color-ink-muted)]">no classes today</p>
      ) : (
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
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold">
                      {fmtTime(cls.start)}–{fmtTime(cls.end)}
                    </div>
                    <div>{cls.course}</div>
                    <MetaRow items={[cls.room, cls.instructor].filter(Boolean)} />
                    {cls.prereadPaths.length > 0 && (
                      <span
                        title={cls.prereadPaths.join(", ")}
                        className="mt-1 inline-block rounded-nb border-[3px] border-edge bg-card px-2 py-0.5 text-[11px] font-bold uppercase text-[color:var(--color-accent)]"
                      >
                        pre-read
                      </span>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="neutral"
                    size="sm"
                    onClick={() => setMindsetIndex(i)}
                  >
                    Mindset
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {mindsetIndex !== null && (
        <MindsetModal cls={classes[mindsetIndex]} ov={ov} onClose={() => setMindsetIndex(null)} />
      )}
    </Card>
  );
}
