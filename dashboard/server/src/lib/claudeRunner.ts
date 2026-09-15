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
// fire-and-forget daily/evening jobs. Read(config/**) added for the
// mock-midterm skill, which reads config/midterm-exam-format.md — a
// hand-captured reference (exam format was emailed, not scraped from LMS).
const ALLOWED_TOOLS = [
  "Bash(cd:*)",
  "Bash(uv run python lms_scrape.py:*)",
  "Write(courses/**)",
  "Read(courses/**)",
  "Read(config/**)",
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
    [
      "-p",
      message,
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      ALLOWED_TOOLS,
      "--output-format",
      "stream-json",
      "--verbose",
    ],
    { cwd: repoRoot(), env: { ...process.env } },
  );
  const startedMs = Date.now();
  // stream-json emits one JSON object per line describing the harness's
  // internal turns (assistant/user/tool/system/result). Only forward the
  // text content of assistant messages to chat — anything else (including
  // an internal auto-compaction turn) must never reach the raw-text pipe
  // a bare stdout passthrough used to hand straight to the SSE stream.
  let buf = "";
  let sawOutput = false;
  const pump = (chunk: Buffer) => {
    buf += chunk.toString("utf8");
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const l of parts) {
      if (!l.trim()) continue;
      let evt: any;
      try {
        evt = JSON.parse(l);
      } catch {
        log("claude", `non-JSON stream line ignored: ${l.slice(0, 200)}`);
        continue;
      }
      if (evt.type === "assistant" && evt.message?.content) {
        for (const block of evt.message.content) {
          if (block.type === "text" && block.text) {
            sawOutput = true;
            onLine(block.text);
          }
        }
      } else if (evt.type === "result" && evt.is_error) {
        sawOutput = true;
        onLine(`error: ${evt.result ?? "unknown error"}`);
      }
    }
  };
  child.stdout.on("data", pump);
  // The CLI writes plain-text failures here BEFORE any stream-json ever
  // reaches stdout — auth errors, missing binaries, etc. Keep the last
  // chunk so a silent nonzero exit (sawOutput still false) has something
  // to surface to chat instead of the job just hanging forever.
  let lastStderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    lastStderr = text.trim() || lastStderr;
    log("claude", `stderr: ${text.slice(0, 500)}`);
  });
  const done = new Promise<{ code: number }>((res) => {
    child.on("error", (e) => {
      log("claude", `pid=${child.pid} spawn error: ${e}`);
      onLine(`spawn error: ${e}`);
      res({ code: 1 });
    });
    child.on("close", (code) => {
      log("claude", `pid=${child.pid} exited code=${code} (${Date.now() - startedMs}ms)`);
      if (buf.trim()) log("claude", `trailing unparsed chunk dropped: ${buf.slice(0, 200)}`);
      if (!sawOutput && (code ?? 0) !== 0) {
        onLine(`error: ${lastStderr || `claude exited with code ${code}`}`);
      }
      res({ code: code ?? 0 });
    });
  });
  log("claude", `spawned pid=${child.pid}`);
  return { done, kill: () => child.kill("SIGTERM") };
}
