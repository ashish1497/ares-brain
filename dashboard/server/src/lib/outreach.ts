/** Outreach/GTM agent — the Art of Selling AI Agent Workshops 1 & 2, automated.
 *
 * Matches the actual workshop spec (courses/the-art-of-selling.../
 * art_of_selling_outreach_agent.html), not just the professor's live
 * narration: five research steps each tagged verified/assertion, an
 * independent grading pass that produces a DO NOT USE list, and outreach
 * that is banned from repeating anything on that list.
 *
 * Grounded two ways: live Google Search, and the course's own ingested
 * brain (case one-pagers, session transcripts) when relevant material
 * exists there — the brain wins when both speak to the same fact.
 *
 * Every step returns structured JSON and is stored per-section by the
 * caller — there is no single locked "personalization pack" object. Any
 * step can be edited by hand or re-run alone. Every step also returns
 * `_log`: a line-by-line trace of what it actually did (brain lookups,
 * website scrapes, which Gemini key answered), not just a spinner.
 */

import { GoogleGenAI } from "@google/genai";
import { getGeminiKeys, getGeminiModel } from "./env.js";
import { fetchBrainContext } from "./brainContext.js";
import { scrapeCompanyEmails } from "./webScrape.js";
import type { Logger } from "./logger.js";

export const AOS_COURSE_SLUG = "the-art-of-selling-with-prof-rishabh-ladha";
export const AOS_COURSE_NAME = "The Art of Selling with Prof. Rishabh Ladha";

export class UserFacingError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

interface GroundedSource {
  label: string;
  url: string;
}

type GroundedResult = Record<string, unknown> & { _sources: GroundedSource[]; _log: string[] };

// ---------------------------------------------------------------------------
// JSON extraction — Gemini doesn't always return bare JSON even when asked.
// ---------------------------------------------------------------------------

/** Escapes literal control characters found inside JSON string literals
 * (Gemini occasionally emits a raw newline instead of `\n`). JS's JSON.parse
 * has no lenient mode for this — unlike Python's `json.loads(strict=False)`
 * — so this walks the text tracking string boundaries and escapes as it goes. */
function escapeStrayControlChars(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString && !escaped && ch === "\\") {
      escaped = true;
      out += ch;
      continue;
    }
    if (!escaped && ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString && !escaped) {
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        if (ch === "\n") out += "\\n";
        else if (ch === "\r") out += "\\r";
        else if (ch === "\t") out += "\\t";
        else out += "\\u" + code.toString(16).padStart(4, "0");
        continue;
      }
    }
    out += ch;
    escaped = false;
  }
  return out;
}

function extractJson(text: string): Record<string, unknown> {
  let t = text.trim();
  const fenced = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/.exec(t);
  if (fenced) {
    t = fenced[1];
  } else {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) t = t.slice(start, end + 1);
  }
  try {
    return JSON.parse(t);
  } catch {
    try {
      return JSON.parse(escapeStrayControlChars(t));
    } catch {
      throw new UserFacingError(
        "The model's response wasn't valid JSON. Try regenerating this step.",
        502,
      );
    }
  }
}

function sourcesFromResponse(response: {
  candidates?: Array<{
    groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> };
  }>;
}): GroundedSource[] {
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  const out: GroundedSource[] = [];
  for (const chunk of chunks) {
    const uri = chunk.web?.uri;
    if (uri && !seen.has(uri)) {
      seen.add(uri);
      out.push({ label: chunk.web?.title || uri, url: uri });
    }
  }
  return out;
}

function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("RESOURCE_EXHAUSTED") || msg.includes("429");
}

/** Tries every configured key in order, moving on only when the failure is a
 * quota error — anything else (a network blip, a bad prompt) surfaces right
 * away instead of silently burning through the rest of the keys. */
