import { useEffect, useRef, useState } from "preact/hooks";
import * as api from "./api";
import type { Course, Job, State } from "./api";
import { CoursePicker } from "./components/CoursePicker";
import { SyncCard } from "./components/SyncCard";
import { UploadCard } from "./components/UploadCard";
import { YouTubeCard } from "./components/YouTubeCard";
import { JobLog } from "./components/JobLog";

export function App() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [course, setCourse] = useState("");
  const [state, setState] = useState<State>({ job: null, lastRuns: {} });
  const [lines, setLines] = useState<string[]>([]);
  const stopRef = useRef<() => void>();

  const job: Job | null = state.job;
  const busy = job?.status === "running";

  useEffect(() => {
    api.getCourses().then((c) => {
      setCourses(c);
      if (c[0]) setCourse(c[0].slug);
    });
    api.getState().then((s) => {
      setState(s);
      if (s.job?.status === "running") follow(s.job.id);
    });
  }, []);

  useEffect(() => {
    // Always-on safety net: a cheap GET /api/state every 3s. The SSE stream just
    // makes updates snappier; if it drops or the page reloaded mid-job, this poll
    // still recovers `busy` once the job leaves "running".
    const t = setInterval(() => api.getState().then(setState), 3000);
    return () => clearInterval(t);
  }, []);

  function follow(jobId: string) {
    setLines([]);
    stopRef.current?.();
    const recover = () => {
      stopRef.current = undefined;
      api.getState().then(setState);
      // A job may have created the first courses (e.g. a Sync on first run) —
      // refresh the picker so course-scoped cards stop being disabled.
      api.getCourses().then((c) => {
        setCourses(c);
        setCourse((cur) => cur || c[0]?.slug || "");
      });
    };
    stopRef.current = api.streamLog(
      jobId,
      (l) => setLines((prev) => [...prev, l]),
      recover,
      recover,
    );
  }

  async function run(body: Parameters<typeof api.startJob>[0]) {
    let r: Awaited<ReturnType<typeof api.startJob>>;
    try {
      r = await api.startJob(body);
    } catch (e) {
      setLines((p) => [...p, `! network error: ${e instanceof Error ? e.message : String(e)}`]);
      return;
    }
    if (r.jobId) {
      const s = await api.getState();
      setState(s);
      follow(r.jobId);
    } else if (r.error) {
      const msg =
        r.error === "busy" ? "A job is already running — wait for it to finish." : r.error;
      setLines((p) => [...p, `! ${msg}`]);
    }
  }

  return (
    <div class="mx-auto max-w-3xl p-6">
      <header class="mb-4 flex items-center justify-between border-b border-[var(--color-line)] pb-3">
        <div class="flex items-center gap-2 text-base font-medium">
          <i class="ti ti-brain" aria-hidden="true" /> Ares Brain
        </div>
        <div class="flex items-center gap-2">
          <span class="text-[13px] text-[var(--color-ink-soft)]">Course</span>
          <CoursePicker courses={courses} value={course} onChange={setCourse} />
        </div>
      </header>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SyncCard
          job={job}
          last={state.lastRuns.sync}
          busy={!!busy}
          onRun={() => run({ kind: "sync" })}
        />
        <UploadCard
          kind="book"
          course={course}
          busy={!!busy}
          onQueued={(k) => run({ kind: k, course })}
        />
        <UploadCard
          kind="recording"
          course={course}
          busy={!!busy}
          onQueued={(k) => run({ kind: k, course })}
        />
        <YouTubeCard
          course={course}
          busy={!!busy}
          onRun={(url, title) => run({ kind: "transcribe-url", course, url, title })}
        />
      </div>

      <JobLog job={job} lines={lines} />

      <p class="mt-3 flex items-center gap-2 text-[12px] text-[var(--color-ink-soft)]">
        <i class="ti ti-message-circle" aria-hidden="true" /> Chat — phase 2
      </p>
    </div>
  );
}
