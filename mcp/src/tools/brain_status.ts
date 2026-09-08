import { runScraper } from "../lib/python.js";

export function buildBrainStatusArgs(course?: string): string[] {
  return course ? ["brain-status", "--course", course] : ["brain-status"];
}

export const brainStatusTool = {
  name: "brain_status",
  description:
    "Report brain index/guide freshness for a course (or all courses): corpusBytes, sourceCount, indexBuiltAt, indexStale, guideBuiltAt, guideSourcesBehind, embeddingsRecommended.",
  inputSchema: {
    type: "object",
    properties: { course: { type: "string", description: "Course slug." } },
  } as const,
  async handler(args: { course?: string } = {}) {
    const run = await runScraper(buildBrainStatusArgs(args.course));
    return run.error
      ? { ok: false as const, error: run.error }
      : { ok: run.ok, summary: run.summary, stderr: run.stderr.slice(-2000) };
  },
};
