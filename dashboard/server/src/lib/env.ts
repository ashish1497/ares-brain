import { config as loadDotenv } from "dotenv";
import { join } from "node:path";
import { repoRoot } from "./repo.js";

let loaded = false;

/** Loads the repo-root .env into process.env exactly once (idempotent, safe
 * to call from any module that needs a key it defines). */
function ensureEnvLoaded(): void {
  if (loaded) return;
  loadDotenv({ path: join(repoRoot(), ".env") });
  loaded = true;
}

const PLACEHOLDER_KEYS = new Set(["your_key_here", "your_api_key_here", "changeme", ""]);

/** Every configured Gemini key, in order: GOOGLE_GEMINI_KEY first, then
 * GOOGLE_GEMINI_KEY_2, _3, ... — the same rotation set transcribe.py uses. */
export function getGeminiKeys(): string[] {
  ensureEnvLoaded();
  const keys: string[] = [];
  const primary = (process.env.GOOGLE_GEMINI_KEY ?? "").trim();
  if (primary && !PLACEHOLDER_KEYS.has(primary.toLowerCase())) keys.push(primary);
  for (let i = 2; ; i++) {
    const extra = (process.env[`GOOGLE_GEMINI_KEY_${i}`] ?? "").trim();
    if (!extra) break;
    if (!PLACEHOLDER_KEYS.has(extra.toLowerCase()) && !keys.includes(extra)) keys.push(extra);
  }
  return keys;
}

export function getGeminiModel(): string {
  ensureEnvLoaded();
  return process.env.GEMINI_MODEL || "gemini-3.6-flash";
}
