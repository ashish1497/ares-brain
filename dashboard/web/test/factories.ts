import type {
  Overview,
  OverviewAssignment,
  OverviewAttendance,
  OverviewBrain,
  OverviewChanged,
  OverviewClass,
  OverviewDueSoon,
  OverviewExam,
  OverviewGaps,
  OverviewKpis,
  OverviewWeekItem,
} from "../src/api";

export const kpis = (over: Partial<OverviewKpis> = {}): OverviewKpis => ({
  dueThisWeek: 0,
  nextExamInDays: null,
  nextExamName: null,
  cpAvg: null,
  attendanceNow: 90,
  attendanceBestCase: 95,
  brainReady: 0,
  courseCount: 17,
  ...over,
});

export const weekItem = (over: Partial<OverviewWeekItem> = {}): OverviewWeekItem => ({
  when: "2026-09-10",
  kind: "class",
  title: "Session",
  course: "Course",
  courseSlug: null,
  weightPct: null,
  status: null,
  coverage: null,
  action: null,
  ...over,
});

export const changed = (over: Partial<OverviewChanged> = {}): OverviewChanged => ({
  courseName: "Course",
  courseSlug: "course",
  counts: { announcement: 1 },
  ...over,
});

export const todayClass = (over: Partial<OverviewClass> = {}): OverviewClass => ({
  start: "2026-09-09T09:30:00",
  end: "2026-09-09T11:00:00",
  course: "Course",
  courseSlug: "course",
  room: "Room 1",
  instructor: "Prof X",
  meetingLink: null,
  prereadPaths: [],
  ...over,
});

export const dueSoon = (over: Partial<OverviewDueSoon> = {}): OverviewDueSoon => ({
  id: "a1",
  title: "Assignment",
  course: "Course",
  dueAt: "2026-09-09T20:00:00",
  hoursAway: 10,
  submitted: false,
  isClub: false,
  submissionType: "file",
  instructionsText: "",
  isGroup: false,
  cutoffAt: null,
  allowLate: false,
  materials: [],
  sessionRef: null,
  prereadPaths: [],
  ...over,
});

export const assignment = (over: Partial<OverviewAssignment> = {}): OverviewAssignment => ({
  id: "a1",
  title: "Assignment",
  course: "Course",
  courseSlug: null,
  weightPct: null,
  dueAt: null,
  hoursAway: null,
  status: "not-started",
  isClub: false,
  submissionType: "file",
  risk: 0,
  helpCommand: "/mesa:ares-brain-assignment-help",
  instructionsText: "",
  isGroup: false,
  cutoffAt: null,
  allowLate: false,
  materials: [],
  sessionRef: null,
  prereadPaths: [],
  ...over,
});

export const exam = (over: Partial<OverviewExam> = {}): OverviewExam => ({
  name: "Mid Term Exams",
  date: "2026-09-19",
  inDays: 11,
  courses: ["all"],
  courseNames: ["all"],
  coverageSessions: null,
  brainReady: false,
  testprepExists: false,
  testprepCommand: "/mesa:ares-brain-testprep",
  testprepCommands: [],
  ...over,
});

export const attendance = (over: Partial<OverviewAttendance> = {}): OverviewAttendance => ({
  course: "Course",
  courseSlug: "course",
  attended: 8,
  conducted: 9,
  nowPct: 88.8,
  avgCp: 0,
  sessionsLeftToMidterm: 4,
  sessionsLeftToEndterm: 8,
  bestCaseMidtermPct: 92,
  bestCaseEndtermPct: 94,
  floorEndtermPct: 47,
  state: "ok",
  atRisk: false,
  note: "",
  ...over,
});

export const brain = (over: Partial<OverviewBrain> = {}): OverviewBrain => ({
  course: "Course",
  courseSlug: "course",
  state: "ready",
  corpusBytes: 1000,
  sourceCount: 5,
  indexStale: false,
  guideBuiltAt: "2026-09-01",
  guideSourcesBehind: 0,
  pendingTranscripts: 0,
  reason: "up to date",
  buildCommand: "/mesa:ares-brain-course-brain",
  ...over,
});

export const gaps = (over: Partial<OverviewGaps> = {}): OverviewGaps => ({
  pendingTranscripts: [],
  missingBooks: [],
  scrapeStale: false,
  attendanceStale: false,
  ...over,
});

export const overview = (over: Partial<Overview> = {}): Overview => ({
  generatedAt: "2026-09-08T06:00:00Z",
  date: "2026-09-08",
  scrapeAgeHours: 2,
  term: "Term 1",
  kpis: kpis(),
  today: { classes: [], dueTodayOrTomorrow: [], changed: [] },
  thisWeek: [],
  assignments: [],
  gradePicture: [],
  exams: [],
  attendance: [],
  attendanceMin: 80,
  brain: [],
  chatUnlockAt: 5,
  gaps: gaps(),
  ...over,
});
