import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface ApiConfig {
  baseUrl: string;
  frontendBase: string;
  authRefresh: string;
  termIdOverride: string | null;
  eventsWindowDays: number;
  announcementsMaxPages: number;
  endpoints: Record<string, string>;
}

export function home(): string {
  return process.env.ARES_BRAIN_HOME || repoRoot;
}

export function loadApiConfig(): ApiConfig {
  // Mirror the Python load_config() precedence: <home>/config/mesa-api.json
  // wins over the repo copy.
  const local = join(home(), "config", "mesa-api.json");
  const path = existsSync(local) ? local : join(repoRoot, "config", "mesa-api.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

export function repoRootPath(): string {
  return repoRoot;
}
