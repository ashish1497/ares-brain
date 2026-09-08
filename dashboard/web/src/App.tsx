import { useEffect, useRef, useState } from "react";
import * as api from "./api";
import { getOverview, type Job, type Overview } from "./api";
import { Header } from "./components/Header";
import { KpiStrip } from "./components/KpiStrip";
import { TodayCard } from "./components/TodayCard";
import { WeekCard } from "./components/WeekCard";
import { AssignmentsCard } from "./components/AssignmentsCard";
import { ExamsCard } from "./components/ExamsCard";
import { AttendanceCard } from "./components/AttendanceCard";
import { BrainCard } from "./components/BrainCard";
import { GapsCard } from "./components/GapsCard";
import { ChatLockCard } from "./components/ChatLockCard";
import { JobLog } from "./components/JobLog";

export function App() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const stop = useRef<(() => void) | undefined>(undefined);

  const refresh = () =>
    getOverview()
      .then(setOv)
      .catch(() => {});
  useEffect(() => {
    refresh();
    api.getState().then((s) => setJob(s.job));
  }, []);
  useEffect(() => {
    const t = setInterval(() => api.getState().then((s) => setJob(s.job)), 3000);
    return () => clearInterval(t);
  }, []);
  const busy = job?.status === "running";

  async function onJob(kind: string, opts: Record<string, string> = {}) {
    const r = await api.startJob({ kind, ...opts });
    if (r.jobId) {
      setLines([]);
      stop.current?.();
      stop.current = api.streamLog(
        r.jobId,
        (l) => setLines((p) => [...p, l]),
        () => {
          api.getState().then((s) => setJob(s.job));
          refresh();
        },
        () => {
          api.getState().then((s) => setJob(s.job));
        },
      );
    } else setLines((p) => [...p, `! ${r.error}`]);
  }

  if (!ov) return <div className="mx-auto max-w-4xl p-6">loading…</div>;
  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <Header ov={ov} busy={!!busy} onJob={onJob} />
      <KpiStrip k={ov.kpis} min={ov.attendanceMin} />
      <TodayCard today={ov.today} />
      <WeekCard week={ov.thisWeek} />
      <AssignmentsCard assignments={ov.assignments} grade={ov.gradePicture} />
      <ExamsCard exams={ov.exams} />
      <AttendanceCard rows={ov.attendance} min={ov.attendanceMin} />
      <BrainCard rows={ov.brain} busy={!!busy} onJob={onJob} />
      <GapsCard gaps={ov.gaps} busy={!!busy} onJob={onJob} />
      <ChatLockCard k={ov.kpis} unlockAt={ov.chatUnlockAt} />
      {(job || lines.length > 0) && <JobLog job={job} lines={lines} />}
    </div>
  );
}
