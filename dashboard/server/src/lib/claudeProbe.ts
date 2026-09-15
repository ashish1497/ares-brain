import { spawn } from "node:child_process";

const FAILURE_MARKERS = ["Not logged in", "revoked", "authentication_error"];

export function probeClaudeCli(timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const child = spawn("claude", ["-p", "/__ares_brain_setup_probe__"]);
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      finish(false);
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", () => {
      clearTimeout(t);
      finish(false);
    });
    child.on("close", () => {
      clearTimeout(t);
      finish(!FAILURE_MARKERS.some((m) => out.includes(m)));
    });
  });
}
