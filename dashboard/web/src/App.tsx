import { useEffect, useRef, useState } from "react";
import * as api from "./api";
import { getOverview, SetupIncompleteError, type Job, type Overview } from "./api";
import { Header } from "./components/Header";
import { Tabs } from "./components/Tabs";
import { Settings } from "./components/Settings";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { JobLog } from "./components/JobLog";
import { Button } from "./components/ui/button";
import { useHashRoute } from "./lib/useHashRoute";
import { TodayTab } from "./components/today/TodayTab";
import { AssignmentsTab } from "./components/assignments/AssignmentsTab";
import { AttendanceTab } from "./components/AttendanceTab";
import { ExamsTab } from "./components/ExamsTab";
import { BrainTab } from "./components/BrainTab";
import { GapsTab } from "./components/GapsTab";
import { ChatPanel } from "./components/ChatPanel";
import { DriveTab } from "./components/DriveTab";
import { TestprepTab } from "./components/TestprepTab";
import { OutreachAgentPage } from "./components/outreach/OutreachAgentPage";
import { SetupGate, SetupChecklist, type SetupState } from "./components/SetupGate";

const TAB_IDS = [
  "today",
  "assignments",
  "attendance",
  "exams",
  "brain",
  "gaps",
  "chat",
  "drive",
  "testprep",
];

/** Full-page error state shown only when the very first load fails. */
function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 md:px-8">
      <div className="rounded-nb border-[3px] border-edge bg-bad p-4 text-black shadow-[var(--nb-shadow)] md:p-6">
        <h2 className="mb-1 font-bold">couldn&apos;t load overview</h2>
        <p className="mb-3 text-sm">{message}</p>
        <Button type="button" variant="neutral" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </div>
  );
}

/** Non-blocking banner shown when a later refresh fails after a good first load. */
function StaleBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3 rounded-nb border-[3px] border-edge bg-soon p-3 text-black shadow-[var(--nb-shadow)]">
      <span className="text-sm font-bold">showing stale data — the last refresh failed</span>
      <Button type="button" variant="neutral" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

export function App() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [err, setErr] = useState("");
  const [setupPending, setSetupPending] = useState<SetupState | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const stop = useRef<(() => void) | undefined>(undefined);
  const { tab, params, go } = useHashRoute();

  // A genuinely separate page — not one of the six dashboard tabs, and not
  // gated on the overview load (it needs none of that data).
  if (tab === "outreach-agent") return <OutreachAgentPage go={go} />;

  const refresh = (fresh = false) =>
    getOverview(fresh)
      .then((o) => {
        setOv(o);
        setErr("");
        setSetupPending(null);
      })
      .catch((e: unknown) => {
        if (e instanceof SetupIncompleteError) {
          setSetupPending(e.setupState);
          return;
        }
        setErr(e instanceof Error ? e.message : String(e));
      });
  useEffect(() => {
    refresh();
    api.getState().then((s) => {
      setJob(s.job);
      if (s.job) {
        stop.current?.();
        stop.current = api.streamLog(
          s.job.id,
          (l) => setLines((p) => [...p, l]),
          () => {
            api.getState().then((s2) => setJob(s2.job));
            refresh();
          },
          () => {
            api.getState().then((s2) => setJob(s2.job));
          },
        );
      }
    });
    return () => stop.current?.();
  }, []);
  useEffect(() => {
    const t = setInterval(() => api.getState().then((s) => setJob(s.job)), 3000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const t = setInterval(() => refresh(false), 20_000);
    return () => clearInterval(t);
  }, []);
  const busy = job?.status === "running";

  async function onJob(kind: string, opts: Record<string, string> = {}) {
    try {
      const r = await api.startJob({ kind, ...opts });
      if (!r.jobId) {
        setLines((p) => [...p, `! ${r.error}`]);
        return;
      }
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
    } catch (e) {
      setLines((p) => [...p, `! ${e}`]);
    }
  }

  if (setupPending) return <SetupChecklist state={setupPending} onRetry={refresh} />;
  if (!ov && err) return <ErrorCard message={err} onRetry={refresh} />;
  if (!ov) return <div className="mx-auto max-w-[1400px] p-8">loading…</div>;

  const counts = {
    assignments: ov.assignments.length,
    gaps:
      ov.gaps.pendingTranscripts.length +
      ov.gaps.missingBooks.length +
      (ov.gaps.scrapeStale ? 1 : 0) +
      (ov.gaps.attendanceStale ? 1 : 0),
  };

  const active = TAB_IDS.includes(tab) ? tab : "today";
  const tabProps = { ov, onJob, busy: !!busy, go, params };

  return (
    <SetupGate>
      <Header
        ov={ov}
        busy={!!busy}
        onResync={() => onJob("sync")}
        onRefresh={() => refresh(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOutreach={() => go("outreach-agent")}
      />
      <Tabs
        active={active}
        counts={counts}
        onSelect={(t) => {
          api.clientLog("tab", `switched to ${t}`);
          go(t);
        }}
      />
      <div className="mx-auto max-w-[1400px] px-4 pb-8 md:px-8">
        {err && ov && <StaleBanner onRetry={refresh} />}
        <main className="py-6">
          <ErrorBoundary>
            {active === "today" && <TodayTab {...tabProps} />}
            {active === "assignments" && <AssignmentsTab {...tabProps} />}
            {active === "attendance" && <AttendanceTab {...tabProps} />}
            {active === "exams" && <ExamsTab {...tabProps} />}
            {active === "brain" && <BrainTab {...tabProps} />}
            {active === "gaps" && <GapsTab {...tabProps} />}
            {active === "chat" && <ChatPanel />}
            {active === "drive" && <DriveTab />}
            {active === "testprep" && <TestprepTab />}
          </ErrorBoundary>
        </main>
        {(job || lines.length > 0) && <JobLog job={job} lines={lines} />}
      </div>
      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        ov={ov}
        onJob={onJob}
        busy={!!busy}
      />
    </SetupGate>
  );
}
