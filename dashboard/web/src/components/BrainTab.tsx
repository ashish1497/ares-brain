import type { TabProps } from "../lib/types";
import type { OverviewBrain } from "../api";
import { SectionHeader } from "./SectionHeader";
import { MetaRow } from "./MetaRow";
import { StatePill } from "./StatePill";
import { CopyButton } from "./CopyButton";
import { InfoTip } from "./InfoTip";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";

/** Splits a `·`-joined reason string into MetaRow parts; a reason with no `·` renders unchanged. */
function reasonParts(reason: string): string[] {
  return reason.split("·").map((part) => part.trim());
}

const STATE_PILL: Record<OverviewBrain["state"], "ok" | "soon" | "bad"> = {
  ready: "ok",
  stale: "soon",
  "not-built": "bad",
};

/** not-built first, then stale, then ready. */
function stateRank(state: OverviewBrain["state"]): number {
  return state === "not-built" ? 0 : state === "stale" ? 1 : 2;
}

/** Brain — per-course readiness table plus the chat-unlock progress header. */
export function BrainTab({ ov, onJob, busy }: TabProps) {
  const { brainReady, courseCount } = ov.kpis;
  const pct = ov.chatUnlockAt > 0 ? Math.round((brainReady / ov.chatUnlockAt) * 100) : 0;
  const sorted = [...ov.brain].sort((a, b) => stateRank(a.state) - stateRank(b.state));

  return (
    <Card className="gap-0 md:p-6">
      <SectionHeader info="Per-course knowledge guides built from the ingested material.">
        Brain
      </SectionHeader>
      <p className="mb-2 flex items-center gap-1 text-[13px]">
        {brainReady} of {courseCount} course brains ready — chat unlocks at {ov.chatUnlockAt}
        <InfoTip label="about the brain progress bar">
          Course brains built, against the {ov.chatUnlockAt} needed to unlock chat.
        </InfoTip>
      </p>
      <div className="mb-4">
        <Progress value={pct} />
      </div>
      {sorted.length === 0 ? (
        <p className="text-[13px] text-[color:var(--color-ink-muted)]">No courses.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b-[3px] border-edge">
                <th className="py-2 pr-3 font-bold">Course</th>
                <th className="py-2 pr-3 font-bold">
                  <span className="inline-flex items-center gap-1">
                    State
                    <InfoTip label="about State">
                      ready = the guide is built and current. stale = a guide exists but new
                      material has landed since. not-built = no guide yet.
                    </InfoTip>
                  </span>
                </th>
                <th className="py-2 pr-3 font-bold">
                  <span className="inline-flex items-center gap-1">
                    Why
                    <InfoTip label="about Why">Why this course is in that state.</InfoTip>
                  </span>
                </th>
                <th className="py-2 pr-3 font-bold">
                  <span className="inline-flex items-center gap-1">
                    Corpus
                    <InfoTip label="about Corpus">
                      How much normalized course material has been ingested for this course.
                    </InfoTip>
                  </span>
                </th>
                <th className="py-2 pr-3 font-bold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--color-rule)]">
              {sorted.map((b) => (
                <tr key={b.courseSlug}>
                  <td className="py-3 pr-3 font-medium">{b.course}</td>
                  <td className="py-3 pr-3">
                    <StatePill state={STATE_PILL[b.state]}>{b.state}</StatePill>
                  </td>
                  <td className="py-3 pr-3 text-[color:var(--color-ink-muted)]">
                    <MetaRow items={reasonParts(b.reason)} />
                  </td>
                  <td className="py-3 pr-3">
                    {!b.corpusBytes
                      ? "—"
                      : b.corpusBytes < 1024
                        ? "<1 KB"
                        : `${Math.round(b.corpusBytes / 1024)} KB`}
                  </td>
                  <td className="py-3 pr-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {b.state !== "ready" && (
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          disabled={busy}
                          onClick={() => onJob("ingest", { course: b.courseSlug })}
                        >
                          Ingest
                        </Button>
                      )}
                      <CopyButton value={b.buildCommand} label="Build guide" variant="neutral" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
