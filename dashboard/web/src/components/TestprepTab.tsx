import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import * as api from "../api";
import type { Course, Job, StudyItem } from "../api";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { SectionHeader } from "./SectionHeader";
import { JobLog } from "./JobLog";
import { cn } from "../lib/utils";

type Grade = "correct" | "incorrect";
type ScoreMap = Record<number, Grade>;

/** Scores live only in this browser's localStorage, keyed by course+set name
 * — never sent to the server and never written into the testprep .md file
 * itself, since that file is the one `share-study` can upload to Drive. */
function scoreKey(course: string, name: string) {
  return `mesa-testprep-scores:${course}:${name}`;
}

function loadScores(course: string, name: string): ScoreMap {
  try {
    const raw = localStorage.getItem(scoreKey(course, name));
    return raw ? (JSON.parse(raw) as ScoreMap) : {};
  } catch {
    return {};
  }
}

function saveScores(course: string, name: string, scores: ScoreMap) {
  try {
    localStorage.setItem(scoreKey(course, name), JSON.stringify(scores));
  } catch {
    // best-effort — a private window or full quota just means scores don't persist
  }
}

interface QuestionBlock {
  index: number;
  html: string;
}

/** Splits the generated markdown on each `**Qn ...**` marker so every
 * question can carry its own grading controls; everything before the first
 * marker (title / scope note) renders once, ungraded. */
function splitQuestions(md: string): { intro: string; questions: QuestionBlock[] } {
  const marker = /^\*\*Q\d+\b/m;
  const firstMatch = md.search(marker);
  if (firstMatch === -1) return { intro: md, questions: [] };
  const intro = md.slice(0, firstMatch);
  const rest = md.slice(firstMatch);
  const parts = rest.split(/(?=^\*\*Q\d+\b)/m).filter((p) => p.trim());
  const questions = parts.map((part, i) => ({
    index: i,
    html: marked.parse(part, { async: false }) as string,
  }));
  return { intro, questions };
}

function GradeButtons({
  grade,
  onGrade,
}: {
  grade: Grade | undefined;
  onGrade: (g: Grade | undefined) => void;
}) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant={grade === "correct" ? "default" : "neutral"}
        onClick={() => onGrade(grade === "correct" ? undefined : "correct")}
      >
        Got it
      </Button>
      <Button
        type="button"
        size="sm"
        variant={grade === "incorrect" ? "default" : "neutral"}
        onClick={() => onGrade(grade === "incorrect" ? undefined : "incorrect")}
      >
        Missed it
      </Button>
    </div>
  );
}

