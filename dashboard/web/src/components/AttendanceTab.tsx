import { useState } from "react";
import type { TabProps } from "../lib/types";
import type { OverviewAttendance } from "../api";
import { SectionHeader } from "./SectionHeader";
import { MetaRow } from "./MetaRow";
import { StatePill } from "./StatePill";
import { InfoTip } from "./InfoTip";
import { Card } from "./ui/card";
import { Button } from "./ui/button";

const STATE_TINT: Record<OverviewAttendance["state"], string> = {
  ok: "ok",
  watch: "soon",
  risk: "bad",
};

const STATE_LABEL: Record<OverviewAttendance["state"], string> = {
  ok: "on track",
  watch: "watch",
  risk: "at risk",
};

const STATE_PILL: Record<OverviewAttendance["state"], "ok" | "soon" | "bad"> = {
  ok: "ok",
  watch: "soon",
  risk: "bad",
};

/** Highest-risk state first (risk > watch > ok); ties keep their payload order. */
function riskRank(state: OverviewAttendance["state"]): number {
  return state === "risk" ? 0 : state === "watch" ? 1 : 2;
}

/** Attendance — per-course table with best-case projections, sortable by risk (default) or Now. */
export function AttendanceTab({ ov }: TabProps) {
  const [sort, setSort] = useState<"risk" | "now-asc" | "now-desc">("risk");
  const rows = ov.attendance;

  // Read the KPI aggregates from the server (overview.py) rather than recomputing them here —
  // its zero-guards differ from a client recompute (it guards tot_conf; a client recompute
  // guarded totalConducted + totalLeftToEndterm), and duplicating the aggregate is how the
  // summary chip and this tab would drift apart later.
  const totalAttended = rows.reduce((s, r) => s + r.attended, 0);
  const totalConducted = rows.reduce((s, r) => s + r.conducted, 0);
  const overallPct = ov.kpis.attendanceNow;
  const bestCasePct = ov.kpis.attendanceBestCase;

  const sorted = [...rows].sort((a, b) => {
    if (sort === "now-asc") return a.nowPct - b.nowPct;
    if (sort === "now-desc") return b.nowPct - a.nowPct;
    return riskRank(a.state) - riskRank(b.state);
  });

  // Now header cycles risk (default) -> now-asc -> now-desc -> risk, so the default sort is
  // always reachable again instead of being a one-way door once Now has been clicked.
  function toggleNowSort() {
    setSort((s) => (s === "risk" ? "now-asc" : s === "now-asc" ? "now-desc" : "risk"));
  }

  return (
    <Card className="gap-0 md:p-6">
      <SectionHeader info="Where every course stands against the attendance minimum.">
        Attendance
      </SectionHeader>
      <div className="mb-1">
        <MetaRow
          items={[
            `attended ${totalAttended} of ${totalConducted}`,
            `${overallPct}% overall`,
            `best case ${bestCasePct}%`,
          ]}
        />
      </div>
      <p className="mb-4 text-[13px] text-[color:var(--color-ink-muted)]">
        assumes ≥ {ov.attendanceMin}% (ARES_BRAIN_ATTENDANCE_MIN)
      </p>
      {rows.length === 0 ? (
        <p className="text-[13px] text-[color:var(--color-ink-muted)]">No attendance data.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b-[3px] border-edge">
                <th className="py-2 pr-3 font-bold">Course</th>
                <th className="py-2 pr-3 font-bold">
                  <span className="inline-flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={toggleNowSort}
                      className="px-0 text-[color:var(--color-accent)]"
                    >
                      Now
                    </Button>
                    <InfoTip label="about Now">
                      Your attendance right now: sessions attended out of sessions actually held.
                    </InfoTip>
                  </span>
                </th>
                <th className="py-2 pr-3 font-bold">
                  <span className="inline-flex items-center gap-1">
                    Held
                    <InfoTip label="about Held">
                      Sessions this course has actually held so far.
                    </InfoTip>
                  </span>
                </th>
                <th className="py-2 pr-3 font-bold">
                  <span className="inline-flex items-center gap-1">
                    Left
                    <InfoTip label="about Left">
                      Sessions still to come before the end of term.
                    </InfoTip>
                  </span>
                </th>
                <th className="py-2 pr-3 font-bold">
                  <span className="inline-flex items-center gap-1">
                    Best case mid–end
                    <InfoTip label="about Best case mid–end">
                      The highest attendance you could still reach if you attend every remaining
                      session — by the midterm, and by the end of term.
                    </InfoTip>
                  </span>
                </th>
                <th className="py-2 pr-3 font-bold">
                  <span className="inline-flex items-center gap-1">
                    Floor
                    <InfoTip label="about Floor">
                      The lowest your attendance can fall to by the end of term if you miss every
                      remaining session.
                    </InfoTip>
                  </span>
                </th>
                <th className="py-2 pr-3 font-bold">
                  <span className="inline-flex items-center gap-1">
                    State
                    <InfoTip label="about State" align="right">
                      On track, watch, or at risk, measured against the {ov.attendanceMin}% minimum.
                    </InfoTip>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--color-rule)]">
              {sorted.map((r) => {
                const tint = STATE_TINT[r.state];
                return (
                  <tr
                    key={r.courseSlug}
                    style={{
                      background: `color-mix(in srgb, var(--color-${tint}) 8%, var(--color-card))`,
                    }}
                  >
                    <td className="py-3 pr-3 font-medium">{r.course}</td>
                    <td className="py-3 pr-3">{r.nowPct}%</td>
                    <td className="py-3 pr-3">{r.conducted}</td>
                    <td className="py-3 pr-3">{r.sessionsLeftToEndterm}</td>
                    <td className="py-3 pr-3">
                      {r.bestCaseMidtermPct}% / {r.bestCaseEndtermPct}%
                    </td>
                    <td className="py-3 pr-3">{r.floorEndtermPct}%</td>
                    <td className="py-3 pr-3">
                      <StatePill state={STATE_PILL[r.state]}>{STATE_LABEL[r.state]}</StatePill>
                      {r.state !== "ok" && r.note && (
                        <div className="mt-1 text-[color:var(--color-ink-muted)]">{r.note}</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
