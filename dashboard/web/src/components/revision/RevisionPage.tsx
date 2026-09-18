import { useEffect, useState } from "react";
import * as api from "../../api";
import type { Course, DrillPack } from "../../api";
import { Card, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { StatePill } from "../StatePill";
import { cn } from "../../lib/utils";
import { MarkdownLite } from "../today/TodaysBrief";
import { DrillMode } from "./DrillMode";

const SUB_TABS = ["map", "cheatsheet", "frameworks", "cards", "quiz"] as const;
type SubTab = (typeof SUB_TABS)[number];

/** One flippable flashcard — click anywhere on it to toggle front/back. */
function FlashCard({ front, back, tag }: { front: string; back: string; tag: string }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setFlipped((f) => !f)}
      className="w-full rounded-nb border-[length:var(--nb-border)] border-edge bg-card p-4 text-left shadow-[var(--nb-shadow)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase text-[color:var(--color-ink-muted)]">
          {tag}
        </span>
        <span className="text-[10px] uppercase text-[color:var(--color-ink-faint)]">
          {flipped ? "answer — click to flip back" : "click to reveal"}
        </span>
      </div>
      <p className="text-[14px] leading-snug">{flipped ? back : front}</p>
    </button>
  );
}

/** One self-graded MCQ — pick an option, get instant feedback + explanation. */
function QuizItem({
  q,
  onAnswered,
}: {
  q: DrillPack["mcq"][number];
  onAnswered: (correct: boolean) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  function pick(i: number) {
    if (picked != null) return;
    setPicked(i);
    onAnswered(i === q.correct);
  }
  return (
    <Card>
      <p className="mb-3 text-[14px] font-bold leading-snug">{q.question}</p>
      <div className="flex flex-col gap-2">
        {q.options.map((opt, i) => {
          const isPicked = picked === i;
          const isCorrect = i === q.correct;
          const show = picked != null;
          return (
            <button
              key={i}
              type="button"
              onClick={() => pick(i)}
              disabled={picked != null}
              className={cn(
                "rounded-nb border-[length:var(--nb-border)] px-3 py-2 text-left text-[13px] transition-colors",
                !show && "border-edge bg-paper hover:bg-card",
                show && isCorrect && "border-ok bg-ok/20",
                show && isPicked && !isCorrect && "border-bad bg-bad/20",
                show && !isPicked && !isCorrect && "border-edge bg-paper opacity-60",
              )}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {picked != null && (
        <p className="mt-3 text-[12px] text-[color:var(--color-ink-muted)]">{q.explanation}</p>
      )}
    </Card>
  );
}

function CourseTabContent({ pack, sub }: { pack: DrillPack; sub: SubTab }) {
  const [quizScore, setQuizScore] = useState({ correct: 0, answered: 0 });

  if (sub === "map")
    return (
      <Card>
        <MarkdownLite text={pack.map} />
      </Card>
    );

  if (sub === "cheatsheet")
    return (
      <Card>
        <MarkdownLite text={pack.cheatsheet} />
      </Card>
    );

  if (sub === "frameworks")
    return (
      <div className="flex flex-col gap-3">
        {pack.frameworks.length === 0 && (
          <p className="text-[13px] text-[color:var(--color-ink-muted)]">
            No frameworks recorded for this course yet.
          </p>
        )}
        {pack.frameworks.map((f, i) => (
          <Card key={i}>
            <CardTitle className="text-[14px]">{f.name}</CardTitle>
            <p className="mt-1 text-[13px] leading-snug">{f.summary}</p>
            <p className="mt-2 text-[11px] text-[color:var(--color-ink-faint)]">{f.source}</p>
          </Card>
        ))}
      </div>
    );

  if (sub === "cards")
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {pack.cards.length === 0 && (
          <p className="text-[13px] text-[color:var(--color-ink-muted)]">
            No flashcards recorded for this course yet.
          </p>
        )}
        {pack.cards.map((c) => (
          <FlashCard key={c.id} front={c.front} back={c.back} tag={c.tag} />
        ))}
      </div>
    );

  // quiz
  return (
    <div className="flex flex-col gap-3">
      {pack.mcq.length > 0 && (
        <MetaScore
          correct={quizScore.correct}
          answered={quizScore.answered}
          total={pack.mcq.length}
        />
      )}
      {pack.mcq.length === 0 && (
        <p className="text-[13px] text-[color:var(--color-ink-muted)]">
          No quiz questions recorded for this course yet.
        </p>
      )}
      {pack.mcq.map((q) => (
        <QuizItem
          key={q.id}
          q={q}
          onAnswered={(ok) =>
            setQuizScore((s) => ({ correct: s.correct + (ok ? 1 : 0), answered: s.answered + 1 }))
          }
        />
      ))}
    </div>
  );
}

function MetaScore({
  correct,
  answered,
  total,
}: {
  correct: number;
  answered: number;
  total: number;
}) {
  return (
    <div className="flex items-center gap-2 text-[12px] font-bold">
      <StatePill state={answered === total && answered > 0 ? "ok" : "neutral"}>
        {correct}/{answered} correct
      </StatePill>
      <span className="text-[color:var(--color-ink-muted)]">
        {total - answered} question{total - answered === 1 ? "" : "s"} left
      </span>
    </div>
  );
}

/**
 * A genuinely separate page (like the outreach agent) — a self-refreshing
 * clone of the batchmate-built "Term 1 Revision" artifact, generated from
 * this project's own live corpus via `/mesa:ares-brain-course-drill` and kept
 * current automatically on every rescrape.
 */
export function RevisionPage({ go }: { go: (hash: string) => void }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [pack, setPack] = useState<DrillPack | null>(null);
  const [missing, setMissing] = useState(false);
  const [sub, setSub] = useState<SubTab>("map");
  const [drillOpen, setDrillOpen] = useState(false);
  const [availableCourses, setAvailableCourses] = useState<Course[] | null>(null);

  useEffect(() => {
    api.getCourses().then((cs) => {
      setCourses(cs);
      // Probe which courses actually have a revision pack, in parallel, once.
      Promise.all(cs.map((c) => api.getDrill(c.slug).then((p) => (p ? c : null)))).then((res) => {
        const avail = res.filter((c): c is Course => c != null);
        setAvailableCourses(avail);
        if (avail.length > 0 && !selected) setSelected(avail[0].slug);
      });
    });
  }, []);

  useEffect(() => {
    if (!selected) return;
    setPack(null);
    setMissing(false);
    api.getDrill(selected).then((p) => {
      if (p) setPack(p);
      else setMissing(true);
    });
  }, [selected]);

  if (drillOpen && availableCourses) {
    return (
      <DrillMode courses={availableCourses.map((c) => c.slug)} onExit={() => setDrillOpen(false)} />
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-8 pt-6 md:px-8">
      <Button type="button" variant="ghost" size="sm" onClick={() => go("today")} className="mb-4">
        ← Back to dashboard
      </Button>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold">Revision</h1>
          <p className="text-[12px] text-[color:var(--color-ink-muted)]">
            Generated from this project&apos;s own live corpus — refreshes automatically after every
            rescrape.{" "}
            <a
              href="https://claude.ai/code/artifact/5056384c-7b3d-4e4a-b74e-5c1871894cb5"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Also see the original (richer, but frozen) batchmate tool ↗
            </a>
          </p>
        </div>
        <Button
          type="button"
          variant="default"
          onClick={() => setDrillOpen(true)}
          disabled={!availableCourses || availableCourses.length === 0}
        >
          ⚡ Drill (all courses)
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {courses.length === 0 && (
          <p className="text-[13px] text-[color:var(--color-ink-muted)]">Loading courses…</p>
        )}
        {availableCourses?.length === 0 && (
          <p className="text-[13px] text-[color:var(--color-ink-muted)]">
            No revision packs built yet — run{" "}
            <code className="font-mono">/mesa:ares-brain-course-drill</code> for a course to
            generate one.
          </p>
        )}
        {(availableCourses ?? courses).map((c) => (
          <button
            key={c.slug}
            type="button"
            onClick={() => setSelected(c.slug)}
            className={cn(
              "rounded-nb border-[length:var(--nb-border)] px-3 py-1.5 text-[12px] font-bold transition-colors",
              selected === c.slug
                ? "border-edge bg-cta text-black"
                : "border-edge bg-card hover:bg-paper",
            )}
          >
            {c.name}
          </button>
        ))}
      </div>

      {missing && (
        <Card>
          <p className="text-[13px]">
            No revision pack for this course yet. Run{" "}
            <code className="font-mono">/mesa:ares-brain-course-drill {selected}</code> to build
            one.
          </p>
        </Card>
      )}

      {pack && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <StatePill state="neutral">{pack.examWeight}</StatePill>
            <span className="text-[11px] text-[color:var(--color-ink-faint)]">
              built {new Date(pack.generatedAt).toLocaleDateString()}
            </span>
          </div>
          <div className="mb-4 flex gap-1 border-b-[length:var(--nb-border)] border-edge pb-2">
            {SUB_TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSub(t)}
                className={cn(
                  "rounded-nb px-3 py-1 text-[12px] font-bold capitalize",
                  sub === t ? "bg-cta text-black" : "hover:bg-card",
                )}
              >
                {t}
                {t === "cards" && ` (${pack.cards.length})`}
                {t === "quiz" && ` (${pack.mcq.length})`}
              </button>
            ))}
          </div>
          <CourseTabContent pack={pack} sub={sub} />
        </>
      )}
    </div>
  );
}
