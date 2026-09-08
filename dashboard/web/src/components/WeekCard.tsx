import { Section } from "./Section";
import { CopyButton } from "./CopyButton";
import { Badge } from "./ui/badge";
import type { OverviewWeekItem } from "../api";

/** Local YYYY-MM-DD for "today" — the cutoff below which week rows are in the past. */
function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "2026-09-08" → "Mon 8 Sep". */
function fmtDay(when: string): string {
  return new Date(when + "T00:00").toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** What's ahead this week, grouped by day: title · course · status badge · copy-action. */
export function WeekCard({ week }: { week: OverviewWeekItem[] }) {
  const cutoff = todayISO();
  const rows = [...week]
    .filter((w) => w.when >= cutoff)
    .sort((a, b) => a.when.localeCompare(b.when));
  const days = [...new Set(rows.map((w) => w.when))];
  return (
    <Section title="This week">
      {rows.length === 0 ? (
        <div className="text-sm opacity-70">Nothing in the next 7 days</div>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          {days.map((day) => (
            <div key={day}>
              <div className="mb-1 text-[11px] font-bold uppercase opacity-70">{fmtDay(day)}</div>
              <ul className="flex flex-col gap-2">
                {rows
                  .filter((w) => w.when === day)
                  .map((w, i) => (
                    <li
                      key={i}
                      data-testid="week-row"
                      className="flex flex-wrap items-center gap-2"
                    >
                      <span>{w.title}</span>
                      {w.course && w.course !== w.title && (
                        <span className="opacity-70">· {w.course}</span>
                      )}
                      {w.weightPct != null && <Badge variant="accent">{w.weightPct}%</Badge>}
                      {w.status && <Badge>{w.status}</Badge>}
                      {w.coverage && <Badge>{w.coverage}</Badge>}
                      {w.action?.type === "copy" && (
                        <CopyButton value={w.action.value} label={w.action.label} />
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
