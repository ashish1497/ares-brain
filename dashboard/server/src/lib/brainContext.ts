import { runPythonJSON } from "./python.js";
import type { Logger } from "./logger.js";

interface BrainQueryHit {
  path: string;
  course: string;
  type: string;
  title: string;
  snippet: string;
  score: number;
}

/** Best-effort: search the course's ingested corpus for `text`, then pull the
 * full body of the top few hits and hand it back as one prompt-ready block.
 * Never throws — a grounding lookup failing just means the agent falls back
 * to live web search alone for that call. */
export async function fetchBrainContext(
  course: string,
  text: string,
  opts: { limit?: number; maxCharsPerDoc?: number; maxDocs?: number; log?: Logger } = {},
): Promise<string> {
  const limit = opts.limit ?? 6;
  const maxCharsPerDoc = opts.maxCharsPerDoc ?? 1800;
  const maxDocs = opts.maxDocs ?? 3;
  const log = opts.log ?? (() => {});

  log(`Querying course brain for "${text}"…`);
  const queryResult = await runPythonJSON([
    "brain-query",
    "--params",
    JSON.stringify({ course, text, limit }),
    "--json",
  ]);
  if (!queryResult.ok) {
    log(`Brain query failed (${queryResult.error}) — continuing on live search alone.`);
    return "";
  }
  const hits = (queryResult.data as { results?: BrainQueryHit[] } | undefined)?.results ?? [];
  if (hits.length === 0) {
    log("Brain query: no matching course material found.");
    return "";
  }
  log(
    `Brain query: ${hits.length} match(es) — ${hits
      .slice(0, maxDocs)
      .map((h) => h.title)
      .join(", ")}${hits.length > maxDocs ? ", …" : ""}`,
  );

  const docs: string[] = [];
  for (const hit of hits.slice(0, maxDocs)) {
    const docResult = await runPythonJSON([
      "brain-get",
      "--course",
      course,
      "--path",
      hit.path,
      "--max-bytes",
      String(maxCharsPerDoc * 2), // bytes vs chars — generous, we truncate below anyway
      "--json",
    ]);
    if (!docResult.ok) continue;
    const body = (docResult.data as { body?: string } | undefined)?.body ?? "";
    if (!body) continue;
    const truncated = body.length > maxCharsPerDoc ? body.slice(0, maxCharsPerDoc) + "…" : body;
    docs.push(`### ${hit.title} (${hit.path})\n${truncated}`);
  }

  if (docs.length === 0) {
    // Query matched something but the docs themselves came back empty (e.g. a
    // link-only material) — still worth surfacing the titles as a pointer.
    log("Matched docs had no readable body (link-only material) — using titles as pointers.");
    return hits
      .slice(0, limit)
      .map((h) => `- ${h.title} (${h.type}): ${h.snippet}`)
      .join("\n");
  }
  log(`Pulled full text of ${docs.length} doc(s) from the brain into this step's prompt.`);
  return docs.join("\n\n");
}
