import { useEffect, useRef } from "react";
import type { Job } from "../api";

/** Live job log strip (ported from F, retargeted to palette B). Autoscrolls to the tail. */
export function JobLog({ job, lines }: { job: Job | null; lines: string[] }) {
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    pre.current?.scrollTo?.(0, pre.current.scrollHeight);
  }, [lines]);
  const dot = !job
    ? "bg-[var(--color-edge)]"
    : job.status === "running"
      ? "bg-[var(--color-ok)]"
      : job.status === "failed"
        ? "bg-[var(--color-bad)]"
        : "bg-[var(--color-edge)]";
  return (
    <div className="mt-4 rounded-[var(--radius-nb)] border-[length:var(--nb-border)] border-[var(--color-edge)] bg-[var(--color-card)] p-3 shadow-[var(--nb-shadow)]">
      <div className="mb-2 flex items-center gap-2 text-[13px]">
        <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
        {job ? `${job.status} · ${job.kind}` : "No job running"}
      </div>
      <pre
        ref={pre}
        className="m-0 max-h-40 overflow-auto rounded-[var(--radius-nb)] border-[length:var(--nb-border)] border-[var(--color-edge)] bg-[var(--color-paper)] p-2 font-mono text-[12px] leading-snug text-inherit"
      >
        {lines.join("\n") || (job ? "" : "—")}
      </pre>
    </div>
  );
}