async function runWithRotation(prompt: string, log: Logger = () => {}): Promise<GroundedResult> {
  const keys = getGeminiKeys();
  if (keys.length === 0) {
    throw new UserFacingError(
      "No Gemini API key found. Set GOOGLE_GEMINI_KEY in the repo's .env, then restart the dashboard server.",
      500,
    );
  }

  const model = getGeminiModel();
  for (let i = 0; i < keys.length; i++) {
    try {
      log(`Calling Gemini (${model}, Google Search grounding on) — key ${i + 1}/${keys.length}…`);
      const ai = new GoogleGenAI({ apiKey: keys[i] });
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          temperature: 0.4,
          maxOutputTokens: 16384,
          // Cap thinking tokens — an uncapped budget on a long, multi-field
          // JSON schema prompt was eating the entire output budget on
          // reasoning and returning empty text (finishReason: MAX_TOKENS)
          // before writing a single character of the actual answer.
          thinkingConfig: { thinkingBudget: 1024 },
        },
      });
      const text = response.text;
      if (!text) {
        throw new UserFacingError(
          "Gemini returned an empty response. Try regenerating this step.",
          502,
        );
      }
      const data = extractJson(text);
      const sources = sourcesFromResponse(response);
      log(`Response received: ${text.length} chars, ${sources.length} source(s) cited.`);
      return { ...data, _sources: sources, _log: [] };
    } catch (err) {
      if (err instanceof UserFacingError) throw err; // clean failure — don't rotate
      if (isQuotaError(err)) {
        log(`Key ${i + 1}/${keys.length} hit quota — rotating to the next key…`);
        continue;
      }
      throw new UserFacingError(`Gemini request failed: ${String(err)}`, 502);
    }
  }
  throw new UserFacingError(
    `All ${keys.length} configured Gemini key(s) are out of quota for grounded requests right now. ` +
      "Wait for the quota window to reset, or add another key as GOOGLE_GEMINI_KEY_<n> in .env.",
    502,
  );
}

/** Runs a prompt and merges the given log lines into the result's `_log`. */
async function runLogged(prompt: string, log: string[]): Promise<GroundedResult> {
  const push: Logger = (line) => log.push(line);
  const result = await runWithRotation(prompt, push);
  result._log = log;
  return result;
}

const JSON_RULES =
  "Respond with ONLY a single JSON object matching the schema below — no prose " +
  "before or after, no markdown fences. Use web search to ground every factual " +
  "claim not already covered by the course material below. If you cannot " +
  "verify something, say so in the field rather than inventing it — never " +
  "fabricate names, numbers, or events. An empty or 'not publicly findable' " +
  "field is honest; a guessed one is not.";

function courseBlock(context: string): string {
  return context
    ? `Known course material (from the ${AOS_COURSE_NAME} brain — already vetted, prefer this over open web search when it speaks to the same fact):\n${context}`
    : "No matching course material was found for this — rely on live web search.";
}

// ---------------------------------------------------------------------------
// Step 0 — The ICP: who should this company sell to?
// ---------------------------------------------------------------------------

export async function runIcp(myCompany: string, whatIDo: string): Promise<GroundedResult> {
  const log: string[] = [];
  const courseContext = await fetchBrainContext(
    AOS_COURSE_SLUG,
    "ICP buying signals four-circle research who are we",
    { log: (l) => log.push(l) },
  );
  const prompt = `${JSON_RULES}

You are a GTM research agent for a student on the ${AOS_COURSE_NAME} course, running
Step 0 of the course's own research chain ("who should we sell to?").

${courseBlock(courseContext)}

Student's company: ${myCompany}
What they do: ${whatIDo}

Work out who fits, who does NOT fit (a contrast, not a mirror of who fits),
which buying signals are genuinely visible from outside the company (if you
could only know it by being an employee there, it is not a usable signal),
and name the single assumption in your own answer you are least sure of.
Then shortlist real target accounts worth going after — flag one if it's
already in the course's case bank, that account has extra material ready.

Schema:
{
  "icp_summary": "2-3 sentences describing the ideal customer profile",
  "who_fits": [
    {"industry": "...", "company_size": "...", "spend_signal": "what must be true about their spend/operations for this to matter", "why_they_care": "..."}
  ],
  "who_does_not_fit": [
    {"looks_similar_to": "a company type that resembles a fit but isn't", "why_wrong": "..."}
  ],
  "buying_signals": [
    {"signal": "a concrete trigger that means someone is ready to buy", "visible_from_outside_as": "exactly where/how you'd see this from outside — a job posting, a press release, etc."}
  ],
  "weakest_assumption": {"assumption": "the one thing above you are least sure of", "what_to_check_first": "..."},
  "candidates": [
    {"name": "a real company name", "why_fit": "one sentence tying it to the ICP and a signal you found", "in_case_bank": true}
  ]
}

Max 4 rows each for who_fits, who_does_not_fit, buying_signals. Give 5-8
candidates, real and currently operating — not invented examples.
`;
  return runLogged(prompt, log);
}

