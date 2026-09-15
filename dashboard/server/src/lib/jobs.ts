import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { runPython } from "./python.js";
import { runClaude } from "./claudeRunner.js";
import { log } from "./log.js";

export class BusyError extends Error {}

export type JobKind =
  | "sync"
  | "calendar-sync"
  | "ingest"
  | "transcribe"
  | "transcribe-url"
  | "transcribe-inbox"
  | "chat";

export interface Job {
  id: string;
  kind: JobKind;
  course?: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  log: string[];
}

export interface StartOpts {
  kind: JobKind;
  course?: string;
  url?: string;
  title?: string;
  message?: string;
}

const LOG_CAP = 2000;
const bus = new EventEmitter();
let current: Job | null = null;
let kill: () => void = () => {};
const lastRuns: Record<string, { finishedAt: string; exitCode: number }> = {};

function argv(o: StartOpts): string[] {
  switch (o.kind) {
    case "sync":
      return ["all"];
    case "calendar-sync":
      return ["calendar-sync"];
    case "ingest":
      return o.course ? ["ingest", "--course", o.course] : ["ingest"];
    case "transcribe":
      return ["transcribe", "--course", o.course!, "--json"];
    case "transcribe-inbox":
      return ["transcribe", "--course", o.course!, "--inbox", "--json"];
    case "transcribe-url":
      return [
        "transcribe-url",
        "--course",
        o.course!,
        "--url",
        o.url!,
        ...(o.title ? ["--title", o.title] : []),
        "--json",
      ];
    case "chat":
      // unreachable: startJob branches to runClaude before argv() is called for "chat"; arm exists only for exhaustiveness.
      return [];
  }
}

export function currentJob(): Job | null {
  return current;
}
export function lastRunMap() {
  return lastRuns;
}
export function onLine(fn: (line: string) => void) {
  bus.on("line", fn);
  return () => bus.off("line", fn);
}
export function onEnd(fn: (j: Job) => void) {
  bus.on("end", fn);
  return () => bus.off("end", fn);
}

export function startJob(o: StartOpts): Job {
  if (current?.status === "running") throw new BusyError("a job is already running");
  const job: Job = {
    id: randomUUID(),
    kind: o.kind,
    course: o.course,
    status: "running",
    startedAt: new Date().toISOString(),
    log: [],
  };
  current = job;
  const detail =
    o.kind === "chat"
      ? `"${(o.message ?? "").slice(0, 80)}"`
      : o.course
        ? `course=${o.course}`
        : o.url
          ? `url=${o.url}`
          : "";
  log("job", `start ${job.id} kind=${job.kind}${detail ? " " + detail : ""}`);
  const push = (l: string) => {
    job.log.push(l);
    if (job.log.length > LOG_CAP) job.log.splice(0, job.log.length - LOG_CAP);
    bus.emit("line", l);
  };
  const handle = o.kind === "chat" ? runClaude(o.message ?? "", push) : runPython(argv(o), push);
  kill = handle.kill;
  const startedMs = Date.now();
  handle.done.then(({ code }) => {
    job.status = code === 0 ? "done" : "failed";
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    lastRuns[job.kind] = { finishedAt: job.finishedAt, exitCode: code };
    log(
      "job",
      `end ${job.id} kind=${job.kind} status=${job.status} exitCode=${code} (${Date.now() - startedMs}ms)`,
    );
    bus.emit("end", job);
  });
  return job;
}

export function killCurrent() {
  if (current?.status === "running") kill();
}

/** Test-only: how many line/end listeners are currently on the bus. */
export function _listenerCounts() {
  return { line: bus.listenerCount("line"), end: bus.listenerCount("end") };
}

/** Test-only: clear the in-process singleton between test cases. */
export function _resetForTest() {
  current = null;
  kill = () => {};
  for (const k of Object.keys(lastRuns)) delete lastRuns[k];
  bus.removeAllListeners();
}
