import { useEffect, useRef } from "preact/hooks";
import type { Job } from "../api";

export function JobLog({ job, lines }: { job: Job | null; lines: string[] }) {
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    pre.current?.scrollTo?.(0, pre.current.scrollHeight);
  }, [lines]);
  const dot = !job
    ? "bg-[var(--color-ink-soft)]"
    : job.status === "running"
      ? "bg-green-500"
      : job.status === "failed"
        ? "bg-red-500"
        : "bg-[var(--color-ink-soft)]";
  return (
    <div class="mt-4 rounded-[var(--radius-card)] bg-[var(--color-surface-1)] p-3">
      <div class="mb-2 flex items-center gap-2 text-[13px]">
        <span class={`inline-block h-2 w-2 rounded-full ${dot}`} />
        {job ? `${job.status} · ${job.kind}` : "No job running"}
      </div>
      <pre
        ref={pre}
        class="m-0 max-h-40 overflow-auto rounded-md bg-[var(--color-surface-0)] p-2 font-mono text-[12px] leading-snug text-[var(--color-ink-soft)]"
      >
        {lines.join("\n") || (job ? "" : "—")}
      </pre>
    </div>
  );
}