// ---------------------------------------------------------------------------
// Step 1 — The shift: what's changing in the target's industry?
// ---------------------------------------------------------------------------

export async function runIndustry(
  myCompany: string,
  whatIDo: string,
  icp: Record<string, unknown>,
  targetAccount: string,
): Promise<GroundedResult> {
  const log: string[] = [];
  const courseContext = await fetchBrainContext(
    AOS_COURSE_SLUG,
    `${targetAccount} industry trends`,
    { log: (l) => log.push(l) },
  );
  const signals = Array.isArray(icp.buying_signals)
    ? (icp.buying_signals as { signal?: string }[]).map((s) => s.signal).join(", ")
    : "";
  const prompt = `${JSON_RULES}

Company: ${myCompany} — ${whatIDo}
ICP: ${String(icp.icp_summary ?? "")}
Buying signals we care about: ${signals}
Target account: ${targetAccount}

${courseBlock(courseContext)}

Research what is changing in ${targetAccount}'s industry that frees up budget
for buying something like ${myCompany}.

Rules:
1. Only changes from the last 18 months — older is background, not change.
2. Every change needs a named source with a date. No source, leave it out.
3. Do not connect two facts unless a source connects them (e.g. don't infer
   "they must be struggling" from a hire — that's a fabrication, not a fact).
4. Max 4 changes. Cut anything that would be true of every industry.

Schema:
{
  "industry": "the specific industry/category",
  "shifts": [
    {"change": "...", "source_and_date": "...", "why_it_frees_budget": "...", "status": "verified|assertion"}
  ],
  "relevance_to_icp": "1-2 sentences on why this shift matters for ${myCompany}'s pitch specifically",
  "competitors_to_know": ["a real competitor or adjacent player in this space", "..."],
  "verified_count": n,
  "assertion_count": n,
  "total_count": n,
  "could_not_find": ["a thing you looked for and could not verify", "..."]
}
`;
  return runLogged(prompt, log);
}

// ---------------------------------------------------------------------------
// Step 2 — The account: this company specifically
// ---------------------------------------------------------------------------

export async function runCompany(
  myCompany: string,
  whatIDo: string,
  targetAccount: string,
  industry: Record<string, unknown>,
): Promise<GroundedResult> {
  const log: string[] = [];
  const courseContext = await fetchBrainContext(AOS_COURSE_SLUG, targetAccount, {
    log: (l) => log.push(l),
  });
  const shifts = Array.isArray(industry.shifts)
    ? (industry.shifts as { change?: string }[]).map((s) => s.change).join(", ")
    : "";
  const prompt = `${JSON_RULES}

Company: ${myCompany} — ${whatIDo}
Target account: ${targetAccount}
Industry context: ${String(industry.industry ?? "")}. Shifts: ${shifts}

${courseBlock(courseContext)}

Research ${targetAccount} itself — only things that would change how you'd
sell to them, not company history or founder stories.

Rules:
1. Every claim needs a named source with a date. Mark anything older than 12
   months "stale": true — it's still shown, just flagged.
2. If you can't find how they currently handle the problem ${myCompany}
   solves, say "not publicly findable" — don't guess.
3. Say which shift from the industry step (if any) actually applies to this
   account, and which doesn't.
4. Also find their official website domain — the next step scrapes it for
   real published team emails, so it must be their actual primary domain.

Schema:
{
  "account_name": "${targetAccount}",
  "website": "the company's official domain, e.g. example.com — no https:// prefix",
  "what_they_do": "1-2 sentences",
  "size_or_scale": "employee count, revenue, funding stage — whatever is findable",
  "how_they_handle_it_today": "how they currently handle the problem ${myCompany} solves, or 'not publicly findable'",
  "which_industry_shift_applies": "which shift from the industry step applies here, and which doesn't, one line",
  "latest_news": [
    {"headline": "...", "date": "YYYY-MM or approximate", "source": "the publication/site name and URL, or 'no source' if this is unsourced", "status": "verified|assertion|no-source-found", "stale": false, "why_it_matters": "..."}
  ],
  "trigger": "the single most email-worthy recent event, one sentence — or 'none found' if genuinely nothing recent",
  "fit_assessment": "good fit / uncertain fit / poor fit for ${myCompany}, with a one-line reason",
  "verified_count": n,
  "assertion_count": n,
  "total_count": n,
  "could_not_find": ["a thing you looked for and could not verify", "..."]
}
`;
  return runLogged(prompt, log);
}

