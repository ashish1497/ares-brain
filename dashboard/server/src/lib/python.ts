import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, venvPython } from "./repo.js";

export function runPython(
  args: string[],
  onLine: (line: string) => void,
): { done: Promise<{ code: number }>; kill: () => void } {
  const py = venvPython();
  if (!existsSync(py)) {
    onLine(
      "python sidecar missing — run: cd scraper && uv venv --python 3.12 .venv && uv pip install -r requirements.txt",
    );
    return { done: Promise.resolve({ code: 127 }), kill: () => {} };
  }
  const child = spawn(py, ["lms_scrape.py", ...args], {
    cwd: join(repoRoot(), "scraper"),
    env: { ...process.env, ARES_BRAIN_HOME: repoRoot() },
  });
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
