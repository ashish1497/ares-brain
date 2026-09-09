import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function repoRoot(): string {
  if (process.env.ARES_BRAIN_HOME) return resolve(process.env.ARES_BRAIN_HOME);
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "scraper", "lms_scrape.py"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

export function venvPython(): string {
  return join(repoRoot(), "scraper", ".venv", "bin", "python");
}