// ---------------------------------------------------------------------------
// Step 3 + 4 — The role, then the person ("who to connect")
// ---------------------------------------------------------------------------

export async function runPeople(
  myCompany: string,
  whatIDo: string,
  targetAccount: string,
  company: Record<string, unknown>,
): Promise<GroundedResult> {
  const log: string[] = [];
  const courseContext = await fetchBrainContext(
    AOS_COURSE_SLUG,
    `${targetAccount} persona hired fired measured`,
    { log: (l) => log.push(l) },
  );
  const website = typeof company.website === "string" ? company.website : "";
  const scrapedEmails = website
    ? await scrapeCompanyEmails(website, (l) => log.push(l))
    : (log.push("No website on file from the company step — skipping the scrape."), "");
  const prompt = `${JSON_RULES}

Company: ${myCompany} — ${whatIDo}
Target account: ${targetAccount} — ${String(company.what_they_do ?? "")}
Trigger: ${String(company.trigger ?? "")}

${courseBlock(courseContext)}

Emails scraped directly from ${targetAccount}'s own website (real HTML, pulled
just now — this is the strongest possible source, stronger than a search
snippet): ${scrapedEmails ? `\n${scrapedEmails}` : "No emails found on their site's about/team/contact pages."}

STEP 3 — job titles only, no named people yet. Work out which titles at
${targetAccount} would care about ${myCompany}, and what each is judged on
at work. Include at least one person whose role is to BLOCK this purchase —
a buying group with no blocker means you haven't understood it.

STEP 4 — then find real named individuals in those roles, and the public
evidence that would let someone start a relevant conversation with them.
Public professional sources only: company site, LinkedIn, press, podcasts,
conference talks, filings. A job title alone is not evidence — you need
something they actually said or did. If you find nobody with real public
evidence for a persona, leave that persona's people empty rather than
inventing one.

For each named person, also try to find:
- Their actual LinkedIn profile URL (linkedin.com/in/...) — only include it
  if search actually surfaced that exact URL, never construct or guess one.
- A public work email. Check the scraped website emails above first — if one
  clearly belongs to this person (their name appears in the surrounding
  text, or it's a role address unambiguously theirs), use it. Otherwise a
  search result is fine (a press byline, a speaker bio, a GitHub profile).
  Do NOT guess or pattern-generate an email (e.g. first.last@company.com)
  even if it looks obvious — an unverified guess is worse than nothing,
  it's a real person you'd be emailing.

Schema:
{
  "personas": [
    {"title": "role title",
      "role_in_decision": "champion|holds_budget|technical_checker|daily_user|blocker",
      "measured_on": "what they're accountable for — mark ASSERTED in the text if guessed from the title rather than sourced",
      "would_fear_about_buying": "their likely objection, not generic 'budget' unless it truly is",
      "why_they_care": "why this persona specifically cares about the trigger"}
  ],
  "people": [
    {"name": "real full name", "title": "their actual title", "time_in_role": "how long, if findable, else null",
      "matches_persona": "which persona title above",
      "what_they_said_or_did": "something concrete they said or did — not just their title",
      "status": "verified|assertion", "evidence_link": "URL to the source", "evidence_date": "date of that source",
      "linkedin_url": "the exact linkedin.com/in/... URL if search found it, else null",
      "linkedin_search_hint": "a search string to find their profile — used when linkedin_url is null",
      "email": "a genuinely published email if one exists, else null",
      "email_source": "where the email was published — null if email is null"}
  ],
  "verified_count": n,
  "assertion_count": n,
  "total_count": n
}
`;
  return runLogged(prompt, log);
}

