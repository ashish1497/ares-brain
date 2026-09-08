import { runScraper } from "../lib/python.js";

export function buildBrainNextSessionArgs(course: string): string[] {
  return ["next-session", "--course", course];
}

export const brainNextSessionTool = {
  name: "brain_next_session",
  description:
    "Resolve the next class session for a course: session number (from attendance), date/time (from events, else outline), the outline row, and the pre-read document paths.",
  inputSchema: {
    type: "object",
    properties: { course: { type: "string", description: "Course slug." } },
    required: ["course"],
  } as const,
  async handler(args: { course?: string } = {}) {
    if (!args.course) return { ok: false as const, error: "course slug required" };
    const run = await runScraper(buildBrainNextSessionArgs(args.course));
    return run.error
      ? { ok: false as const, error: run.error }
      : { ok: run.ok, summary: run.summary, stderr: run.stderr.slice(-2000) };
  },
};
