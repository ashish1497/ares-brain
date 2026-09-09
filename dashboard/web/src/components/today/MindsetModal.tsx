import type { Overview, OverviewAttendance, OverviewBrain, OverviewClass } from "../../api";
import { fmtTime, reasonParts } from "../../lib/format";
import { CopyButton } from "../CopyButton";
import { MetaRow } from "../MetaRow";
import { Modal } from "../Modal";
import { Rule } from "../Rule";
import { StatePill } from "../StatePill";

const BRAIN_PILL: Record<OverviewBrain["state"], "ok" | "soon" | "bad"> = {
  ready: "ok",
  stale: "soon",
  "not-built": "bad",
};

const ATTENDANCE_PILL: Record<OverviewAttendance["state"], "ok" | "soon" | "bad"> = {
  ok: "ok",
  watch: "soon",
  risk: "bad",
};

/**
 * Per-class "Mindset" modal — facts + hand-off, per ruling 1: this dashboard makes no LLM
 * calls, so it never writes the judgement-call brief itself. It renders every fact the
 * payload actually knows about the session ("What we know"), then a copy-command hand-off to
 * Claude Code for the written brief. Hides any sub-block whose data is absent.
 */
export function MindsetModal({
  cls,
  ov,
  onClose,
}: {
  cls: OverviewClass;
  ov: Overview;
  onClose: () => void;
}) {
  const dueInCourse = ov.today.dueTodayOrTomorrow.filter((d) => d.course === cls.course);
  const brainEntry = cls.courseSlug
    ? ov.brain.find((b) => b.courseSlug === cls.courseSlug)
    : undefined;
  const attendanceEntry = cls.courseSlug
    ? ov.attendance.find((a) => a.courseSlug === cls.courseSlug)
    : undefined;

  return (
    <Modal open onClose={onClose} title={cls.course}>
      <div className="space-y-4">
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase text-[color:var(--color-ink-muted)]">
            What we know
          </div>
          <div className="space-y-3 text-[13px]">
            <div>
              <div className="font-bold">
                {fmtTime(cls.start)}–{fmtTime(cls.end)}
              </div>
              <MetaRow items={[cls.room, cls.instructor].filter(Boolean)} />
            </div>

            {cls.prereadPaths.length > 0 ? (
              <ul className="list-inside list-disc space-y-1">
                {cls.prereadPaths.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[color:var(--color-ink-muted)]">
                no pre-read on file for this session
              </p>
            )}

            {dueInCourse.length > 0 && (
              <div>
                <div className="font-bold">Due today or tomorrow</div>
                <ul className="list-inside list-disc space-y-1">
                  {dueInCourse.map((d, i) => (
                    <li key={i}>{d.title}</li>
                  ))}
                </ul>
              </div>
            )}

            {brainEntry && (
              <div className="flex items-center gap-2">
                <StatePill state={BRAIN_PILL[brainEntry.state]}>{brainEntry.state}</StatePill>
                <span className="text-[color:var(--color-ink-muted)]">
                  <MetaRow items={reasonParts(brainEntry.reason)} />
                </span>
              </div>
            )}

            {attendanceEntry && (
              <div className="flex items-center gap-2">
                <StatePill state={ATTENDANCE_PILL[attendanceEntry.state]}>
                  {attendanceEntry.nowPct}%
                </StatePill>
                <span className="text-[color:var(--color-ink-muted)]">attendance</span>
              </div>
            )}

            {cls.meetingLink && /^https?:/.test(cls.meetingLink) && (
              <a
                href={cls.meetingLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-[color:var(--color-accent)] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge"
              >
                Join meeting
              </a>
            )}
          </div>
        </div>

        <Rule />

        <div>
          <p className="mb-2 text-[13px] text-[color:var(--color-ink-muted)]">
            Paste this into Claude Code for a written brief on what to expect and what to prepare
            before class.
          </p>
          <CopyButton
            value={`/mesa:ares-brain-course-brief "${cls.course}"`}
            label="Copy brief command"
          />
        </div>
      </div>
    </Modal>
  );
}