// ---------------------------------------------------------------------------
// Verify — an independent grading pass, per the class's own grading prompt.
// Deliberately shares none of the generation prompt or course context, same
// as "open a chat OUTSIDE the Project" — a grader that shares the writer's
// assumptions shares the writer's blind spots.
// ---------------------------------------------------------------------------

const VERIFY_JSON_RULES =
  "You are a strict, independent grader. You did not write this research " +
  "and share none of its assumptions — you are not helpful or encouraging, " +
  "you are checking. Respond with ONLY a single JSON object matching the " +
  "schema below, no prose before or after.";

export async function runVerify(
  sectionLabel: string,
  content: Record<string, unknown>,
): Promise<GroundedResult> {
  const log: string[] = [];
  const { _sources: _s, _log: _l, ...clean } = content;
  void _s;
  void _l;
  log.push(
    `Grading "${sectionLabel}" independently — no shared context with the step that wrote it.`,
  );
  const prompt = `${VERIFY_JSON_RULES}

Below is a piece of GTM research (the "${sectionLabel}" step of a research
chain), as JSON. Grade only the discrete, itemized claims that carry their
own source/date field — items in arrays like "latest_news", "shifts", or
"people" (their "what_they_said_or_did" + "evidence_link"). Each of those is
one row.

Do NOT grade synthesis or judgment fields — "fit_assessment",
"relevance_to_icp", "which_industry_shift_applies", "why_it_matters",
"why_this_works", "weakest_assumption", or any one-line reasoning/summary.
Those are the researcher's own analysis, not sourced facts, and grading them
against "does it name a source" would fail every research pack ever written
by design, which defeats the point of grading.

An item already honestly marked "not publicly findable", "none found", or
"no source" is NOT a failure — skip it, the researcher already flagged the
gap correctly; only grade items that assert something as fact.

For each item you do grade, answer these four questions, true/false only:

A. Does it name a real, checkable source (a URL, a publication, "LinkedIn
   profile", etc — not "industry knowledge" and not left blank)?
B. Does that source carry a date?
C. Is that date within the last 24 months?
D. Would a salesperson act differently if this claim turned out to be
   false? (if trivial — e.g. "they are a company" — skip it entirely)

Schema:
{
  "rows": [
    {"claim": "the claim, verbatim or close to it", "a": true, "b": true, "c": true, "d": true}
  ],
  "counts": {"rows": n, "failed_a": n, "failed_b": n, "failed_c": n, "failed_d": n}
}

Grade honestly — a row with a=false is genuinely unusable, not a style
preference.

--- RESEARCH TO GRADE ---
${JSON.stringify(clean, null, 2)}
`;
  const result = await runLogged(prompt, log);
  const rows = Array.isArray(result.rows)
    ? (result.rows as { claim: string; a: boolean; b: boolean; c: boolean; d: boolean }[])
    : [];
  const doNotUse = rows.filter((r) => !r.a).map((r) => r.claim);
  result._log.push(
    `Graded ${rows.length} claim(s) — ${doNotUse.length} banned (no real source), ` +
      `${rows.filter((r) => r.a && !r.c).length} stale (source older than 24 months).`,
  );
  result.do_not_use = doNotUse;
  return result;
}

// ---------------------------------------------------------------------------
// Verify (messages) — the class's OTHER grading prompt: not "is this claim
// sourced" but "did this sentence earn its place." Grades the actual sent
// messages sentence-by-sentence against the research pack, with a real
// score (% FROM PACK) — not just pass/fail — so you can tell whether a
// prompt change actually made the agent's output better over time.
// ---------------------------------------------------------------------------

interface MessageVerdict {
  verdict: "blocked" | "weak" | "strong" | "adequate";
  verdict_reason: string;
}

