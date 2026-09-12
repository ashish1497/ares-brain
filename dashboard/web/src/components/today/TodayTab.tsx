import type { TabProps } from "../../lib/types";
import { fmtDate } from "../../lib/format";
import { Card } from "../ui/card";
import { ChangedFeed } from "./ChangedFeed";
import { ClassTimeline } from "./ClassTimeline";
import { DueNow } from "./DueNow";
import { TodaysBrief } from "./TodaysBrief";

/** Calm empty state: shown only when classes, due-soon items, and changes are all empty. */
function EmptyToday({ ov }: { ov: TabProps["ov"] }) {
  const nextClass = ov.thisWeek.find((w) => w.kind === "class" && w.when > ov.date);
  return (
    <Card className="gap-0 md:p-6">
      <p className="font-bold">Nothing needs you today.</p>
      {nextClass && (
        <p className="mt-2 text-[13px] text-[color:var(--color-ink-muted)]">
          Next class: {nextClass.course ?? nextClass.title} — {fmtDate(nextClass.when)}
        </p>
      )}
    </Card>
  );
}

/** Both-empty calm panel for the right column: shown when there's nothing due and
 * nothing changed, so classes-present days don't render a lopsided grid with dead space. */
function CalmRightColumn() {
  return (
    <Card className="gap-0 md:p-6">
      <p className="text-[13px] text-[color:var(--color-ink-muted)]">
        Nothing due, nothing changed since the last sync.
      </p>
    </Card>
  );
}

/** Today — the landing/eagle view: class timeline, due-now, and the since-last-scrape feed. */
export function TodayTab({ ov, go }: TabProps) {
  const { classes, dueTodayOrTomorrow, changed } = ov.today;
  const allEmpty = classes.length === 0 && dueTodayOrTomorrow.length === 0 && changed.length === 0;
  if (allEmpty)
    return (
      <>
        <TodaysBrief />
        <EmptyToday ov={ov} />
      </>
    );
  const rightEmpty = dueTodayOrTomorrow.length === 0 && changed.length === 0;
  return (
    <>
      <TodaysBrief />
      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <ClassTimeline ov={ov} />
        <div className="space-y-6">
          {rightEmpty ? (
            <CalmRightColumn />
          ) : (
            <>
              <DueNow items={dueTodayOrTomorrow} assignments={ov.assignments} go={go} />
              <ChangedFeed changed={changed} scrapeAgeHours={ov.scrapeAgeHours} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
