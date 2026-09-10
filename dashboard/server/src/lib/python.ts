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
    env: { ...process.env, ARES_BRAIN_HOME: repoRoot(), PYTHONUNBUFFERED: "1" },
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

export function runPythonJSON(
  args: string[],
  timeoutMs = 15000,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const py = venvPython();
  if (!existsSync(py)) return Promise.resolve({ ok: false, error: "python sidecar not set up" });
  return new Promise((resolve) => {
    const child = spawn(py, ["lms_scrape.py", ...args], {
      cwd: join(repoRoot(), "scraper"),
      env: { ...process.env, ARES_BRAIN_HOME: repoRoot(), PYTHONUNBUFFERED: "1" },
    });
    let out = "";
    let err = "";
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ ok: false, error: "timeout" });
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({ ok: false, error: String(e) });
    });
    child.on("close", (code) => {
      clearTimeout(t);
      const line = out
        .trim()
        .split("\n")
        .reverse()
        .find((l) => l.trim().startsWith("{"));
      if (code === 0 && line) {
        try {
          return resolve({ ok: true, data: JSON.parse(line) });
        } catch {
          /* fall */
        }
      }
      resolve({ ok: false, error: err.slice(-500) || `exit ${code}` });
    });
  });
}