function scoreMessagePerson(counts: {
  sentences?: number;
  from_pack?: number;
  generic?: number;
  made_up?: number;
  banned?: number;
}): { from_pack_pct: number; generic_pct: number } & MessageVerdict {
  const total = counts.sentences ?? 0;
  const fromPack = counts.from_pack ?? 0;
  const generic = counts.generic ?? 0;
  const madeUp = counts.made_up ?? 0;
  const banned = counts.banned ?? 0;
  const fromPackPct = total ? Math.round((fromPack / total) * 100) : 0;
  const genericPct = total ? Math.round((generic / total) * 100) : 0;

  if (madeUp > 0 || banned > 0) {
    return {
      from_pack_pct: fromPackPct,
      generic_pct: genericPct,
      verdict: "blocked",
      verdict_reason: `Contains ${madeUp} MADE UP and ${banned} BANNED sentence(s) — does not go out, no discussion.`,
    };
  }
  if (genericPct > 30) {
    return {
      from_pack_pct: fromPackPct,
      generic_pct: genericPct,
      verdict: "weak",
      verdict_reason:
        "GENERIC above 30% — the research didn't earn this message. Fix the sentences, not the research.",
    };
  }
  if (fromPackPct > 70) {
    return {
      from_pack_pct: fromPackPct,
      generic_pct: genericPct,
      verdict: "strong",
      verdict_reason:
        "FROM PACK above 70% — strong. Read it aloud and check it still sounds like a person wrote it.",
    };
  }
  return {
    from_pack_pct: fromPackPct,
    generic_pct: genericPct,
    verdict: "adequate",
    verdict_reason: "Usable, but not yet strong — more sentences could trace back to the pack.",
  };
}

function stripInternal(obj: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!obj) return {};
  const { _sources: _s, _log: _l, do_not_use: _d, ...clean } = obj;
  void _s;
  void _l;
  void _d;
  return clean;
}

export async function runVerifyMessages(
  outreach: Record<string, unknown>,
  pack: {
    icp: Record<string, unknown> | null;
    industry: Record<string, unknown> | null;
    company: Record<string, unknown> | null;
    people: Record<string, unknown> | null;
  },
  doNotUse: string[] = [],
): Promise<GroundedResult> {
  const log: string[] = [];
  log.push("Grading outreach messages independently — sentence by sentence, against the pack.");
  const cleanPack = {
    icp: stripInternal(pack.icp),
    industry: stripInternal(pack.industry),
    company: stripInternal(pack.company),
    people: stripInternal(pack.people),
  };
  const cleanOutreach = stripInternal(outreach);

  const prompt = `${VERIFY_JSON_RULES}

Below is a research pack (icp, industry, company, people — the sourced
research a GTM agent produced) and the outreach messages written from it —
per person, a 3-email sequence and a LinkedIn sequence (connect request +
3 messages).

Split every message into sentences. Give each sentence exactly one label:

FROM_PACK — it comes from a named field in the pack
GENERIC   — it would be true of any company in this industry
MADE_UP   — it is not in the pack and not sourced anywhere
BANNED    — it repeats or rewords one of the banned claims below, reworded or not

Banned claims: ${doNotUse.length ? JSON.stringify(doNotUse) : "(none banned yet)"}

Grade every message for every person. Subject lines and the LinkedIn
connect request count as sentences too.

Schema:
{
  "per_person": [
    {
      "person": "name or persona title",
      "sentences": [
        {"text": "the sentence", "label": "FROM_PACK|GENERIC|MADE_UP|BANNED"}
      ],
      "counts": {"sentences": n, "from_pack": n, "generic": n, "made_up": n, "banned": n}
    }
  ]
}

--- PACK ---
${JSON.stringify(cleanPack, null, 2)}
--- MESSAGES ---
${JSON.stringify(cleanOutreach, null, 2)}
`;
  const result = await runLogged(prompt, log);
  const perPerson = Array.isArray(result.per_person)
    ? (result.per_person as Record<string, unknown>[])
    : [];
  for (const p of perPerson) {
    const counts = (p.counts ?? {}) as Record<string, number>;
    Object.assign(p, scoreMessagePerson(counts));
  }
  const scored = perPerson.filter((p) => typeof p.from_pack_pct === "number");
  const overallFromPackPct = scored.length
    ? Math.round(scored.reduce((s, p) => s + (p.from_pack_pct as number), 0) / scored.length)
    : 0;
  const anyBlocked = perPerson.some((p) => p.verdict === "blocked");
  result.overall_from_pack_pct = overallFromPackPct;
  result.any_blocked = anyBlocked;
  result._log.push(
    `Graded ${perPerson.length} person(s)' messages — ${overallFromPackPct}% average traced to the pack` +
      (anyBlocked ? ", at least one person is BLOCKED (made up or banned content)." : "."),
  );
  return result;
}

