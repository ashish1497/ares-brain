import type { Overview } from "../../api";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { SectionHeader } from "../SectionHeader";
import { StatePill } from "../StatePill";
import { CopyButton } from "../CopyButton";
import { AssignmentChecklist } from "./AssignmentChecklist";
import { countdown, fmtDate, fmtTime } from "../../lib/format";
import { cn } from "../../lib/utils";

/** The deepest view in the app: everything known about one assignment, reached by clicking a list row. */
export function AssignmentPage({
  ov,
  slug,
  id,
  go,
}: {
  ov: Overview;
  slug: string;
  id: string;
  go: (hash: string) => void;
}) {
  const a = ov.assignments.find((x) => x.courseSlug === slug && x.id === id);

  if (!a) {
    return (
      <Card className="gap-0 md:p-6">
        <p className="mb-3">Assignment not found.</p>
        <Button type="button" variant="neutral" size="sm" onClick={() => go("assignments")}>
          ← all assignments
        </Button>
      </Card>
    );
  }

  const isUrgent = a.dueAt != null && a.hoursAway != null && a.hoursAway <= 24;

  return (
    <div className="space-y-6">
      <Button type="button" variant="ghost" size="sm" onClick={() => go("assignments")}>
        ← all assignments
      </Button>

      <div>
        <h1 className="text-2xl font-bold">{a.title}</h1>
        <p className="text-[13px] text-[color:var(--color-ink-muted)]">{a.course}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <StatePill state="neutral">
            {a.weightPct != null ? `${a.weightPct}%` : "ungraded"}
          </StatePill>
          <StatePill state="neutral">{a.isGroup ? "group" : "solo"}</StatePill>
          <StatePill state="neutral">{a.submissionType}</StatePill>
          <StatePill state="neutral">{a.status}</StatePill>
        </div>
      </div>

      <Card className="gap-0 md:p-6">
        <SectionHeader rule={false}>Deadline</SectionHeader>
        {a.dueAt == null ? (
          <p>No due date set.</p>
        ) : (
          <>
            <div className="space-y-2">
              <p>
                due {fmtDate(a.dueAt)} {fmtTime(a.dueAt)}
              </p>
              {a.cutoffAt != null && (
                <p>
                  hard cutoff {fmtDate(a.cutoffAt)} {fmtTime(a.cutoffAt)}
                </p>
              )}
              <p>{a.allowLate ? "late allowed" : "no late submissions"}</p>
            </div>
            <p className={cn("mt-2 text-2xl font-bold", isUrgent && "text-bad")}>
              {countdown(a.dueAt)}
            </p>
          </>
        )}
      </Card>

      <Card className="gap-0 md:p-6">
        <SectionHeader rule={false}>What&apos;s being asked</SectionHeader>
        {a.instructionsText ? (
          a.instructionsText.split(/\r?\n\s*\r?\n/).map((p, i) => (
            <p key={i} className="mb-3 whitespace-pre-line last:mb-0">
              {p}
            </p>
          ))
        ) : (
          <p className="text-[13px] text-[color:var(--color-ink-muted)]">
            No instructions were scraped — check the LMS.
          </p>
        )}
      </Card>

      {a.materials.length > 0 && (
        <Card className="gap-0 md:p-6">
          <SectionHeader rule={false}>Attached materials</SectionHeader>
          <ul className="divide-y divide-[color:var(--color-rule)]">
            {a.materials.map((m, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-3">
                <span>{m.title}</span>
                <StatePill state="neutral">{m.kind}</StatePill>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] text-[color:var(--color-ink-muted)]">
            Download these from the LMS Resources tab.
          </p>
        </Card>
      )}

      {a.sessionRef != null && (
        <Card className="gap-0 md:p-6">
          <SectionHeader rule={false}>Maps to</SectionHeader>
          <p className="mb-2">Session {a.sessionRef}</p>
          {a.prereadPaths.length > 0 && (
            <ul className="mb-3 list-inside list-disc text-[13px]">
              {a.prereadPaths.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
          <CopyButton
            value={`/mesa:ares-brain-course-brief "${a.course}"`}
            label="Brief this session"
            variant="neutral"
          />
        </Card>
      )}

      <Card className="gap-0 md:p-6">
        <SectionHeader rule={false}>Start in Claude</SectionHeader>
        <CopyButton value={a.helpCommand} label="Start in Claude" size="lg" />
        <p className="mt-2 text-[13px] text-[color:var(--color-ink-muted)]">paste in Claude Code</p>
      </Card>

      <Card className="gap-0 md:p-6">
        <AssignmentChecklist key={id} id={id} />
      </Card>
    </div>
  );
}
