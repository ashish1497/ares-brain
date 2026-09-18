import { useEffect, useMemo, useState } from "react";
import * as api from "../../api";
import type { DrillCard } from "../../api";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { StatePill } from "../StatePill";
import * as srs from "../../lib/srs";

interface QueueItem extends DrillCard {
  course: string;
  key: string;
}

/**
 * Cross-course spaced-repetition review — the equivalent of the batchmate
 * tool's "Drill 693" button. Pulls every available course's cards, filters to
 * what's actually due (Leitner boxes tracked in localStorage, per browser),
 * and reviews one at a time with a self-graded Again/Good/Easy.
 */
export function DrillMode({ courses, onExit }: { courses: string[]; onExit: () => void }) {
  const [allCards, setAllCards] = useState<QueueItem[] | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [includeNotYetDue, setIncludeNotYetDue] = useState(false);

  useEffect(() => {
    Promise.all(courses.map((slug) => api.getDrill(slug))).then((packs) => {
      const cards: QueueItem[] = [];
      packs.forEach((p, i) => {
        if (!p) return;
        for (const c of p.cards) {
          cards.push({ ...c, course: courses[i], key: srs.cardKey(courses[i], c.id) });
        }
      });
      setAllCards(cards);
    });
  }, [courses]);

  const stats = useMemo(() => {
    if (!allCards) return null;
    return srs.summarize(allCards.map((c) => c.key));
  }, [allCards]);

  useEffect(() => {
    if (!allCards) return;
    const now = Date.now();
    const due = allCards.filter((c) => includeNotYetDue || srs.isDue(c.key, now));
    // Shuffle so repeated sessions don't always see the same course first.
    const shuffled = [...due].sort(() => Math.random() - 0.5);
    setQueue(shuffled);
    setIdx(0);
    setFlipped(false);
  }, [allCards, includeNotYetDue]);

  function gradeCurrent(g: srs.Grade) {
    const card = queue[idx];
    if (!card) return;
    srs.grade(card.key, g);
    setReviewedCount((n) => n + 1);
    setFlipped(false);
    setIdx((i) => i + 1);
  }

  if (allCards === null) {
    return (
      <div className="mx-auto max-w-[700px] px-4 py-10 text-center">
        <p className="text-[13px] text-[color:var(--color-ink-muted)]">Loading cards…</p>
      </div>
    );
  }

  const current = queue[idx];
  const done = idx >= queue.length;

  return (
    <div className="mx-auto max-w-[700px] px-4 pb-10 pt-6">
      <div className="mb-6 flex items-center justify-between">
        <Button type="button" variant="ghost" size="sm" onClick={onExit}>
          ← Exit drill
        </Button>
        {stats && (
          <StatePill state="neutral">
            {stats.due} due · {stats.newCount} new · {stats.total} tracked
          </StatePill>
        )}
      </div>

      {!done && current && (
        <>
          <div className="mb-3 flex items-center justify-between text-[11px] text-[color:var(--color-ink-muted)]">
            <span>
              {idx + 1} / {queue.length}
            </span>
            <span className="uppercase">
              {current.course.replaceAll("-", " ")} · {current.tag}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setFlipped((f) => !f)}
            className="w-full rounded-nb border-[length:var(--nb-border)] border-edge bg-card p-8 text-left shadow-[var(--nb-shadow)]"
          >
            <p className="min-h-[80px] text-[16px] leading-snug">
              {flipped ? current.back : current.front}
            </p>
            <p className="mt-4 text-[11px] uppercase text-[color:var(--color-ink-faint)]">
              {flipped ? "answer" : "tap to reveal answer"}
            </p>
          </button>

          {flipped ? (
            <div className="mt-4 grid grid-cols-3 gap-2">
              <Button type="button" variant="neutral" onClick={() => gradeCurrent("again")}>
                Again
              </Button>
              <Button type="button" variant="neutral" onClick={() => gradeCurrent("good")}>
                Good
              </Button>
              <Button type="button" variant="default" onClick={() => gradeCurrent("easy")}>
                Easy
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="default"
              className="mt-4 w-full"
              onClick={() => setFlipped(true)}
            >
              Show answer
            </Button>
          )}
        </>
      )}

      {done && (
        <Card>
          <p className="mb-2 text-[14px] font-bold">
            {reviewedCount > 0
              ? `Reviewed ${reviewedCount} card${reviewedCount === 1 ? "" : "s"}.`
              : "Nothing due right now."}
          </p>
          <p className="mb-4 text-[13px] text-[color:var(--color-ink-muted)]">
            {includeNotYetDue
              ? "That's every card, due or not."
              : "Cards you've already reviewed come back on their own schedule — sooner if you graded them Again, later if Good/Easy."}
          </p>
          {!includeNotYetDue && (
            <Button type="button" variant="neutral" onClick={() => setIncludeNotYetDue(true)}>
              Review everything anyway
            </Button>
          )}
        </Card>
      )}
    </div>
  );
}