// ---------------------------------------------------------------------------
// Workshop 2 — outreach: an email sequence + a LinkedIn sequence per person,
// nothing from the DO NOT USE list, ever, not even reworded.
// ---------------------------------------------------------------------------

interface PersonForOutreach {
  name?: string;
  title?: string;
  matches_persona?: string;
  email?: string | null;
  linkedin_url?: string | null;
  linkedin_search_hint?: string;
}

const BANNED_PHRASES = [
  "I hope this finds you well",
  "quick question",
  "circling back",
  "just following up",
];

/** First name for a greeting — "Yogesh Agarwal" -> "Yogesh". Falls back to
 * "there" for a persona with no named person, same as any real SDR would. */
function firstNameOf(fullName: string | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0];
  return first || "there";
}

/** The email/LinkedIn schema needs the real email/LinkedIn URL attached to
 * each person, but that data already came back verified from the People
 * step — asking Gemini to repeat it back risks it drifting or inventing
 * one. So this stitches the People step's own values onto each per_person
 * entry by matching on name, after Gemini writes the message content, and
 * recomputes the LinkedIn char count deterministically rather than trusting
 * the model's own count.
 *
 * It also assembles each email's greeting/body/sign-off deterministically
 * from the model's hook_pain/value/cta fields, rather than asking the model
 * to write the salutation and sign-off freehand — that's formatting, not
 * content, and keeping it out of the model's hands means every email comes
 * back with the same reliable structure instead of drifting run to run. */
function finalizeOutreach(
  result: GroundedResult,
  peopleList: PersonForOutreach[],
  myCompany: string,
): GroundedResult {
  const perPerson = Array.isArray(result.per_person)
    ? (result.per_person as Record<string, unknown>[])
    : [];
  const byName = new Map(peopleList.map((p) => [p.name?.trim().toLowerCase(), p]));
  for (const entry of perPerson) {
    const name = String(entry.person ?? "")
      .trim()
      .toLowerCase();
    const match = byName.get(name);
    entry.send_to_email = match?.email ?? null;
    entry.send_to_linkedin_url = match?.linkedin_url ?? null;
    entry.linkedin_search_hint = match?.linkedin_search_hint ?? null;

    const greeting = `Hi ${firstNameOf(match?.name)},`;
    const signOff = `Best,\n[Your name]\n${myCompany}`;
    const emails = Array.isArray(entry.emails) ? (entry.emails as Record<string, unknown>[]) : [];
    for (const email of emails) {
      email.greeting = greeting;
      email.sign_off = signOff;
      email.body = [
        greeting,
        String(email.hook_pain ?? ""),
        String(email.value ?? ""),
        String(email.cta ?? ""),
        signOff,
      ]
        .filter(Boolean)
        .join("\n\n");
    }

    const linkedin = entry.linkedin as Record<string, unknown> | undefined;
    if (linkedin && typeof linkedin.connect_request === "string") {
      linkedin.connect_request_char_count = linkedin.connect_request.length;
      linkedin.connect_request_over_limit = linkedin.connect_request.length > 300;
    }
  }
  return result;
}

