import { Section } from "./Section";
import { CopyButton } from "./CopyButton";
import { Badge } from "./ui/badge";
import type { OverviewExam } from "../api";

function countdown(inDays: number): string {
  if (inDays <= 0) return "today";
  if (inDays === 1) return "tomorrow";
  return `in ${inDays}d`;
}

/** Upcoming exams: name, date + countdown, coverage, brain/practice-set state, copy-command. */
export function ExamsCard({ exams }: { exams: OverviewExam[] }) {
  return (
    <Section title="Exam prep">
      {exams.length === 0 ? (
        <div className="text-sm opacity-70">No exams on record</div>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {exams.map((e, i) => (
            <li key={i} data-testid="exam-row" className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{e.name}</span>
              <span className="opacity-70">
                {e.date} · {countdown(e.inDays)}
              </span>
              {e.coverageSessions && <span className="opacity-70">· {e.coverageSessions}</span>}
              {(e.courseNames ?? e.courses).length > 0 && (
                <span className="opacity-70">· {(e.courseNames ?? e.courses).join(", ")}</span>
              )}
              <Badge variant={e.brainReady ? "ok" : "bad"}>
                {e.brainReady ? "brain ready" : "brain not ready"}
              </Badge>
              <Badge variant={e.testprepExists ? "ok" : "soon"}>
                {e.testprepExists ? "practice set" : "no practice set"}
              </Badge>
              <CopyButton value={e.testprepCommand} label="Practice set" />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
