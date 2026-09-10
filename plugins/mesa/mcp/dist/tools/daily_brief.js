import { runScraper } from "../lib/python.js";
export function buildDailyBriefArgs(args = {}) {
    const out = ["daily-brief"];
    if (typeof args.withinHours === "number")
        out.push("--within-hours", String(args.withinHours));
    if (typeof args.changedSinceHours === "number")
        out.push("--changed-since-hours", String(args.changedSinceHours));
    return out;
}
export const dailyBriefTool = {
    name: "daily_brief",
    description: "Deterministic morning-brief data: today's classes + pre-read paths, assignments " +
        "due within a window (default 72h), and which normalized docs changed since the " +
        "last scrape (default 26h). Reads courses/ off disk; no LMS auth, no LLM.",
    inputSchema: {
        type: "object",
        properties: {
            withinHours: { type: "number", description: "assignment due-date horizon, default 72" },
            changedSinceHours: { type: "number", description: "'what changed' lookback, default 26" },
        },
    },
    async handler(args = {}) {
        const run = await runScraper(buildDailyBriefArgs(args));
        return run.error
            ? { ok: false, error: run.error }
            : { ok: run.ok, brief: run.summary, stderr: run.stderr.slice(-2000) };
    },
};
