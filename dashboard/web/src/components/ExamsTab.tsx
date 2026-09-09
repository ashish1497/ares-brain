import type { TabProps } from "../lib/types";
import type { OverviewExam } from "../api";
import { fmtDate, countdown } from "../lib/format";
import { SectionHeader } from "./SectionHeader";
import { MetaRow } from "./MetaRow";
import { StatePill } from "./StatePill";
import { CopyButton } from "./CopyButton";
import { Card, CardTitle } from "./ui/card";

function ExamCard({ e }: { e: OverviewExam }) {
  // The server encodes an "all courses" exam as courses === ["all"] (see overview.py) — its
  // courseNames mirrors that same sentinel, so a plain `courseNames.length` check would render
  // the literal word "all" instead of the intended "all courses" label.
  const isAllCourses = e.courses.length === 1 && e.courses[0] === "all";
  const scope =
    !isAllCourses && e.courseNames.length > 0 ? e.courseNames.join(", ") : "all courses";
  const multi = e.testprepCommands.length > 1;
  const collapseCommands = e.testprepCommands.length > 3;
  // The scope label already special-cases the ["all"] sentinel (see isAllCourses above); the
  // Brief-me buttons need the same treatment — for an all-courses exam, courseNames is just
  // ["all"], so it must not be interpolated directly into the brief command. testprepCommands
  // carries one entry per real course regardless of scope, so use that as the course-name
  // source once we already know we're in the all-courses case.
  const briefCourseNames = isAllCourses
    ? e.testprepCommands.map((cmd) => cmd.course)
    : e.courseNames;

  const testprepVariant = e.testprepCommands.length === 1 ? "default" : "neutral";
  const commandButtons = e.testprepCommands.map((cmd) => (
    <div key={cmd.course} className="flex items-center gap-2">
      <CopyButton value={cmd.command} label="Practice set" variant={testprepVariant} />
      {multi && (
        <span className="text-[13px] text-[color:var(--color-ink-muted)]">{cmd.course}</span>
      )}
    </div>
  ));

  const collapseBrief = briefCourseNames.length > 3;
  const briefButtons = briefCourseNames.map((courseName) => (
    <CopyButton
      key={courseName}
      value={`/mesa:ares-brain-course-brief "${courseName}"`}
      label={`Brief me — ${courseName}`}
      variant="neutral"
    />
  ));

  return (
    <Card className="gap-0 md:p-6">
      <CardTitle className="mb-4 text-[15px]">{e.name ?? "Exam"}</CardTitle>
      <div className="mb-3">
        <MetaRow items={[fmtDate(e.date), countdown(e.date)]} />
      </div>
      <p className="mb-3 text-[13px] text-[color:var(--color-ink-muted)]">{scope}</p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatePill state={e.brainReady ? "ok" : "bad"}>
          {e.brainReady ? "brain ready" : "brain not ready"}
        </StatePill>
        <StatePill state={e.testprepExists ? "ok" : "neutral"}>
          {e.testprepExists ? "practice set" : "no practice set"}
        </StatePill>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {collapseCommands ? (
          <details className="w-full">
            <summary className="cursor-pointer text-[13px] text-[color:var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge">
              {e.testprepCommands.length} practice sets
            </summary>
            <div className="mt-3 flex flex-wrap items-center gap-3">{commandButtons}</div>
          </details>
        ) : (
          commandButtons
        )}
        {!e.brainReady &&
          (collapseBrief ? (
            <details className="w-full">
              <summary className="cursor-pointer text-[13px] text-[color:var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge">
                {briefCourseNames.length} briefs
              </summary>
              <div className="mt-3 flex flex-wrap items-center gap-3">{briefButtons}</div>
            </details>
          ) : (
            briefButtons
          ))}
      </div>
    </Card>
  );
}

/** Exams — one card per upcoming exam, sorted by date, with practice-set / brief hand-offs. */
export function ExamsTab({ ov }: TabProps) {
  const sorted = [...ov.exams].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  return (
    <div className="space-y-6">
      <SectionHeader info="Scheduled exams, what they cover, and whether you are prepared.">
        Exams
      </SectionHeader>
      {sorted.length === 0 ? (
        <Card className="gap-0 md:p-6">
          <p className="text-[13px] text-[color:var(--color-ink-muted)]">No exams on record.</p>
        </Card>
      ) : (
        sorted.map((e, i) => <ExamCard key={i} e={e} />)
      )}
    </div>
  );
}
