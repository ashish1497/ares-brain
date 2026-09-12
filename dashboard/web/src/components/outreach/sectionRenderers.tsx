import type { ReactNode } from "react";
import { StatePill } from "../StatePill";
import { CopyButton } from "../CopyButton";

function statusState(status: unknown): "ok" | "soon" | "bad" {
  const s = String(status ?? "").toLowerCase();
  if (s.includes("verified")) return "ok";
  if (s.includes("assertion")) return "soon";
  return "bad"; // no-source-found, fabricated, unknown
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="text-[13px]">
      <b className="font-bold">{label}</b> {children}
    </p>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--color-ink-muted)]">
      {children}
    </p>
  );
}

function PillRow({ items }: { items: unknown }) {
  const list = Array.isArray(items) ? (items as string[]) : [];
  if (list.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {list.map((item, i) => (
        <span
          key={i}
          className="rounded-nb border-[3px] border-edge bg-card px-2 py-0.5 text-[12px] font-medium"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

/** The one table shape every step reuses — same convention as the rest of
 * the dashboard (BrainTab, ExamsTab): 3px edge rule under the header row,
 * hairline dividers between rows. Tabular by default, not cards, so scanning
 * one step and comparing it to the next reads the same way every time. */
function DataTable({
  columns,
  rows,
  empty,
  onRowClick,
}: {
  columns: string[];
  rows: ReactNode[][];
  empty?: string;
  onRowClick?: (index: number) => void;
}) {
  if (rows.length === 0) {
    return empty ? (
      <p className="mb-3 text-[12px] text-[color:var(--color-ink-muted)]">{empty}</p>
    ) : null;
  }
  return (
    <div className="mb-3 overflow-x-auto">
      <table className="w-full text-left text-[12px]">
        <thead>
          <tr className="border-b-[3px] border-edge">
            {columns.map((c, i) => (
              <th key={i} className="py-2 pr-3 font-bold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--color-rule)]">
          {rows.map((row, i) => (
            <tr
              key={i}
              className={onRowClick ? "cursor-pointer hover:bg-paper" : undefined}
              onClick={onRowClick ? () => onRowClick(i) : undefined}
            >
              {row.map((cell, j) => (
                <td key={j} className="py-2 pr-3 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** VERIFIED / ASSERTED / TOTAL readout — the same verification-ratio idea
 * from class, always visible instead of a one-off calculator. */
export function CountsBadge({ content }: { content: Record<string, unknown> }) {
  const verified = content.verified_count;
  const asserted = content.assertion_count;
  const total = content.total_count;
  if (verified == null && asserted == null && total == null) return null;
  const ratio =
    typeof verified === "number" && typeof total === "number" && total > 0
      ? Math.round((verified / total) * 100)
      : null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
      <StatePill state="ok">verified {String(verified ?? 0)}</StatePill>
      <StatePill state="soon">asserted {String(asserted ?? 0)}</StatePill>
      <span className="text-[color:var(--color-ink-muted)]">of {String(total ?? 0)} total</span>
      {ratio != null && (
        <span className="font-bold text-[color:var(--color-ink)]">— {ratio}% verified</span>
      )}
    </div>
  );
}

function CouldNotFind({ items }: { items: unknown }) {
  const list = Array.isArray(items) ? (items as string[]) : [];
  if (list.length === 0) return null;
  return (
    <div className="mt-3 rounded-nb border-[3px] border-dashed border-edge bg-paper p-3">
      <Eyebrow>Could not find</Eyebrow>
      <ul className="list-disc space-y-1 pl-5 text-[13px] text-[color:var(--color-ink-muted)]">
        {list.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/** Line-by-line trace of what this step actually did — brain lookups,
 * website scrapes, which Gemini key answered — not just a spinner. */
export function ProcessLog({ log }: { log: unknown }) {
  const lines = Array.isArray(log) ? (log as string[]) : [];
  if (lines.length === 0) return null;
  return (
    <details className="mt-4 rounded-nb border-[3px] border-edge bg-paper">
      <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--color-ink-muted)]">
        Process log ({lines.length})
      </summary>
      <ol className="border-t border-rule px-3 py-2 text-[12px]">
        {lines.map((line, i) => (
          <li
            key={i}
            className="border-b border-dashed border-rule py-1.5 font-mono last:border-b-0"
          >
            {line}
          </li>
        ))}
      </ol>
    </details>
  );
}

interface Source {
  label: string;
  url: string;
}

export function SourcesFooter({ sources }: { sources: unknown }) {
  const list = Array.isArray(sources) ? (sources as Source[]) : [];
  if (list.length === 0) return null;
  return (
    <div className="mt-4 border-t-[3px] border-edge pt-3">
      <Eyebrow>Sources</Eyebrow>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {list.slice(0, 8).map((s, i) => (
          <a
            key={i}
            href={s.url}
            target="_blank"
            rel="noopener"
            className="text-[12px] underline decoration-[color:var(--color-cta)] decoration-2 underline-offset-2"
          >
            {s.label}
          </a>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 0 — ICP
// ---------------------------------------------------------------------------

export function IcpBody({
  content,
  onPickTarget,
}: {
  content: Record<string, unknown>;
  onPickTarget: (name: string) => void;
}) {
  const whoFits = Array.isArray(content.who_fits)
    ? (content.who_fits as {
        industry?: string;
        company_size?: string;
        spend_signal?: string;
        why_they_care?: string;
      }[])
    : [];
  const whoDoesNotFit = Array.isArray(content.who_does_not_fit)
    ? (content.who_does_not_fit as { looks_similar_to?: string; why_wrong?: string }[])
    : [];
  const buyingSignals = Array.isArray(content.buying_signals)
    ? (content.buying_signals as { signal?: string; visible_from_outside_as?: string }[])
    : [];
  const weakest = content.weakest_assumption as
    { assumption?: string; what_to_check_first?: string } | undefined;
  const candidates = Array.isArray(content.candidates)
    ? (content.candidates as { name: string; why_fit: string; in_case_bank?: boolean }[])
    : [];

  return (
    <>
      <p className="mb-3 text-[14px]">{String(content.icp_summary ?? "")}</p>

      <Eyebrow>Who fits</Eyebrow>
      <DataTable
        columns={["Industry", "Size", "Spend signal", "Why they care"]}
        rows={whoFits.map((w) => [w.industry, w.company_size, w.spend_signal, w.why_they_care])}
      />

      <Eyebrow>Who does NOT fit</Eyebrow>
      <DataTable
        columns={["Looks similar to", "Why wrong"]}
        rows={whoDoesNotFit.map((w) => [w.looks_similar_to, w.why_wrong])}
      />

      <Eyebrow>Buying signals — visible from outside only</Eyebrow>
      <DataTable
        columns={["Signal", "Visible as"]}
        rows={buyingSignals.map((s) => [s.signal, s.visible_from_outside_as])}
      />

      {weakest && (
        <div className="mb-3 rounded-nb border-l-[6px] border-edge bg-card p-3">
          <Eyebrow>Weakest assumption</Eyebrow>
          <p className="text-[13px]">{weakest.assumption}</p>
          <p className="text-[12px] text-[color:var(--color-ink-muted)]">
            Check first: {weakest.what_to_check_first}
          </p>
        </div>
      )}

      <Eyebrow>Pick a target account → feeds Step 1</Eyebrow>
      <DataTable
        columns={["Company", "Why it fits", "", ""]}
        rows={candidates.map((c) => [
          <span className="font-bold" key="n">
            {c.name}
          </span>,
          c.why_fit,
          c.in_case_bank ? <StatePill state="ok">case bank</StatePill> : null,
          <button
            key="a"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPickTarget(c.name);
            }}
            className="rounded-nb border-[3px] border-edge bg-card px-2 py-1 text-[11px] font-bold shadow-[var(--nb-shadow)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none"
          >
            Use →
          </button>,
        ])}
        onRowClick={(i) => onPickTarget(candidates[i].name)}
      />
      <CustomTargetForm onPickTarget={onPickTarget} />
    </>
  );
}

function CustomTargetForm({ onPickTarget }: { onPickTarget: (name: string) => void }) {
  return (
    <form
      className="mt-3 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const input = e.currentTarget.elements.namedItem("target") as HTMLInputElement;
        const value = input.value.trim();
        if (value) onPickTarget(value);
      }}
    >
      <input
        name="target"
        type="text"
        placeholder="Or type your own target account"
        className="flex-1 rounded-nb border-[3px] border-edge bg-card px-3 py-1.5 text-[13px]"
      />
      <button
        type="submit"
        className="rounded-nb border-[3px] border-edge bg-card px-3 py-1.5 text-[13px] font-bold shadow-[var(--nb-shadow)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none"
      >
        Use this account
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Industry shift
// ---------------------------------------------------------------------------

export function IndustryBody({ content }: { content: Record<string, unknown> }) {
  const shifts = Array.isArray(content.shifts)
    ? (content.shifts as {
        change?: string;
        source_and_date?: string;
        why_it_frees_budget?: string;
        status?: string;
      }[])
    : [];
  return (
    <>
      <span className="mb-3 inline-block rounded-nb border-[3px] border-edge bg-card px-2 py-0.5 text-[12px] font-bold">
        {String(content.industry ?? "")}
      </span>
      <CountsBadge content={content} />
      <Eyebrow>What&apos;s shifting (last 18 months) → feeds Step 2</Eyebrow>
      <DataTable
        columns={["Change", "Source + date", "Frees budget because", "Status"]}
        rows={shifts.map((s) => [
          s.change,
          <span className="text-[11px] text-[color:var(--color-ink-muted)]" key="s">
            {s.source_and_date}
          </span>,
          s.why_it_frees_budget,
          <StatePill state={statusState(s.status)} key="st">
            {s.status}
          </StatePill>,
        ])}
      />
      <Eyebrow>Why it matters to your pitch</Eyebrow>
      <p className="mb-3 text-[13px]">{String(content.relevance_to_icp ?? "")}</p>
      <Eyebrow>Competitors to know</Eyebrow>
      <PillRow items={content.competitors_to_know} />
      <CouldNotFind items={content.could_not_find} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — The account
// ---------------------------------------------------------------------------

export function CompanyBody({ content }: { content: Record<string, unknown> }) {
  const news = Array.isArray(content.latest_news)
    ? (content.latest_news as {
        headline: string;
        date?: string;
        status?: string;
        stale?: boolean;
        why_it_matters?: string;
      }[])
    : [];
  return (
    <>
      <p className="mb-1 text-[14px]">{String(content.what_they_do ?? "")}</p>
      <p className="mb-3 text-[12px] text-[color:var(--color-ink-muted)]">
        {String(content.size_or_scale ?? "")}
      </p>
      <CountsBadge content={content} />
      <Field label="How they handle it today">
        {String(content.how_they_handle_it_today ?? "")}
      </Field>
      <Field label="Which industry shift applies">
        {String(content.which_industry_shift_applies ?? "")}
      </Field>
      <div className="my-4 rounded-nb border-l-[6px] border-edge bg-card p-3">
        <Eyebrow>Trigger</Eyebrow>
        <p className="text-[13px]">{String(content.trigger ?? "")}</p>
      </div>
      <Eyebrow>Latest news → feeds Steps 3–4</Eyebrow>
      <DataTable
        columns={["Headline", "Date", "Status", "Why it matters"]}
        rows={news.map((n) => [
          n.headline,
          <span className="text-[11px] text-[color:var(--color-ink-muted)]" key="d">
            {n.date}
          </span>,
          <span className="flex flex-wrap gap-1" key="s">
            {n.stale && <StatePill state="soon">stale</StatePill>}
            <StatePill state={statusState(n.status)}>{n.status}</StatePill>
          </span>,
          n.why_it_matters,
        ])}
      />
      <Field label="Fit">{String(content.fit_assessment ?? "")}</Field>
      <CouldNotFind items={content.could_not_find} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 3 + 4 — Who to connect
// ---------------------------------------------------------------------------

const ROLE_LABEL: Record<string, string> = {
  champion: "Champion",
  holds_budget: "Holds the budget",
  technical_checker: "Technical checker",
  daily_user: "Daily user",
  blocker: "Blocker",
};

export function PeopleBody({ content }: { content: Record<string, unknown> }) {
  const personas = Array.isArray(content.personas)
    ? (content.personas as {
        title: string;
        role_in_decision?: string;
        measured_on?: string;
        would_fear_about_buying?: string;
        why_they_care?: string;
      }[])
    : [];
  const people = Array.isArray(content.people)
    ? (content.people as {
        name: string;
        title?: string;
        time_in_role?: string | null;
        status?: string;
        matches_persona?: string;
        what_they_said_or_did?: string;
        evidence_link?: string;
        evidence_date?: string;
        linkedin_url?: string | null;
        linkedin_search_hint?: string;
        email?: string | null;
        email_source?: string | null;
      }[])
    : [];
  const hasBlocker = personas.some((p) => p.role_in_decision === "blocker");

  return (
    <>
      <CountsBadge content={content} />
      <Eyebrow>Personas</Eyebrow>
      <DataTable
        columns={["Title", "Role", "Measured on", "Would fear about buying"]}
        rows={personas.map((p) => [
          p.title,
          p.role_in_decision ? (
            <StatePill state={p.role_in_decision === "blocker" ? "bad" : "neutral"}>
              {ROLE_LABEL[p.role_in_decision] ?? p.role_in_decision}
            </StatePill>
          ) : null,
          p.measured_on,
          p.would_fear_about_buying,
        ])}
      />
      {!hasBlocker && personas.length > 0 && (
        <p className="mb-4 text-[12px] text-[color:var(--color-ink-muted)]">
          No blocker identified — a buying group with no blocker usually means the research
          hasn&apos;t found the whole picture yet.
        </p>
      )}

      <Eyebrow>Who to connect → feeds Workshop 2</Eyebrow>
      <DataTable
        columns={["Name", "Title", "What they said/did", "Status", "LinkedIn", "Email"]}
        empty="No verifiable named people found — write to the personas above instead of guessing a name."
        rows={people.map((p) => [
          <>
            <span className="font-bold">{p.name}</span>
            {p.time_in_role && (
              <span className="block text-[11px] text-[color:var(--color-ink-muted)]">
                {p.time_in_role}
              </span>
            )}
          </>,
          p.title,
          <>
            {p.what_they_said_or_did}
            {p.evidence_link && (
              <a
                href={p.evidence_link}
                target="_blank"
                rel="noopener"
                className="block text-[11px] underline decoration-[color:var(--color-cta)] decoration-2 underline-offset-2"
              >
                source{p.evidence_date ? ` · ${p.evidence_date}` : ""} →
              </a>
            )}
          </>,
          <StatePill state={statusState(p.status)} key="st">
            {p.status}
          </StatePill>,
          p.linkedin_url ? (
            <a
              href={p.linkedin_url}
              target="_blank"
              rel="noopener"
              className="underline decoration-[color:var(--color-cta)] decoration-2 underline-offset-2"
            >
              profile →
            </a>
          ) : (
            <a
              href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(p.linkedin_search_hint ?? "")}`}
              target="_blank"
              rel="noopener"
              className="underline decoration-[color:var(--color-cta)] decoration-2 underline-offset-2"
            >
              search →
            </a>
          ),
          p.email ? (
            <a
              href={`mailto:${p.email}`}
              className="underline decoration-[color:var(--color-cta)] decoration-2 underline-offset-2"
              title={p.email_source ?? undefined}
            >
              {p.email}
            </a>
          ) : (
            <span className="text-[color:var(--color-ink-muted)]">none found</span>
          ),
        ])}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Verification — the independent grading pass
// ---------------------------------------------------------------------------

export function VerificationPanel({ result }: { result: Record<string, unknown> }) {
  const counts = result.counts as
    | { rows?: number; failed_a?: number; failed_b?: number; failed_c?: number; failed_d?: number }
    | undefined;
  const doNotUse = Array.isArray(result.do_not_use) ? (result.do_not_use as string[]) : [];
  if (!counts) return null;
  return (
    <div className="mt-4 rounded-nb border-[3px] border-edge bg-paper p-3">
      <Eyebrow>Grading result (independent pass)</Eyebrow>
      <div className="mb-2 flex flex-wrap gap-3 text-[12px]">
        <span>{counts.rows ?? 0} claims checked</span>
        <span className="text-[color:var(--color-bad)]">{counts.failed_a ?? 0} unsourced</span>
        <span className="text-[color:var(--color-soon)]">{counts.failed_b ?? 0} no date</span>
        <span className="text-[color:var(--color-soon)]">{counts.failed_c ?? 0} stale (24mo+)</span>
        <span>{counts.failed_d ?? 0} wouldn&apos;t change a rep&apos;s action</span>
      </div>
      {doNotUse.length > 0 && (
        <>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--color-bad)]">
            Banned from outreach
          </p>
          <ul className="list-disc space-y-1 pl-5 text-[12px]">
            {doNotUse.map((claim, i) => (
              <li key={i}>{claim}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const VERDICT_STATE: Record<string, "ok" | "soon" | "bad" | "neutral"> = {
  strong: "ok",
  adequate: "neutral",
  weak: "soon",
  blocked: "bad",
};

const LABEL_STATE: Record<string, "ok" | "soon" | "bad" | "neutral"> = {
  FROM_PACK: "ok",
  GENERIC: "soon",
  MADE_UP: "bad",
  BANNED: "bad",
};

/** The class's OTHER grading prompt: not "is this claim sourced" but "did
 * this sentence earn its place" — every sentence of every sent message,
 * labelled and scored, with a % FROM PACK you can track across
 * regenerations to see whether a prompt change actually helped. */
export function MessageVerificationPanel({ result }: { result: Record<string, unknown> }) {
  const perPerson = Array.isArray(result.per_person)
    ? (result.per_person as {
        person: string;
        sentences?: { text: string; label: string }[];
        counts?: {
          sentences?: number;
          from_pack?: number;
          generic?: number;
          made_up?: number;
          banned?: number;
        };
        from_pack_pct?: number;
        generic_pct?: number;
        verdict?: string;
        verdict_reason?: string;
      }[])
    : [];
  if (perPerson.length === 0) return null;
  const overall = result.overall_from_pack_pct as number | undefined;

  return (
    <div className="mt-4 rounded-nb border-[3px] border-edge bg-paper p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Eyebrow>Message grading (independent pass) — score, not just pass/fail</Eyebrow>
        {typeof overall === "number" && (
          <span className="text-[13px] font-bold">{overall}% avg FROM PACK</span>
        )}
      </div>

      <DataTable
        columns={["Person", "Verdict", "From pack", "Generic", "Sentences"]}
        rows={perPerson.map((p) => [
          p.person,
          <StatePill state={VERDICT_STATE[p.verdict ?? ""] ?? "neutral"} key="v">
            {p.verdict}
          </StatePill>,
          `${p.from_pack_pct ?? 0}%`,
          `${p.generic_pct ?? 0}%`,
          `${p.counts?.sentences ?? 0}`,
        ])}
      />

      <div className="grid gap-3">
        {perPerson.map((p, i) => (
          <details key={i} className="rounded-nb border-[3px] border-edge bg-card p-3">
            <summary className="cursor-pointer select-none text-[12px] font-bold">
              {p.person} — sentence-by-sentence
            </summary>
            <p className="my-2 text-[12px] text-[color:var(--color-ink-muted)]">
              {p.verdict_reason}
            </p>
            <ul className="grid gap-1.5">
              {(p.sentences ?? []).map((s, j) => (
                <li key={j} className="flex items-start gap-2 text-[12px]">
                  <StatePill
                    state={LABEL_STATE[s.label] ?? "neutral"}
                    className="mt-0.5 flex-shrink-0"
                  >
                    {s.label?.replace("_", " ")}
                  </StatePill>
                  <span>{s.text}</span>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workshop 2 — outreach: email sequence + LinkedIn sequence
// ---------------------------------------------------------------------------

interface OutreachPerson {
  person: string;
  style_used?: "insight" | "evidence";
  style_reason?: string;
  emails?: { subject?: string; body?: string }[];
  linkedin?: {
    connect_request?: string;
    connect_request_char_count?: number;
    connect_request_over_limit?: boolean;
    message_1?: string;
    message_2?: string;
    message_3?: string;
  };
  why_this_works?: string;
  swap_test?: string;
  send_to_email?: string | null;
  send_to_linkedin_url?: string | null;
  linkedin_search_hint?: string | null;
}

function linkedinHrefFor(p: OutreachPerson): string {
  return (
    p.send_to_linkedin_url ||
    `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(
      p.linkedin_search_hint ?? p.person,
    )}`
  );
}

export function OutreachBody({ content }: { content: Record<string, unknown> }) {
  const items = Array.isArray(content.per_person) ? (content.per_person as OutreachPerson[]) : [];

  return (
    <div className="grid gap-4">
      <Eyebrow>Overview — who gets what, and where it&apos;s sent</Eyebrow>
      <DataTable
        columns={["Person", "Style", "Send to email", "Send to LinkedIn", "Swap test"]}
        rows={items.map((p) => [
          p.person,
          p.style_used === "insight" ? "lead with insight" : "lead with evidence",
          p.send_to_email ? (
            <a
              href={`mailto:${p.send_to_email}`}
              className="underline decoration-[color:var(--color-cta)] decoration-2 underline-offset-2"
            >
              {p.send_to_email}
            </a>
          ) : (
            <span className="text-[color:var(--color-ink-muted)]">none found</span>
          ),
          <a
            key="li"
            href={linkedinHrefFor(p)}
            target="_blank"
            rel="noopener"
            className="underline decoration-[color:var(--color-cta)] decoration-2 underline-offset-2"
          >
            {p.send_to_linkedin_url ? "profile →" : "search →"}
          </a>,
          <StatePill
            state={(p.swap_test ?? "").toLowerCase().startsWith("pass") ? "ok" : "bad"}
            key="sw"
          >
            {(p.swap_test ?? "").toLowerCase().startsWith("pass") ? "pass" : "fail"}
          </StatePill>,
        ])}
      />

      {items.map((p, i) => {
        const emails = p.emails ?? [];
        const emailSequenceText = emails
          .map((e, idx) => `Email ${idx + 1}\nSubject: ${e.subject ?? ""}\n\n${e.body ?? ""}`)
          .join("\n\n---\n\n");
        const linkedinSequenceText = [
          `Connect request: ${p.linkedin?.connect_request ?? ""}`,
          `Message 1 (on accept): ${p.linkedin?.message_1 ?? ""}`,
          `Message 2 (+3 days): ${p.linkedin?.message_2 ?? ""}`,
          `Message 3 (+1 week): ${p.linkedin?.message_3 ?? ""}`,
        ].join("\n\n");

        return (
          <details key={i} className="rounded-nb border-[3px] border-edge bg-card p-4">
            <summary className="cursor-pointer select-none text-[15px] font-bold">
              {p.person} — full messages
            </summary>

            {p.style_reason && (
              <p className="my-2 text-[12px] italic text-[color:var(--color-ink-muted)]">
                {p.style_reason}
              </p>
            )}

            <div className="mb-3 mt-2 grid gap-3 md:grid-cols-2">
              <div className="rounded-nb border-[3px] border-edge bg-paper p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Eyebrow>Email sequence ({emails.length})</Eyebrow>
                  <CopyButton value={emailSequenceText} variant="neutral" size="sm" />
                </div>
                <div className="grid gap-3">
                  {emails.map((e, idx) => (
                    <div
                      key={idx}
                      className="border-t border-rule pt-2 first:border-t-0 first:pt-0"
                    >
                      <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-[color:var(--color-ink-muted)]">
                        Email {idx + 1}
                      </p>
                      <p className="mb-1 text-[13px] font-bold">{e.subject}</p>
                      <p className="whitespace-pre-line text-[13px]">{e.body}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-nb border-[3px] border-edge bg-paper p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Eyebrow>LinkedIn sequence</Eyebrow>
                  <CopyButton value={linkedinSequenceText} variant="neutral" size="sm" />
                </div>
                <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-[color:var(--color-ink-muted)]">
                  Connect request
                  {typeof p.linkedin?.connect_request_char_count === "number" && (
                    <span
                      className={
                        p.linkedin.connect_request_over_limit
                          ? "ml-2 text-[color:var(--color-bad)]"
                          : "ml-2 text-[color:var(--color-ink-muted)]"
                      }
                    >
                      {p.linkedin.connect_request_char_count}/300 chars
                    </span>
                  )}
                </p>
                <p className="mb-2 text-[13px]">{p.linkedin?.connect_request}</p>
                <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-[color:var(--color-ink-muted)]">
                  Message 1 · on accept
                </p>
                <p className="mb-2 text-[13px]">{p.linkedin?.message_1}</p>
                <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-[color:var(--color-ink-muted)]">
                  Message 2 · +3 days
                </p>
                <p className="mb-2 text-[13px]">{p.linkedin?.message_2}</p>
                <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-[color:var(--color-ink-muted)]">
                  Message 3 · +1 week
                </p>
                <p className="text-[13px]">{p.linkedin?.message_3}</p>
              </div>
            </div>

            <p className="text-[12px] italic text-[color:var(--color-ink-muted)]">
              {p.why_this_works}
            </p>
          </details>
        );
      })}
    </div>
  );
}
