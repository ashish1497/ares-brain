import { runScraper } from "../lib/python.js";
export function buildBrainNextSessionArgs(course) {
    return ["next-session", "--course", course];
}
export const brainNextSessionTool = {
    name: "brain_next_session",
    description: "Resolve the next class session for a course: session number (from attendance), date/time (from events, else outline), the outline row, and the pre-read document paths.",
    inputSchema: {
        type: "object",
        properties: { course: { type: "string", description: "Course slug." } },
        required: ["course"],
    },
    async handler(args = {}) {
        if (!args.course)
            return { ok: false, error: "course slug required" };
        const run = await runScraper(buildBrainNextSessionArgs(args.course));
        return run.error
            ? { ok: false, error: run.error }
            : { ok: run.ok, summary: run.summary, stderr: run.stderr.slice(-2000) };
    },
};
