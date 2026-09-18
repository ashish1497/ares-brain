import { spawn } from "node:child_process";
import { log } from "./log.js";

const FAILURE_MARKERS = ["Not logged in", "revoked", "authentication_error"];

export function probeClaudeCli(timeoutMs = 10000): Promise<boolean> {
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const child = spawn("claude", ["-p", "/__ares_brain_setup_probe__"]);
    log("probe", `spawned pid=${child.pid}`);
    const t = setTimeout(() => {
      log("probe", `pid=${child.pid} timed out after ${timeoutMs}ms — killing`);
      child.kill("SIGTERM");
      finish(false);
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (e) => {
      log("probe", `pid=${child.pid} spawn error: ${e}`);
      clearTimeout(t);
      finish(false);
    });
    child.on("close", () => {
      clearTimeout(t);
      const ok = !FAILURE_MARKERS.some((m) => out.includes(m));
      log("probe", `pid=${child.pid} closed -> ${ok ? "logged in" : "NOT logged in"}`);
      finish(ok);
    });
  });
}
