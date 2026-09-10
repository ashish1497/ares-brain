import { runScraper } from "../lib/python.js";
export function buildIngestArgs(args = {}) {
    const argv = ["ingest"];
    if (args.course)
        argv.push("--course", args.course);
    return argv;
}
export const ingestTool = {
    name: "ingest",
    description: "Normalize the scraped raw/ tree plus dropped inbox/ files into courses/<slug>/normalized/*.md, the corpus the course brain will use. Idempotent: re-processes only changed sources, deletes orphans.",
    inputSchema: {
        type: "object",
        properties: { course: { type: "string", description: "Optional course slug." } },
    },
    async handler(args = {}) {
        const run = await runScraper(buildIngestArgs(args));
        return run.error
            ? { ok: false, error: run.error }
            : { ok: run.ok, summary: run.summary, stderr: run.stderr.slice(-2000) };
    },
};
