import { runScraper } from "../lib/python.js";

export function buildBrainQueryArgs(args: Record<string, unknown> = {}): string[] {
  return ["brain-query", "--params", JSON.stringify(args)];
}

export const brainQueryTool = {
  name: "brain_query",
  description:
    "Search a course's normalized corpus (or all courses). Filters: course (slug), type (material|assignment|session|outline|announcement|transcript|book|self-note|book-summary), sessionMin/sessionMax, dueBefore (ISO), text (full-text), limit. Returns ranked {path, course, type, session, title, due, snippet}. Auto-builds a missing index.",
  inputSchema: {
    type: "object",
    properties: {
      course: { type: "string" },
      type: { type: "string" },
      sessionMin: { type: "number" },
      sessionMax: { type: "number" },
      dueBefore: { type: "string" },
      text: { type: "string" },
      limit: { type: "number" },
    },
  } as const,
  async handler(args: Record<string, unknown> = {}) {
    // map camelCase → snake_case for the python kwargs
    const p: Record<string, unknown> = {};
    if (args.course) p.course = args.course;
    if (args.type) p.type = args.type;
    if (args.sessionMin !== undefined) p.session_min = args.sessionMin;
    if (args.sessionMax !== undefined) p.session_max = args.sessionMax;
    if (args.dueBefore) p.due_before = args.dueBefore;
    if (args.text) p.text = args.text;
    if (args.limit !== undefined) p.limit = args.limit;
    const run = await runScraper(buildBrainQueryArgs(p));
    return run.error
      ? { ok: false as const, error: run.error }
      : { ok: run.ok, summary: run.summary, stderr: run.stderr.slice(-2000) };
  },
};
