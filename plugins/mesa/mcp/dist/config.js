import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export function home() {
    return process.env.ARES_BRAIN_HOME || repoRoot;
}
export function loadApiConfig() {
    // Mirror the Python load_config() precedence: <home>/config/mesa-api.json
    // wins over the repo copy.
    const local = join(home(), "config", "mesa-api.json");
    const path = existsSync(local) ? local : join(repoRoot, "config", "mesa-api.json");
    return JSON.parse(readFileSync(path, "utf8"));
}
export function repoRootPath() {
    // Installed Codex/Claude plugin bundles may run from a cache directory.
    // Keep the user's checked-out corpus and Python sidecar as the source of truth.
    return process.env.ARES_BRAIN_HOME || repoRoot;
}
