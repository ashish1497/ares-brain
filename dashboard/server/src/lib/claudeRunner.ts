import { spawn } from "node:child_process";
import { repoRoot } from "./repo.js";
import { log } from "./log.js";

// Mirrors the daily/evening launchd jobs' proven --allowedTools pattern (see
// commands/ares-brain-daily-setup.md's plist ProgramArguments) as closely as
// makes sense for the interactive chat context: same Bash(cd:*) +
// Bash(uv run python lms_scrape.py:*) PAIR (cd:* alone grants nothing without
// the scraper-invocation entry after it) and the same Read(courses/**), but
// drops daily-only entries that don't apply to chat — Bash(osascript:*) (mac
// notifications) and Write(daily/**) (the daily-brief file chat never
// writes). Write(courses/**) and the extra brain_* query/read MCP tools stay:
// chat is interactive Q&A over the corpus and needs them, unlike the
// fire-and-forget daily/evening jobs.
const ALLOWED_TOOLS = [
  "Bash(cd:*)",
  "Bash(uv run python lms_scrape.py:*)",
  "Write(courses/**)",
  "Read(courses/**)",
  "mcp__plugin_mesa_mesa__daily_brief",
  "mcp__plugin_mesa_mesa__brain_query",
  "mcp__plugin_mesa_mesa__brain_get",
  "mcp__plugin_mesa_mesa__brain_next_session",
  "mcp__plugin_mesa_mesa__brain_status",
  "mcp__plugin_mesa_mesa__calendar_sync",
  "mcp__plugin_mesa_mesa__scrape",
  "mcp__plugin_mesa_mesa__ingest",
].join(",");

export function runClaude(
  message: string,
  onLine: (line: string) => void,
): { done: Promise<{ code: number }>; kill: () => void } {
  log("claude", `spawning: claude -p "${message.slice(0, 80)}"`);
  const child = spawn(
    "claude",
    ["-p", message, "--permission-mode", "acceptEdits", "--allowedTools", ALLOWED_TOOLS],
    { cwd: repoRoot(), env: { ...process.env } },
  );
  const startedMs = Date.now();
  let buf = "";
  const pump = (chunk: Buffer) => {
    buf += chunk.toString("utf8");
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const l of parts) onLine(l);
  };
  child.stdout.on("data", pump);
  child.stderr.on("data", pump);
  const done = new Promise<{ code: number }>((res) => {
    child.on("error", (e) => {
      log("claude", `pid=${child.pid} spawn error: ${e}`);
      onLine(`spawn error: ${e}`);
      res({ code: 1 });
    });
    child.on("close", (code) => {
      log("claude", `pid=${child.pid} exited code=${code} (${Date.now() - startedMs}ms)`);
      if (buf) onLine(buf);
      res({ code: code ?? 0 });
    });
  });
  log("claude", `spawned pid=${child.pid}`);
  return { done, kill: () => child.kill("SIGTERM") };
}