export async function runOutreach(
  myCompany: string,
  whatIDo: string,
  targetAccount: string,
  company: Record<string, unknown>,
  people: Record<string, unknown>,
  doNotUse: string[] = [],
): Promise<GroundedResult> {
  const log: string[] = [];
  const courseContext = await fetchBrainContext(
    AOS_COURSE_SLUG,
    "cold email anatomy swap test style A style B outreach",
    { log: (l) => log.push(l) },
  );
  const peopleList = Array.isArray(people.people) ? (people.people as PersonForOutreach[]) : [];
  const peopleCtx =
    peopleList
      .map(
        (p) =>
          `- ${p.name} (${p.title}) — matches persona: ${p.matches_persona} — email on file: ${p.email ?? "none"} — has LinkedIn URL: ${p.linkedin_url ? "yes" : "no"}`,
      )
      .join("\n") || "No named people found — write for the personas generally.";

  const banned = doNotUse.length
    ? `Claims banned by grading — do NOT reference these in any message, not even reworded or paraphrased:\n${doNotUse.map((c) => `- ${c}`).join("\n")}`
    : "No claims have been banned by grading yet.";

  const prompt = `${JSON_RULES}

Company: ${myCompany} — ${whatIDo}
Target account: ${targetAccount}
Trigger to hook on: ${String(company.trigger ?? "")}
People to write for:
${peopleCtx}

Personas: ${JSON.stringify(people.personas ?? [])}

${courseBlock(courseContext)}

${banned}

For each person (or persona if no named person), pick ONE of two styles and
say why:
- STYLE INSIGHT — lead with what changed in their industry (a Step 1 shift).
  Works when you have a strong, specific industry shift but thin evidence on
  the person themselves.
- STYLE EVIDENCE — lead with something this person specifically said or did
  (from Step 4). Works when you have real evidence about them; fails
  (sounds generic) when you don't — in that case use STYLE INSIGHT instead.

Then write a 3-EMAIL SEQUENCE in that style. Every email has exactly three
parts — this is the structure from class, not optional:
  hook_pain — one specific, checkable fact or event as the hook (must fail
    the swap test — it can't be true of a different company), then the
    consequence THIS creates in the reader's world. Not a compliment
    ("congrats on the raise" is a Google Alert, not personalisation) and
    not a description of ${myCompany}'s problem space ("you're probably
    struggling with X" is a product pitch wearing a pain costume).
  value — exactly one sentence, one capability, phrased as what changes for
    them, not what ${myCompany} does. No feature list.
  cta — one question answerable in a single line, useful to the reader
    whether or not they ever buy. Never a meeting ask.
  Email 1 — hook_pain from the chosen style, then value, then cta.
  Email 2 — a genuinely new angle, not email 1 restated softer. It must
    contain information email 1 did not — if you can't point to what's new,
    don't write it. May reference email 1 in one clause at most.
  Email 3 — short. Easy to say no to. Leaves behind one useful thing even
    if they never reply.

And a LINKEDIN SEQUENCE:
  Connect request — under 300 characters, hard limit. No pitch, no ask
    beyond connecting. Must contain one specific fact that could not be
    true of anyone else (the swap test: if you replaced ${targetAccount}
    with a competitor, would this still be true? If yes, sharpen it).
  Message 1 — sent when they accept. No ask at all. Give something.
  Message 2 — sent 3 days later. One question about what they're measured on.
  Message 3 — sent a week later. One specific offer, with an easy no. Must
    not mention that they got no reply.

Hard rules for everything above:
1. Every sentence must trace back to a named field in the research
   (industry shift, company news, trigger, persona, or person evidence).
   Nothing invented, nothing generic enough to send to any company in this
   industry.
2. Nothing from the banned claims list above, reworded or not.
3. Under 120 words per email. Subject lines under 8 words.
4. Never use these banned phrases: ${BANNED_PHRASES.map((p) => `"${p}"`).join(", ")}.

Schema:
{
  "per_person": [
    {
      "person": "name or persona title",
      "style_used": "insight|evidence",
      "style_reason": "one line: why this style fits the research you have",
      "emails": [
        {"subject": "under 8 words, specific — not clickbait", "hook_pain": "...", "value": "...", "cta": "..."},
        {"subject": "...", "hook_pain": "...", "value": "...", "cta": "..."},
        {"subject": "...", "hook_pain": "...", "value": "...", "cta": "..."}
      ],
      "linkedin": {
        "connect_request": "under 300 characters",
        "message_1": "sent on accept, no ask",
        "message_2": "sent 3 days later, one question",
        "message_3": "sent a week later, one offer with an easy no"
      },
      "why_this_works": "reasoning: why this style, why this hook, why this CTA",
      "swap_test": "pass — this only works for ${targetAccount} because X | fail — this is too generic because X"
    }
  ]
}
`;
  const result = await runLogged(prompt, log);
  return finalizeOutreach(result, peopleList, myCompany);
}
