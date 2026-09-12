/** Scrapes a company's own website for published email addresses — the
 * "website ko scrape karna padega" step from class, done for real. Only
 * plain-text addresses actually sitting in the page HTML count; nothing is
 * invented or pattern-guessed. Best-effort: a site that blocks us, times
 * out, or has nothing to find just returns an empty string. */

import type { Logger } from "./logger.js";

const CANDIDATE_PATHS = [
  "",
  "/about",
  "/about-us",
  "/team",
  "/our-team",
  "/leadership",
  "/contact",
  "/contact-us",
  "/company",
];

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const NOISE_LOCAL_PARTS =
  /^(privacy|legal|noreply|no-reply|abuse|postmaster|webmaster|support|help|info|press|hello|hi|admin|security|dpo)@/i;

const FETCH_TIMEOUT_MS = 6000;
const MAX_HTML_BYTES = 300_000;
const MAX_PAGES_WITH_HITS = 4;

async function fetchPage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; AresBrainOutreachAgent/1.0)" },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html") && !contentType.includes("text")) return null;
    const text = await res.text();
    return text.slice(0, MAX_HTML_BYTES);
  } catch {
    return null; // timeout, DNS failure, TLS error, whatever — this is best-effort
  } finally {
    clearTimeout(timer);
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBaseUrl(website: string): string | null {
  let candidate = website.trim();
  if (!candidate) return null;
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  try {
    return new URL(candidate).origin;
  } catch {
    return null;
  }
}

/** Fetches a handful of likely pages from the company's site in parallel,
 * pulls out any real (non-generic) email addresses, and returns a compact
 * "URL → email + surrounding text" block ready to drop into a prompt — or
 * an empty string if nothing usable turned up. */
export async function scrapeCompanyEmails(
  website: string,
  log: Logger = () => {},
): Promise<string> {
  const base = normalizeBaseUrl(website);
  if (!base) {
    log(`Skipping website scrape — "${website}" isn't a usable URL.`);
    return "";
  }

  log(`Scraping ${CANDIDATE_PATHS.length} pages on ${base} for published emails…`);
  const pages = await Promise.all(
    CANDIDATE_PATHS.map(async (path) => {
      const url = base + path;
      const html = await fetchPage(url);
      if (!html) return null;
      const text = stripHtml(html);
      const found = Array.from(new Set(text.match(EMAIL_REGEX) ?? []));
      const real = found.filter((e) => !NOISE_LOCAL_PARTS.test(e));
      if (real.length === 0) return null;
      const contexts = real.slice(0, 10).map((email) => {
        const idx = text.indexOf(email);
        const start = Math.max(0, idx - 120);
        const end = Math.min(text.length, idx + email.length + 120);
        return `"${email}" — surrounding text: …${text.slice(start, end)}…`;
      });
      return { url, emails: real, block: `### ${url}\n${contexts.join("\n")}` };
    }),
  );

  const hits = pages.filter(
    (p): p is { url: string; emails: string[]; block: string } => p !== null,
  );
  if (hits.length === 0) {
    log(`Scrape complete — no plain-text emails found on ${base}.`);
    return "";
  }
  log(
    `Scrape complete — found ${hits.reduce((n, h) => n + h.emails.length, 0)} email(s) across ${hits.length} page(s): ${hits.map((h) => h.url).join(", ")}`,
  );
  return hits
    .slice(0, MAX_PAGES_WITH_HITS)
    .map((p) => p.block)
    .join("\n\n");
}
