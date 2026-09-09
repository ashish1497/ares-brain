import type { TabProps } from "../../lib/types";
import type { OverviewAssignment } from "../../api";
import { SectionHeader } from "../SectionHeader";
import { MetaRow } from "../MetaRow";
import { Card } from "../ui/card";
import { cn } from "../../lib/utils";
import { countdown } from "../../lib/format";
import { AssignmentPage } from "./AssignmentPage";
import { GradePicture } from "./GradePicture";

const STATUS_FILL: Record<OverviewAssignment["status"], string> = {
  "not-started": "bg-bad",
  draft: "bg-soon",
  submitted: "bg-ok",
};

function AssignmentRow({ a, go }: { a: OverviewAssignment; go: (hash: string) => void }) {
  const clickable = a.id != null && a.courseSlug != null;
  const weightLabel = a.weightPct != null ? `${a.weightPct}%` : "ungraded";
  const dueBad = a.dueAt != null && a.hoursAway != null && a.hoursAway <= 48;
  const dueLabel = a.dueAt == null ? "no due date" : countdown(a.dueAt);
  const rowMuted = a.weightPct == null || a.isClub;

  const content = (
    <div className="flex w-full items-center justify-between gap-3 py-3 text-left">
      <div className="flex items-center gap-3">
        <span
          role="img"
          aria-label={a.status}
          className={cn(
            "size-4 shrink-0 rounded-nb border-[3px] border-edge",
            STATUS_FILL[a.status],
          )}
        />
        <div>
          <div className="font-medium">{a.title}</div>
          <div className="text-[13px] text-[color:var(--color-ink-muted)]">{a.course}</div>
        </div>
      </div>
      <MetaRow
        items={[
          weightLabel,
          <span key="due" className={dueBad ? "text-bad" : undefined}>
            {dueLabel}
          </span>,
          "Open →",
        ]}
      />
    </div>
  );

  if (!clickable) {
    return <div className={rowMuted ? "opacity-80" : undefined}>{content}</div>;
  }
  return (
    <button
      type="button"
      onClick={() => go(`assignments/${a.courseSlug}/${a.id}`)}
      className={cn(
        "block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge",
        rowMuted && "opacity-80",
      )}
    >
      {content}
    </button>
  );
}

function AssignmentsList({ ov, go }: Pick<TabProps, "ov" | "go">) {
  const { assignments, gradePicture } = ov;
  const dueThisWeek = assignments.filter(
    (a) => a.hoursAway != null && a.hoursAway >= 0 && a.hoursAway <= 168,
  ).length;
  const worst = assignments[0];

  return (
    <Card className="gap-0 md:p-6">
      <SectionHeader info="Everything not yet submitted, ordered by risk.">
        Assignments
      </SectionHeader>
      {assignments.length === 0 ? (
        <p className="text-[13px] text-[color:var(--color-ink-muted)]">Nothing open.</p>
      ) : (
        <>
          <div className="mb-3">
            <MetaRow
              items={[
                `${assignments.length} open`,
                `${dueThisWeek} due this week`,
                `worst: ${worst.title} (${worst.weightPct != null ? `${worst.weightPct}%` : "ungraded"})`,
              ]}
            />
          </div>
          <ul className="divide-y divide-[color:var(--color-rule)]">
            {assignments.map((a) => (
              <li key={a.id ?? a.title}>
                <AssignmentRow a={a} go={go} />
              </li>
            ))}
          </ul>
        </>
      )}
      {gradePicture.length > 0 && (
        <div className="mt-6 border-t border-[color:var(--color-rule)] pt-6">
          <GradePicture rows={gradePicture} />
        </div>
      )}
    </Card>
  );
}

/** Assignments tab: a risk-ordered list + grade picture, or the focused single-assignment page. */
export function AssignmentsTab({ ov, go, params }: TabProps) {
  if (params.length >= 2) {
    return <AssignmentPage ov={ov} slug={params[0]} id={params[1]} go={go} />;
  }
  return <AssignmentsList ov={ov} go={go} />;
}
