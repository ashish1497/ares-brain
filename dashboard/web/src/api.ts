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
  /** null when no exam is on record ahead */
  nextExamInDays: number | null;
  nextExamName: string | null;
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

export interface OverviewMaterial {
  title: string;
  kind: string;
}

export interface OverviewDueSoon {
  id: string | null;
  title: string;
  course: string;
  dueAt: string;
  hoursAway: number;
  submitted: boolean;
  isClub: boolean;
  submissionType: string;
  instructionsText: string;
  isGroup: boolean;
  cutoffAt: string | null;
  allowLate: boolean;
  materials: OverviewMaterial[];
  sessionRef: number | null;
  prereadPaths: string[];
}

export interface OverviewChanged {
  courseName: string;
  courseSlug: string;
  /** { "<changeKind>": count } */
  counts: Record<string, number>;
}

export interface OverviewToday {
  classes: OverviewClass[];
  dueTodayOrTomorrow: OverviewDueSoon[];
  changed: OverviewChanged[];
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
  course: string | null;
  courseSlug: string | null;
  weightPct: number | null;
  status: "not-started" | "draft" | "submitted" | null;
  coverage: string | null;
  action: OverviewAction | null;
}

export interface OverviewAssignment {
  id: string | null;
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
  instructionsText: string;
  isGroup: boolean;
  cutoffAt: string | null;
  allowLate: boolean;
  materials: OverviewMaterial[];
  sessionRef: number | null;
  prereadPaths: string[];
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
  name: string | null;
  date: string;
  inDays: number;
  courses: string[];
  courseNames: string[];
  coverageSessions: string | null;
  brainReady: boolean;
  testprepExists: boolean;
  testprepCommand: string;
  testprepCommands: { course: string; command: string }[];
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
  guideState: "missing" | "behind" | "current";
  corpusBytes: number | null;
  sourceCount: number | null;
  indexStale: boolean | null;
  guideBuiltAt: string | null;
  guideSourcesBehind: number;
  pendingTranscripts: number;
  reason: string;
  reasonParts: string[];
  buildCommand: string;
}

export interface OverviewPendingTranscriptItem {
  title: string;
  recordedOn: string | null;
  videoUrl: string | null;
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

/** Fire-and-forget: puts one line into the server's activity log, so a tab
 * switch shows up in the same stream as requests/jobs/gate checks instead
 * of only being visible on screen. Never throws — logging must not be able
 * to break the UI action it's attached to. */
export function clientLog(scope: string, message: string): void {
  fetch("/api/client-log", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope, message }),
  }).catch(() => {});
}

/** Thrown by getOverview (and any other gated call) when the server 503s
 * because the onboarding gate flipped back to incomplete — carries the
 * setup-state payload so the UI can show exactly what's pending instead of
 * a bare "503". */
export class SetupIncompleteError extends Error {
  setupState: import("./components/SetupGate").SetupState;
  constructor(setupState: import("./components/SetupGate").SetupState) {
    super("setup incomplete");
    this.setupState = setupState;
  }
}

export const getOverview = (fresh = false): Promise<Overview> =>
  fetch("/api/overview" + (fresh ? "?fresh=1" : "")).then(async (r) => {
    if (!r.ok) {
      if (r.status === 503) {
        const body = await r.json().catch(() => null);
        if (body?.setupState) throw new SetupIncompleteError(body.setupState);
      }
      throw new Error(`overview ${r.status}`);
    }
    return r.json();
  });

export interface DailyBrief {
  date: string;
  morning: string | null;
  evening: string | null;
}

export const getDailyBrief = (): Promise<DailyBrief> =>
  fetch("/api/daily-brief").then((r) => {
    if (!r.ok) throw new Error(`daily-brief ${r.status}`);
    return r.json();
  });

export async function startJob(body: {
  kind: string;
  course?: string;
  url?: string;
  title?: string;
  message?: string;
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
): Promise<{
  written: string[];
  rejected: { name: string; reason: string }[];
  error?: string;
}> {
  const fd = new FormData();
  for (const f of Array.from(files)) fd.append("files", f);
  const r = await fetch(`/api/upload?course=${encodeURIComponent(course)}&kind=${kind}`, {
    method: "POST",
    body: fd,
  });
  return r.json();
}

// ---------------------------------------------------------------------------
// Outreach agent — Art of Selling. Five independently regenerable sections;
// no "personalization pack" object, each section is its own piece of state.
// ---------------------------------------------------------------------------

export type OutreachSection = "icp" | "industry" | "company" | "people" | "outreach";
export const OUTREACH_SECTION_ORDER: OutreachSection[] = [
  "icp",
  "industry",
  "company",
  "people",
  "outreach",
];

export type VerifiableSection = "company" | "people";

export interface OutreachState {
  myCompany: string;
  whatIDo: string;
  targetAccount: string | null;
  sections: Record<OutreachSection, Record<string, unknown> | null>;
  edited: Record<OutreachSection, boolean>;
  verification: Partial<Record<OutreachSection, Record<string, unknown> | null>>;
  doNotUse: string[];
}

async function outreachPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `request failed (${r.status})`);
  return data as T;
}

export const startOutreachSession = (myCompany: string, whatIDo: string) =>
  outreachPost<{ sessionId: string; state: OutreachState }>("/api/outreach/session", {
    myCompany,
    whatIDo,
  });

export const updateOutreachCompanyInfo = (sessionId: string, myCompany: string, whatIDo: string) =>
  outreachPost<{ state: OutreachState }>("/api/outreach/company-info", {
    sessionId,
    myCompany,
    whatIDo,
  });

export const setOutreachTarget = (sessionId: string, targetAccount: string) =>
  outreachPost<{ state: OutreachState }>("/api/outreach/target", { sessionId, targetAccount });

export const editOutreachSection = (
  sessionId: string,
  section: OutreachSection,
  content: Record<string, unknown>,
) => outreachPost<{ state: OutreachState }>("/api/outreach/edit", { sessionId, section, content });

export const runOutreachSection = (sessionId: string, section: OutreachSection) =>
  outreachPost<{
    section: OutreachSection;
    content: Record<string, unknown>;
    state: OutreachState;
  }>(`/api/outreach/run/${section}`, { sessionId });

export const verifyOutreachSection = (sessionId: string, section: VerifiableSection) =>
  outreachPost<{
    section: OutreachSection;
    result: Record<string, unknown>;
    state: OutreachState;
  }>(`/api/outreach/verify/${section}`, { sessionId });

export const verifyOutreachMessages = (sessionId: string) =>
  outreachPost<{
    section: OutreachSection;
    result: Record<string, unknown>;
    state: OutreachState;
  }>("/api/outreach/verify-messages", { sessionId });

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
