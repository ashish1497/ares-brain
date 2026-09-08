export interface Course {
  slug: string;
  name: string;
}
export interface Job {
  id: string;
  kind: string;
  course?: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  log: string[];
}
export interface State {
  job: Job | null;
  lastRuns: Record<string, { finishedAt: string; exitCode: number }>;
}

/**
 * Shape of `GET /api/overview` — written from the real key/type dump of
 * `lms_scrape.py overview --json` (see .superpowers/sdd/2026-09-08-outcome-dashboard/
 * overview-shape.txt), with `T | null` for fields that were empty (NoneType) in the
 * sample, T inferred from the design spec §3/§4.
 */
export interface OverviewKpis {
  dueThisWeek: number;
  nextExamInDays: number;
  nextExamName: string;
  /** mean avgCp across courses; null if all 0 */
  cpAvg: number | null;
  attendanceNow: number;
  attendanceBestCase: number;
  brainReady: number;
  courseCount: number;
}

export interface OverviewClass {
  start: string;
  end: string;
  course: string;
  courseSlug: string | null;
  room: string | null;
  instructor: string | null;
  meetingLink: string | null;
  prereadPaths: string[];
}

export interface OverviewDueSoon {
  title: string;
  course: string;
  dueAt: string;
  hoursAway: number;
  submitted: boolean;
  isClub: boolean;
  submissionType: string;
}

export interface OverviewToday {
  classes: OverviewClass[];
  dueTodayOrTomorrow: OverviewDueSoon[];
  /** { "<courseSlug>": { "<changeKind>": count } } */
  changed: Record<string, Record<string, number>>;
}

export interface OverviewAction {
  label: string;
  type: "copy" | "job";
  value: string;
}

export interface OverviewWeekItem {
  when: string;
  kind: "class" | "assignment" | "exam";
  title: string;
  course: string;
  courseSlug: string | null;
  weightPct: number | null;
  status: "not-started" | "draft" | "submitted" | null;
  coverage: string | null;
  action: OverviewAction | null;
}

export interface OverviewAssignment {
  id: string;
  title: string;
  course: string;
  courseSlug: string | null;
  weightPct: number | null;
  dueAt: string | null;
  hoursAway: number | null;
  status: "not-started" | "draft" | "submitted";
  isClub: boolean;
  submissionType: string;
  risk: number;
  helpCommand: string;
}

export interface OverviewGradeComponent {
  name: string;
  weightPct: number;
  done: boolean | null;
}

export interface OverviewGradePicture {
  course: string;
  courseSlug: string;
  components: OverviewGradeComponent[];
  aheadPct: number;
  summary: string;
}

export interface OverviewExam {
  name: string;
  date: string;
  inDays: number;
  courses: string[];
  coverageSessions: string | null;
  brainReady: boolean;
  testprepExists: boolean;
  testprepCommand: string;
}

export interface OverviewAttendance {
  course: string;
  courseSlug: string;
  attended: number;
  conducted: number;
  nowPct: number;
  avgCp: number;
  sessionsLeftToMidterm: number;
  sessionsLeftToEndterm: number;
  bestCaseMidtermPct: number;
  bestCaseEndtermPct: number;
  floorEndtermPct: number;
  state: "ok" | "watch" | "risk";
  atRisk: boolean;
  note: string;
}

export interface OverviewBrain {
  course: string;
  courseSlug: string;
  state: "ready" | "stale" | "not-built";
  corpusBytes: number;
  sourceCount: number;
  indexStale: boolean;
  guideBuiltAt: string | null;
  guideSourcesBehind: number;
  pendingTranscripts: number;
  reason: string;
  buildCommand: string;
}

export interface OverviewPendingTranscriptItem {
  title: string;
  recordedOn: string | null;
  videoUrl: string;
}

export interface OverviewPendingTranscriptGroup {
  course: string;
  courseSlug: string;
  count: number;
  items: OverviewPendingTranscriptItem[];
}

export interface OverviewMissingBook {
  title: string;
  author: string;
  mentionedIn: string[];
}

export interface OverviewGaps {
  pendingTranscripts: OverviewPendingTranscriptGroup[];
  missingBooks: OverviewMissingBook[];
  scrapeStale: boolean;
  attendanceStale: boolean;
}

export interface Overview {
  generatedAt: string;
  date: string;
  scrapeAgeHours: number;
  term: string;
  kpis: OverviewKpis;
  today: OverviewToday;
  thisWeek: OverviewWeekItem[];
  assignments: OverviewAssignment[];
  gradePicture: OverviewGradePicture[];
  exams: OverviewExam[];
  attendance: OverviewAttendance[];
  attendanceMin: number;
  brain: OverviewBrain[];
  chatUnlockAt: number;
  gaps: OverviewGaps;
}

const j = (r: Response) => r.json();

export const getCourses = (): Promise<Course[]> => fetch("/api/courses").then(j);
export const getState = (): Promise<State> => fetch("/api/state").then(j);

export const getOverview = (): Promise<Overview> =>
  fetch("/api/overview").then((r) => {
    if (!r.ok) throw new Error(`overview ${r.status}`);
    return r.json();
  });

export async function startJob(body: {
  kind: string;
  course?: string;
  url?: string;
  title?: string;
}): Promise<{ jobId?: string; error?: string }> {
  const r = await fetch("/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

export async function upload(
  course: string,
  kind: "book" | "recording",
  files: FileList,
): Promise<{ written: string[]; rejected: { name: string; reason: string }[] }> {
  const fd = new FormData();
  for (const f of Array.from(files)) fd.append("files", f);
  const r = await fetch(`/api/upload?course=${encodeURIComponent(course)}&kind=${kind}`, {
    method: "POST",
    body: fd,
  });
  return r.json();
}

export function streamLog(
  jobId: string,
  onLine: (l: string) => void,
  onEnd: (exitCode: number) => void,
  onError?: () => void,
): () => void {
  const es = new EventSource(`/api/jobs/${jobId}/log`);
  es.onmessage = (e) => onLine(JSON.parse(e.data));
  es.addEventListener("end", (e) => {
    onEnd(JSON.parse((e as MessageEvent).data).exitCode);
    es.close();
  });
  es.onerror = () => {
    es.close();
    onError?.();
  };
  return () => es.close();
}
