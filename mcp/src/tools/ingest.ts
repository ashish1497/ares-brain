import { runScraper } from "../lib/python.js";

export function buildIngestArgs(args: { course?: string } = {}): string[] {
  const argv = ["ingest"];
  if (args.course) argv.push("--course", args.course);
  return argv;
}

export const ingestTool = {
  name: "ingest",
  description:
    "Normalize the scraped raw/ tree plus dropped inbox/ files into courses/<slug>/normalized/*.md, the corpus the course brain will use. Idempotent: re-processes only changed sources, deletes orphans.",
  inputSchema: {
    type: "object",
    properties: { course: { type: "string", description: "Optional course slug." } },
  } as const,
  async handler(args: { course?: string } = {}) {
    const run = await runScraper(buildIngestArgs(args));
    return run.error
      ? { ok: false as const, error: run.error }
      : { ok: run.ok, summary: run.summary, stderr: run.stderr.slice(-2000) };
  },
};
