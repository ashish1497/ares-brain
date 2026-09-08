import type { OverviewAssignment, OverviewDueSoon } from "../../api";
import { relTime } from "../../lib/format";
import { cn } from "../../lib/utils";
import { SectionHeader } from "../SectionHeader";
import { StatePill } from "../StatePill";
import { Button } from "../ui/button";
import { Card } from "../ui/card";

/** Assignments due today or tomorrow — submitted rows sink to the bottom, struck through. */
export function DueNow({
  items,
  assignments,
  go,
}: {
  items: OverviewDueSoon[];
  assignments: OverviewAssignment[];
  go: (hash: string) => void;
}) {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => Number(a.submitted) - Number(b.submitted));
  return (
    <Card className="md:p-6">
      <SectionHeader>Due now</SectionHeader>
      <div className="divide-y divide-[color:var(--color-rule)]">
        {sorted.map((item, i) => {
          const matched =
            item.id != null ? assignments.find((a) => a.id != null && a.id === item.id) : undefined;
          const onOpen = () => {
            if (matched && matched.courseSlug)
              go(`assignments/${matched.courseSlug}/${matched.id}`);
            else go("assignments");
          };
          return (
            <div
              key={i}
              className={cn(
                "flex items-center justify-between gap-3 py-3",
                item.submitted && "opacity-60",
              )}
            >
              <div className={cn(item.submitted && "line-through")}>
                <div className="font-medium">{item.title}</div>
                <div className="text-[13px] text-[color:var(--color-ink-muted)]">{item.course}</div>
              </div>
              <div className="flex items-center gap-3">
                {item.submitted ? (
                  <StatePill state="ok">✓ submitted</StatePill>
                ) : item.hoursAway < 0 ? (
                  <StatePill state="bad">overdue</StatePill>
                ) : item.hoursAway < 6 ? (
                  <StatePill state="soon">soon</StatePill>
                ) : (
                  <span className="text-[13px] text-[color:var(--color-ink-muted)]">
                    {relTime(item.dueAt)}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onOpen}
                  className="text-[color:var(--color-accent)]"
                >
                  Open →
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
