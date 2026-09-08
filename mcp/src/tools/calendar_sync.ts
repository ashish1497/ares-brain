import { runScraper } from "../lib/python.js";

export function buildCalendarSyncArgs(args: { dryRun?: boolean } = {}): string[] {
  const argv = ["calendar-sync"];
  if (args.dryRun) argv.push("--dry-run");
  return argv;
}

export const calendarSyncTool = {
  name: "calendar_sync",
  description:
    "Sync unsubmitted assignment due dates, late-cutoff dates, club-assignment deadlines, and exam events to a dedicated 'Mesa Assignments' Google Calendar (creates it if absent). Full reconcile: creates new, updates changed, deletes submitted/past/removed. Each event gets a popup reminder 24h and 2h before. Pass dryRun to preview without writing. Needs gcloud ADC with the calendar scope.",
  inputSchema: {
    type: "object",
    properties: {
      dryRun: { type: "boolean", description: "Preview the plan without touching the calendar." },
    },
  } as const,
  async handler(args: { dryRun?: boolean } = {}) {
    const run = await runScraper(buildCalendarSyncArgs(args));
    return run.error
      ? { ok: false as const, error: run.error }
      : // google auth tracebacks carry no token material (reviewer verified) — safe to surface
        { ok: run.ok, summary: run.summary, stderr: run.stderr.slice(-2000) };
  },
};
