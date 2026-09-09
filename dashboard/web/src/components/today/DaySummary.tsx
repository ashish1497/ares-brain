import type { Overview } from "../../api";
import { fmtTime } from "../../lib/format";
import { SectionHeader } from "../SectionHeader";

/** Minutes between two ISO datetimes (`end` − `start`). */
function minutesBetween(startIso: string, endIso: string): number {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000;
}

/**
 * Computes today's point-format summary directly from the overview payload. Every point is
 * traceable to real data — no templated narrative, per the "zero LLM calls" constraint. Returns
 * `[]` for "nothing to say", which the caller renders as a single calm line instead of an
 * empty list.
 */
export function computeDaySummaryPoints(ov: Overview): string[] {
  const { classes } = ov.today;
  const points: string[] = [];

  if (classes.length > 0) {
    const sorted = [...classes].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    );
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const totalMins = sorted.reduce((sum, c) => sum + minutesBetween(c.start, c.end), 0);
    const hrs = Math.floor(totalMins / 60);
    const mins = Math.round(totalMins % 60);
    const duration = mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
    points.push(
      `${sorted.length} class${sorted.length === 1 ? "" : "es"} today, ` +
        `${fmtTime(first.start)}–${fmtTime(last.end)} (${duration} in class)`,
    );

    if (sorted.length > 1) {
      const gaps = sorted.slice(1).map((c, i) => {
        const prev = sorted[i];
        return {
          mins: minutesBetween(prev.end, c.start),
          prevCourse: prev.course,
          nextCourse: c.course,
        };
      });
      const longest = gaps.reduce((a, b) => (b.mins > a.mins ? b : a));
      if (longest.mins >= 90) {
        const gapHrs = Math.round(longest.mins / 60);
        points.push(
          `~${gapHrs}h gap between ${longest.prevCourse} and ${longest.nextCourse} — plan the break`,
        );
      } else if (gaps.every((g) => g.mins < 15)) {
        points.push("Back-to-back all day — no real breaks between classes");
      }
    }

    const withPreread = classes.filter((c) => c.prereadPaths.length > 0).length;
    if (withPreread > 0) {
      points.push(
        withPreread === classes.length
          ? "All of today's classes have a pre-read on file — read before class"
          : `${withPreread} of ${classes.length} classes have a pre-read on file — read before class`,
      );
    }
  }

  const due = ov.today.dueTodayOrTomorrow;
  if (due.length === 1) {
    points.push(`${due[0].title} (${due[0].course}) is due`);
  } else if (due.length > 1) {
    points.push(`${due.length} items due today or tomorrow`);
  }

  if (ov.kpis.nextExamInDays != null && ov.kpis.nextExamInDays <= 14) {
    const n = ov.kpis.nextExamInDays;
    points.push(`${ov.kpis.nextExamName ?? "Exam"} in ${n} day${n === 1 ? "" : "s"}`);
  }

  const classSlugsToday = new Set(
    classes.map((c) => c.courseSlug).filter((s): s is string => Boolean(s)),
  );
  for (const a of ov.attendance) {
    if (a.nowPct < ov.attendanceMin && classSlugsToday.has(a.courseSlug)) {
      points.push(
        `${a.course} attendance at ${a.nowPct}% (below ${ov.attendanceMin}%) — ` +
          "today's class matters more",
      );
    }
  }

  return points;
}

/**
 * The top half of the Today card: a point-format summary of what today looks like, computed
 * only from real payload data (see `computeDaySummaryPoints`) — never a decorative narrative.
 */
export function DaySummary({ ov }: { ov: Overview }) {
  const points = computeDaySummaryPoints(ov);
  return (
    <div>
      <SectionHeader rule={false}>Today at a glance</SectionHeader>
      {points.length === 0 ? (
        <p className="text-[13px] text-[color:var(--color-ink-muted)]">
          Nothing on the schedule today, and nothing due.
        </p>
      ) : (
        <ul className="list-inside list-disc space-y-1 text-[13px]">
          {points.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
