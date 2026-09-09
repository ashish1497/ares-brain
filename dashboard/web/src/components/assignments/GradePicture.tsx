import type { OverviewGradePicture } from "../../api";
import { SectionHeader } from "../SectionHeader";
import { Progress } from "../ui/progress";

/** The grade picture: per course, a filled-vs-hollow bar of work done vs ahead, plus a summary line. */
export function GradePicture({ rows }: { rows: OverviewGradePicture[] }) {
  return (
    <div>
      <SectionHeader>Grade picture</SectionHeader>
      <div className="space-y-4">
        {rows.map((r) => (
          <div key={r.courseSlug}>
            <div className="mb-1 text-sm font-medium">{r.course}</div>
            <Progress value={100 - r.aheadPct} />
            <p className="mt-1 text-[13px] text-[color:var(--color-ink-muted)]">{r.summary}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