function Reader({ course, name, onBack }: { course: string; name: string; onBack: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [scores, setScores] = useState<ScoreMap>({});

  useEffect(() => {
    setContent(null);
    setError("");
    setScores(loadScores(course, name));
    api.getStudyContent(course, name).then(
      (r) =>
        r.ok && r.content != null ? setContent(r.content) : setError(r.error ?? "failed to load"),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [course, name]);

  const parsed = useMemo(() => (content != null ? splitQuestions(content) : null), [content]);

  const grade = (i: number, g: Grade | undefined) => {
    setScores((prev) => {
      const next = { ...prev };
      if (g) next[i] = g;
      else delete next[i];
      saveScores(course, name, next);
      return next;
    });
  };

  const resetScores = () => {
    setScores({});
    saveScores(course, name, {});
  };

  const attempted = Object.keys(scores).length;
  const correct = Object.values(scores).filter((g) => g === "correct").length;

  return (
    <Card className="md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Button type="button" variant="neutral" size="sm" onClick={onBack}>
          ← Back
        </Button>
        {parsed && parsed.questions.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-bold">
              {correct}/{attempted} correct
              {attempted < parsed.questions.length ? ` (${parsed.questions.length} total)` : ""}
            </span>
            <Button type="button" variant="neutral" size="sm" onClick={resetScores}>
              Reset scores
            </Button>
          </div>
        )}
      </div>
      {error && <p className="text-[13px] text-[color:var(--color-bad)]">{error}</p>}
      {!error && !parsed && (
        <p className="text-[13px] text-[color:var(--color-ink-muted)]">Loading…</p>
      )}
      {parsed && (
        <div className="space-y-6">
          {parsed.intro.trim() && (
            <div
              className="prose-nb"
              dangerouslySetInnerHTML={{
                __html: marked.parse(parsed.intro, { async: false }) as string,
              }}
            />
          )}
          {parsed.questions.map((q) => (
            <div
              key={q.index}
              className={cn(
                "rounded-nb border-[3px] border-edge p-3",
                scores[q.index] === "correct" && "bg-ok/10",
                scores[q.index] === "incorrect" && "bg-bad/10",
              )}
            >
              <div className="prose-nb" dangerouslySetInnerHTML={{ __html: q.html }} />
              <GradeButtons grade={scores[q.index]} onGrade={(g) => grade(q.index, g)} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function TestprepTab() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selected, setSelected] = useState("");
  const [items, setItems] = useState<StudyItem[]>([]);
  const [opening, setOpening] = useState<string | null>(null);
  const [genJob, setGenJob] = useState<Job | null>(null);
  const [genLines, setGenLines] = useState<string[]>([]);
  const [genError, setGenError] = useState("");

  useEffect(() => {
    api.getCourses().then((cs) => {
      setCourses(cs);
      if (cs[0]) setSelected(cs[0].slug);
    });
  }, []);

  const refreshItems = (course: string) => api.getStudy(course).then((r) => setItems(r.items));

  useEffect(() => {
    if (!selected) return;
    setItems([]);
    setOpening(null);
    refreshItems(selected);
  }, [selected]);

  const [genKind, setGenKind] = useState<"testprep" | "mock-midterm" | null>(null);
  const generating = genJob?.status === "running";

  const generate = async (kind: "testprep" | "mock-midterm") => {
    const course = courses.find((c) => c.slug === selected);
    if (!course) return;
    setGenError("");
    setGenKind(kind);
    const command =
      kind === "testprep" ? "/mesa:ares-brain-testprep" : "/mesa:ares-brain-mock-midterm";
    const { jobId, error: startError } = await api.startJob({
      kind: "chat",
      message: `${command} ${course.name}`,
    });
    if (startError || !jobId) {
      setGenError(
        startError === "busy"
          ? "ares-brain is busy with another job right now — try again in a moment."
          : startError || "couldn't start — try again.",
      );
      return;
    }
    setGenLines([]);
    setGenJob({
      id: jobId,
      kind: "chat",
      status: "running",
      startedAt: new Date().toISOString(),
      log: [],
    });
    api.streamLog(
      jobId,
      (l) => setGenLines((prev) => [...prev, l]),
      (exitCode) => {
        setGenJob((j) => (j ? { ...j, status: exitCode === 0 ? "done" : "failed" } : j));
        if (exitCode === 0) refreshItems(selected);
      },
    );
  };

  if (courses.length === 0) {
    return (
      <Card className="md:p-6">
        <p className="text-[13px] text-[color:var(--color-ink-muted)]">
          No courses yet — sync first.
        </p>
      </Card>
    );
  }

  if (opening) {
    return <Reader course={selected} name={opening} onBack={() => setOpening(null)} />;
  }

  return (
    <div className="space-y-6">
      <Card className="md:p-6">
        <SectionHeader
          rule={false}
          info="Testprep is a generic Recall/Application/Mini-case mix from the course material. Mock midterm matches the real declared exam format (marks, timing, question types) from config/midterm-exam-format.md — it only works for courses with an actual written mid-term; others get a plain explanation instead of a paper. Read the questions here and grade yourself — scores stay in this browser only, never written into the shared markdown file."
        >
          Testprep
        </SectionHeader>
        <select
          className="mb-2 w-full rounded-nb border-[3px] border-edge bg-card px-3 py-2"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          {courses.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => generate("testprep")}
            disabled={generating}
          >
            {generating && genKind === "testprep" ? "Generating…" : "Testprep"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="neutral"
            onClick={() => generate("mock-midterm")}
            disabled={generating}
          >
            {generating && genKind === "mock-midterm" ? "Generating…" : "Mock midterm"}
          </Button>
        </div>
        {genError && (
          <div className="mb-4 rounded-nb border-[3px] border-edge bg-bad p-3 text-sm font-bold text-black">
            {genError}
          </div>
        )}
        {(genJob || genLines.length > 0) && (
          <div className="mb-4">
            <JobLog job={genJob} lines={genLines} />
          </div>
        )}
        {items.length === 0 ? (
          <p className="text-[13px] text-[color:var(--color-ink-muted)]">
            No sets yet — click "Testprep" or "Mock midterm" above, or run /mesa:ares-brain-testprep
            / /mesa:ares-brain-mock-midterm yourself.
          </p>
        ) : (
          <ul className="divide-y divide-[color:var(--color-rule)]">
            {items.map((it) => (
              <li key={it.name} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <div className="text-[13px] font-bold">{it.name}</div>
                  {it.generatedAt && (
                    <div className="text-[12px] text-[color:var(--color-ink-muted)]">
                      {new Date(it.generatedAt).toLocaleString()}
                    </div>
                  )}
                </div>
                <Button type="button" size="sm" onClick={() => setOpening(it.name)}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
