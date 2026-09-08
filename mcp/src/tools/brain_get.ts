import { runScraper } from "../lib/python.js";

export function buildBrainGetArgs(
  args: { course?: string; path?: string; maxBytes?: number } = {},
): string[] {
  const a = ["brain-get", "--course", String(args.course ?? ""), "--path", String(args.path ?? "")];
  if (args.maxBytes !== undefined) a.push("--max-bytes", String(args.maxBytes));
  return a;
}

export const brainGetTool = {
  name: "brain_get",
  description:
    "Fetch the text (frontmatter + body) of one normalized course document by its path (e.g. 'normalized/material-x.md' or 'material-x.md'). Use after brain_query to read a hit in full. Path is confined to the course's normalized/ directory. Body is truncated to maxBytes (default 20000) with an explicit marker; pass a larger maxBytes to read more.",
  inputSchema: {
    type: "object",
    properties: {
      course: { type: "string", description: "Course slug." },
      path: { type: "string", description: "Doc path under the course's normalized/." },
      maxBytes: { type: "number", description: "Body byte cap before truncation (default 20000)." },
    },
    required: ["course", "path"],
  } as const,
  async handler(args: { course?: string; path?: string; maxBytes?: number } = {}) {
    if (!args.course || !args.path)
      return { ok: false as const, error: "course and path required" };
    const run = await runScraper(buildBrainGetArgs(args));
    return run.error
      ? { ok: false as const, error: run.error }
      : { ok: run.ok, summary: run.summary, stderr: run.stderr.slice(-2000) };
  },
};
