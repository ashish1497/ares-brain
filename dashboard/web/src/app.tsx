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
    api.getState().then(setState);
  }, []);

  useEffect(() => {
    if (busy) return;
    const t = setInterval(() => api.getState().then(setState), 3000);
    return () => clearInterval(t);
  }, [busy]);

  function follow(jobId: string) {
    setLines([]);
    stopRef.current?.();
    stopRef.current = api.streamLog(
      jobId,
      (l) => setLines((prev) => [...prev, l]),
      () => api.getState().then(setState),
    );
  }

  async function run(body: Parameters<typeof api.startJob>[0]) {
    const r = await api.startJob(body);
    if (r.jobId) {
      const s = await api.getState();
      setState(s);
      follow(r.jobId);
    } else if (r.error) {
      setLines((p) => [...p, `! ${r.error}`]);
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
