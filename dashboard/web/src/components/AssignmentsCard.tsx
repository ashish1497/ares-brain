import { Section } from "./Section";
import { CopyButton } from "./CopyButton";
import { RiskBadge } from "./RiskBadge";
import type { OverviewAssignment, OverviewGradePicture } from "../api";

function rel(hoursAway: number | null): string {
  if (hoursAway == null) return "no due date";
  if (hoursAway < 0) return "overdue";
  if (hoursAway < 48) return `due in ${Math.round(hoursAway)}h`;
  return `due in ${Math.round(hoursAway / 24)}d`;
}

/**
 * Every not-submitted assignment, already risk-desc from the API. Each row carries a
 * copy of its `helpCommand`. Below: the per-course grade-picture one-liners.
 */
export function AssignmentsCard({
  assignments,
  grade,
}: {
  assignments: OverviewAssignment[];
  grade: OverviewGradePicture[];
}) {
  return (
    <Section title="Assignments — by grade risk">
      {assignments.length === 0 ? (
        <div className="text-sm opacity-70">Nothing outstanding</div>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {assignments.map((a) => (
            <li
              key={a.id}
              data-testid="assignment-row"
              className="flex flex-wrap items-center gap-2"
            >
              <RiskBadge risk={a.risk} />
              <span className="font-bold">{a.title}</span>
              <span className="opacity-70">{a.course}</span>
              <span className="opacity-70">
                {a.weightPct != null ? `${a.weightPct}%` : "ungraded"} · {rel(a.hoursAway)} ·{" "}
                {a.status}
              </span>
              <CopyButton value={a.helpCommand} label="Start" />
            </li>
          ))}
        </ul>
      )}
      {grade.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 border-t-[length:var(--nb-border)] border-[var(--color-edge)] pt-2 text-xs opacity-80">
          {grade.map((g) => (
            <li key={g.courseSlug}>
              <span className="font-bold">{g.course}:</span> {g.summary}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
