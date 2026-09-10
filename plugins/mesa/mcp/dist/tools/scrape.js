import { runScraper } from "../lib/python.js";
export function buildArgs(args = {}) {
    const argv = ["all"];
    if (args.course)
        argv.push("--course", args.course);
    if (args.force)
        argv.push("--force");
    return argv;
}
export const scrapeTool = {
    name: "scrape",
    description: "Pull all Term-1 course data (assignments, attendance, events, announcements, topics, materials, recordings) from the Mesa LMS onto disk under courses/<slug>/raw/. Refreshes and rotates the LMS token automatically.",
    inputSchema: {
        type: "object",
        properties: {
            course: { type: "string", description: "Optional course slug to scrape just one." },
            force: { type: "boolean", description: "Re-fetch cached topic lists." },
        },
    },
    async handler(args = {}) {
        const run = await runScraper(buildArgs(args));
        return run.error
            ? { ok: false, error: run.error }
            : { ok: run.ok, summary: run.summary, stderr: run.stderr.slice(-2000) };
    },
};
