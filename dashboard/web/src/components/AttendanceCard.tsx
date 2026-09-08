import { Section } from "./Section";
import { RiskBadge } from "./RiskBadge";
import type { OverviewAttendance } from "../api";

const toState = (s: OverviewAttendance["state"]): "ok" | "soon" | "bad" =>
  s === "ok" ? "ok" : s === "watch" ? "soon" : "bad";

/**
 * Attendance runway per course. Rows that are `atRisk` (state !== "ok") get a red
 * left rule and show the computed `note`. State maps ok / watch→soon / risk→bad.
 */
export function AttendanceCard({ rows, min }: { rows: OverviewAttendance[]; min: number }) {
  return (
    <Section
      title="Attendance runway"
      right={<span className="text-[11px] opacity-70">assumed ≥{min}%</span>}
    >
      {rows.length === 0 ? (
        <div className="text-sm opacity-70">No attendance data</div>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {rows.map((r) => (
            <li
              key={r.courseSlug}
              data-testid="attendance-row"
              className={r.atRisk ? "border-l-4 border-[var(--color-bad)] pl-2" : "pl-2"}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{r.course}</span>
                <span>{Math.round(r.nowPct)}%</span>
                <span className="opacity-70">· {r.sessionsLeftToEndterm} left</span>
                <span className="opacity-70">
                  · best case {r.bestCaseMidtermPct}/{r.bestCaseEndtermPct}%
                </span>
                <RiskBadge state={toState(r.state)} />
              </div>
              {r.atRisk && r.note && <div className="text-xs opacity-80">{r.note}</div>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
