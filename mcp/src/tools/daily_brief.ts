import { runScraper } from "../lib/python.js";

export function buildDailyBriefArgs(
  args: {
    withinHours?: number;
    changedSinceHours?: number;
    includeTomorrow?: boolean;
  } = {},
): string[] {
  const out = ["daily-brief"];
  if (typeof args.withinHours === "number") out.push("--within-hours", String(args.withinHours));
  if (typeof args.changedSinceHours === "number")
    out.push("--changed-since-hours", String(args.changedSinceHours));
  if (args.includeTomorrow) out.push("--include-tomorrow");
  return out;
}

export const dailyBriefTool = {
  name: "daily_brief",
  description:
    "Deterministic brief data: today's classes + pre-read paths, assignments " +
    "due within a window (default 72h), overdue unsubmitted assignments (48h lookback), " +
    "and which normalized docs changed since the last scrape (default 26h). Pass " +
    "includeTomorrow for an evening check (adds tomorrow's classes). Reads courses/ " +
    "off disk; no LMS auth, no LLM.",
  inputSchema: {
    type: "object",
    properties: {
      withinHours: { type: "number", description: "assignment due-date horizon, default 72" },
      changedSinceHours: { type: "number", description: "'what changed' lookback, default 26" },
      includeTomorrow: {
        type: "boolean",
        description: "also return classesTomorrow, for the evening check",
      },
    },
  } as const,
  async handler(
    args: { withinHours?: number; changedSinceHours?: number; includeTomorrow?: boolean } = {},
  ) {
    const run = await runScraper(buildDailyBriefArgs(args));
    return run.error
      ? { ok: false as const, error: run.error }
      : { ok: run.ok, brief: run.summary, stderr: run.stderr.slice(-2000) };
  },
};
