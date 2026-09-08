import { Section } from "./Section";
import type { OverviewToday } from "../api";

/** Today's classes (time · course · room · pre-read), what's due today/tomorrow, what changed. */
export function TodayCard({ today }: { today: OverviewToday }) {
  const { classes, dueTodayOrTomorrow, changed } = today;
  const changedEntries = Object.entries(changed ?? {});
  return (
    <Section title="Today">
      <div className="flex flex-col gap-3 text-sm">
        <div>
          <div className="mb-1 text-[11px] font-bold uppercase opacity-70">Classes</div>
          {classes.length === 0 ? (
            <div className="opacity-70">No classes today</div>
          ) : (
            <ul className="flex flex-col gap-1">
              {classes.map((c, i) => (
                <li key={i}>
                  <span className="font-bold">
                    {c.start}–{c.end}
                  </span>{" "}
                  · {c.course}
                  {c.room ? ` · ${c.room}` : ""}
                  {c.prereadPaths.length > 0 && (
                    <span className="opacity-70"> · pre-read: {c.prereadPaths.join(", ")}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="mb-1 text-[11px] font-bold uppercase opacity-70">
            Due today / tomorrow
          </div>
          {dueTodayOrTomorrow.length === 0 ? (
            <div className="opacity-70">Nothing due</div>
          ) : (
            <ul className="flex flex-col gap-1">
              {dueTodayOrTomorrow.map((d, i) => (
                <li key={i}>
                  {d.title} — {d.course} · in {Math.round(d.hoursAway)}h
                  {d.submitted ? " · submitted" : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
        {changedEntries.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase opacity-70">Changed</div>
            <ul className="flex flex-col gap-1">
              {changedEntries.map(([slug, kinds]) => (
                <li key={slug}>
                  {slug}:{" "}
                  {Object.entries(kinds)
                    .map(([kind, n]) => `${n} ${kind}`)
                    .join(", ")}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Section>
  );
}
