import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { home, repoRootPath } from "../config.js";
export function venvPython() {
    return join(repoRootPath(), "scraper", ".venv", "bin", "python");
}
export function parseSummaryLine(stdout) {
    const lines = stdout
        .trim()
        .split("\n")
        .filter((l) => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
        const t = lines[i].trim();
        if (t.startsWith("{")) {
            try {
                return JSON.parse(t);
            }
            catch {
                /* keep scanning up */
            }
        }
    }
    return null;
}
export function runScraper(args) {
    const py = venvPython();
    if (process.env.CA_FAKE_NO_VENV === "1" || !existsSync(py)) {
        return Promise.resolve({
            ok: false,
            summary: null,
            stdout: "",
            stderr: "",
            error: "python sidecar not set up — run: cd scraper && uv venv --python 3.12 .venv && uv pip install -r requirements.txt",
        });
    }
    return new Promise((resolve) => {
        const child = spawn(py, ["lms_scrape.py", ...args, "--json"], {
            cwd: join(repoRootPath(), "scraper"),
            env: { ...process.env, ARES_BRAIN_HOME: home() },
        });
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        let out = "";
        let err = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (err += d));
        child.on("error", (e) => {
            resolve({ ok: false, summary: null, stdout: out, stderr: err + String(e), error: String(e) });
        });
        child.on("close", (code) => {
            const summary = parseSummaryLine(out);
            resolve({ ok: code === 0 && summary !== null, summary, stdout: out, stderr: err });
        });
    });
}
