import { spawn } from "node:child_process";
import { repoRoot } from "./repo.js";

const ALLOWED_TOOLS = [
  "Bash(cd:*)",
  "Bash(uv run python lms_scrape.py:*)",
  "Write(daily/**)",
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
  const child = spawn(
    "claude",
    ["-p", message, "--permission-mode", "acceptEdits", "--allowedTools", ALLOWED_TOOLS],
    { cwd: repoRoot(), env: { ...process.env } },
  );
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
      onLine(`spawn error: ${e}`);
      res({ code: 1 });
    });
    child.on("close", (code) => {
      if (buf) onLine(buf);
      res({ code: code ?? 0 });
    });
  });
  return { done, kill: () => child.kill("SIGTERM") };
}
