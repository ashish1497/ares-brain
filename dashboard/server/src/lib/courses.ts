import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./repo.js";

export function readCourses(): { slug: string; name: string }[] {
  try {
    const raw = JSON.parse(readFileSync(join(repoRoot(), "courses", "_index.json"), "utf8"));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((c) => c && typeof c.slug === "string")
      .map((c) => ({ slug: c.slug, name: c.name ?? c.slug }));
  } catch {
    return [];
  }
}
