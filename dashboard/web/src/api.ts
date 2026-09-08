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

const j = (r: Response) => r.json();

export const getCourses = (): Promise<Course[]> => fetch("/api/courses").then(j);
export const getState = (): Promise<State> => fetch("/api/state").then(j);

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
): () => void {
  const es = new EventSource(`/api/jobs/${jobId}/log`);
  es.onmessage = (e) => onLine(JSON.parse(e.data));
  es.addEventListener("end", (e) => {
    onEnd(JSON.parse((e as MessageEvent).data).exitCode);
    es.close();
  });
  es.onerror = () => es.close();
  return () => es.close();
}
