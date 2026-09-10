import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { home, repoRootPath, loadApiConfig } from "../config.js";
import { listCourses, lastScrape, lastIngest, brains } from "../lib/paths.js";
/**
 * Resolve the Mesa refresh token the way the Python side does: read the
 * `MESA_REFRESH_TOKEN=` line from <home>/.env, then fall back to the env var.
 * Never returns anything but the token string to its callers; the value is
 * never logged.
 */
export function refreshToken() {
    const envFile = join(home(), ".env");
    if (existsSync(envFile)) {
        for (const line of readFileSync(envFile, "utf8").split("\n")) {
            if (line.startsWith("MESA_REFRESH_TOKEN=")) {
                return line.slice("MESA_REFRESH_TOKEN=".length).trim();
            }
        }
    }
    return (process.env.MESA_REFRESH_TOKEN || "").trim();
}
function decodeExp(jwt) {
    try {
        const payload = jwt.split(".")[1];
        if (!payload)
            return null;
        const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        return json.exp ? new Date(json.exp * 1000).toISOString() : null;
    }
    catch {
        return null;
    }
}
export const statusTool = {
    name: "status",
    description: "Report ares-brain config, token expiry, python sidecar health, and per-course file counts.",
    inputSchema: { type: "object", properties: {} },
    async handler(_args = {}) {
        let configLoaded = true;
        try {
            loadApiConfig();
        }
        catch {
            configLoaded = false;
        }
        const token = refreshToken();
        const venv = join(repoRootPath(), "scraper", ".venv", "bin", "python");
        return {
            home: home(),
            configLoaded,
            tokenPresent: token.length > 0,
            tokenExpiresAt: token ? decodeExp(token) : null,
            pythonSidecar: existsSync(venv) ? "ok" : "missing venv",
            courses: listCourses(),
            lastScrape: lastScrape(),
            lastIngest: lastIngest(),
            brains: brains(),
        };
    },
};
