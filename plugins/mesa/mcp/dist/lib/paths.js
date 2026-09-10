import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { home } from "../config.js";
export function coursesRoot() {
    return join(home(), "courses");
}
function countDir(p) {
    if (!existsSync(p))
        return 0;
    let n = 0;
    for (const e of readdirSync(p, { withFileTypes: true })) {
        if (e.isFile())
            n++;
        else if (e.isDirectory())
            n += countDir(join(p, e.name));
    }
    return n;
}
export function listCourses() {
    const root = coursesRoot();
    if (!existsSync(root))
        return [];
    const out = [];
    for (const e of readdirSync(root, { withFileTypes: true })) {
        if (!e.isDirectory() || e.name.startsWith("_"))
            continue;
        const c = join(root, e.name);
        out.push({
            slug: e.name,
            counts: {
                raw: countDir(join(c, "raw")),
                inbox: countDir(join(c, "inbox")),
                transcripts: countDir(join(c, "transcripts")),
                normalized: countDir(join(c, "normalized")),
            },
        });
    }
    return out;
}
export function lastIngest() {
    const root = coursesRoot();
    if (!existsSync(root))
        return null;
    let latest = null;
    for (const e of readdirSync(root, { withFileTypes: true })) {
        if (!e.isDirectory() || e.name.startsWith("_"))
            continue;
        const f = join(root, e.name, "normalized", "_ingest.json");
        if (!existsSync(f))
            continue;
        try {
            const at = JSON.parse(readFileSync(f, "utf8")).ingestedAt;
            if (at && (!latest || at > latest))
                latest = at;
        }
        catch {
            /* skip */
        }
    }
    return latest;
}
export function brains() {
    const root = coursesRoot();
    if (!existsSync(root))
        return [];
    const out = [];
    for (const e of readdirSync(root, { withFileTypes: true })) {
        if (!e.isDirectory() || e.name.startsWith("_"))
            continue;
        const f = join(root, e.name, "brain", "_brain.json");
        if (!existsSync(f))
            continue;
        try {
            const j = JSON.parse(readFileSync(f, "utf8"));
            out.push({
                slug: e.name,
                indexBuiltAt: j.indexBuiltAt ?? null,
                guideBuiltAt: j.guideBuiltAt ?? null,
            });
        }
        catch {
            /* skip */
        }
    }
    return out;
}
export function lastScrape() {
    const meta = join(coursesRoot(), "_meta.json");
    if (!existsSync(meta))
        return null;
    try {
        const j = JSON.parse(readFileSync(meta, "utf8"));
        if (j.scrapedAt)
            return j.scrapedAt;
    }
    catch {
        /* fall through */
    }
    return statSync(meta).mtime.toISOString();
}
