import { useEffect, useRef } from "react";
import type { Job } from "../api";
import { MetaRow } from "./MetaRow";

/** Live job log strip. Autoscrolls to the tail. */
export function JobLog({ job, lines }: { job: Job | null; lines: string[] }) {
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    pre.current?.scrollTo?.(0, pre.current.scrollHeight);
  }, [lines]);
  const dot = !job
    ? "bg-edge"
    : job.status === "running"
      ? "bg-ok"
      : job.status === "failed"
        ? "bg-bad"
        : "bg-edge";
  return (
    <div className="mt-4 rounded-nb border-[3px] border-edge bg-card p-3 shadow-[var(--nb-shadow)]">
      <div className="mb-2 flex items-center gap-2 text-[13px]">
        <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
        {job ? <MetaRow items={[job.status, job.kind]} /> : "No job running"}
      </div>
      <pre
        ref={pre}
        className="m-0 max-h-40 overflow-auto rounded-nb border-[3px] border-edge bg-paper p-2 font-mono text-[12px] leading-snug text-[color:var(--color-ink-muted)]"
      >
        {lines.join("\n") || (job ? "" : "—")}
      </pre>
    </div>
  );
}
