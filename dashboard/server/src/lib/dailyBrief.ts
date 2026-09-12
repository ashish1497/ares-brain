/** Serves the `daily/<date>.md` / `daily/<date>-evening.md` digest files the
 * course-daily / course-evening skills write. Read-only, no LMS auth. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "./repo.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Machine-local date, matching the skills' filename convention. */
function localDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export interface DailyBriefResult {
  date: string;
  morning: string | null;
  evening: string | null;
}

/** `date` must be `YYYY-MM-DD`; anything else falls back to today (local). */
export async function readDailyBrief(date?: string | null): Promise<DailyBriefResult> {
  const d = date && DATE_RE.test(date) ? date : localDate();
  const dir = join(repoRoot(), "daily");
  const [morning, evening] = await Promise.all([
    readIfExists(join(dir, `${d}.md`)),
    readIfExists(join(dir, `${d}-evening.md`)),
  ]);
  return { date: d, morning, evening };
}
