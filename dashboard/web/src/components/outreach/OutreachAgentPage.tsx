import { useState } from "react";
import { Card, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { SectionHeader } from "../SectionHeader";
import { StatePill } from "../StatePill";
import * as api from "../../api";
import type { OutreachSection, OutreachState } from "../../api";
import {
  IcpBody,
  IndustryBody,
  CompanyBody,
  PeopleBody,
  OutreachBody,
  SourcesFooter,
  ProcessLog,
  VerificationPanel,
  MessageVerificationPanel,
} from "./sectionRenderers";

const SECTION_META: Record<
  OutreachSection,
  { step: string; title: string; input: string; output: string; verifiable: boolean }
> = {
  icp: {
    step: "Step 0",
    title: "The ICP",
    input: "Your company + what you do",
    output: "Who fits, who doesn't, buying signals, target candidates",
    verifiable: false,
  },
  industry: {
    step: "Step 1",
    title: "The shift",
    input: "ICP + target account",
    output: "What's changing in their industry, last 18 months",
    verifiable: false,
  },
  company: {
    step: "Step 2",
    title: "The account",
    input: "Target account + industry shift",
    output: "Company snapshot, latest news, trigger, website",
    verifiable: true,
  },
  people: {
    step: "Steps 3–4",
    title: "The role, then the person",
    input: "Company snapshot + scraped website emails",
    output: "Personas (incl. a blocker) + named people with LinkedIn/email",
    verifiable: true,
  },
  outreach: {
    step: "Workshop 2",
    title: "Outreach",
    input: "People + personas + graded, banned claims excluded",
    output: "3-email sequence + LinkedIn connect + 3 messages, per person",
    verifiable: true,
  },
};

const DOWNSTREAM: OutreachSection[] = ["industry", "company", "people", "outreach"];
const ALL_SECTIONS: OutreachSection[] = ["icp", ...DOWNSTREAM];

type PipelineStatus = "waiting" | "not-run" | "running" | "error" | "edited" | "done";

const PIPELINE_STATUS_LABEL: Record<PipelineStatus, string> = {
  waiting: "waiting on target",
  "not-run": "not run",
  running: "running…",
  error: "error",
  edited: "edited by you",
  done: "done",
};

const PIPELINE_STATUS_PILL: Record<PipelineStatus, "ok" | "soon" | "bad" | "neutral"> = {
  waiting: "neutral",
  "not-run": "neutral",
  running: "soon",
  error: "bad",
  edited: "soon",
  done: "ok",
};

/** The whole chain at a glance — which agent feeds which, and where each
 * one currently stands. Clicking a row jumps to that section's card. */
function PipelineTable({
  state,
  loading,
  errors,
}: {
  state: OutreachState;
  loading: Set<OutreachSection>;
  errors: Partial<Record<OutreachSection, string>>;
}) {
  function statusFor(section: OutreachSection): PipelineStatus {
    if (section !== "icp" && !state.targetAccount) return "waiting";
    if (loading.has(section)) return "running";
    if (errors[section]) return "error";
    if (state.sections[section]) return state.edited[section] ? "edited" : "done";
    return "not-run";
  }

  return (
    <div className="mb-6 overflow-x-auto rounded-nb border-[3px] border-edge bg-card p-4 shadow-[var(--nb-shadow)]">
      <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--color-ink-muted)]">
        Pipeline — how data moves between the agents
      </p>
      <table className="w-full text-left text-[12px]">
        <thead>
          <tr className="border-b-[3px] border-edge">
            <th className="py-2 pr-3 font-bold">#</th>
            <th className="py-2 pr-3 font-bold">Agent</th>
            <th className="py-2 pr-3 font-bold">In</th>
            <th className="py-2 pr-3 font-bold">Out</th>
            <th className="py-2 pr-3 font-bold">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--color-rule)]">
          {ALL_SECTIONS.map((section, i) => {
            const meta = SECTION_META[section];
            const status = statusFor(section);
            return (
              <tr
                key={section}
                className="cursor-pointer hover:bg-paper"
                onClick={() =>
                  document
                    .getElementById(`section-${section}`)
                    ?.scrollIntoView({ behavior: "smooth", block: "center" })
                }
              >
                <td className="py-2 pr-3 align-top text-[color:var(--color-ink-muted)]">{i + 1}</td>
                <td className="py-2 pr-3 align-top font-bold">{meta.title}</td>
                <td className="py-2 pr-3 align-top text-[color:var(--color-ink-muted)]">
                  {meta.input}
                </td>
                <td className="py-2 pr-3 align-top text-[color:var(--color-ink-muted)]">
                  {meta.output}
                </td>
                <td className="py-2 pr-3 align-top">
                  <StatePill state={PIPELINE_STATUS_PILL[status]}>
                    {PIPELINE_STATUS_LABEL[status]}
                  </StatePill>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BodyFor({
  section,
  content,
}: {
  section: OutreachSection;
  content: Record<string, unknown>;
}) {
  switch (section) {
    case "icp":
      return null; // icp needs onPickTarget — rendered specially by the caller
    case "industry":
      return <IndustryBody content={content} />;
    case "company":
      return <CompanyBody content={content} />;
    case "people":
      return <PeopleBody content={content} />;
    case "outreach":
      return <OutreachBody content={content} />;
  }
}

export function OutreachAgentPage({ go }: { go: (hash: string) => void }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [state, setState] = useState<OutreachState | null>(null);
  const [loading, setLoading] = useState<Set<OutreachSection>>(new Set());
  const [verifying, setVerifying] = useState<Set<OutreachSection>>(new Set());
  const [errors, setErrors] = useState<Partial<Record<OutreachSection, string>>>({});
  const [editing, setEditing] = useState<OutreachSection | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editError, setEditError] = useState("");
  const [companyEditOpen, setCompanyEditOpen] = useState(false);
  const [intakeError, setIntakeError] = useState("");
  const [intakeBusy, setIntakeBusy] = useState(false);

  function setLoadingFor(section: OutreachSection, value: boolean) {
    setLoading((prev) => {
      const next = new Set(prev);
      if (value) next.add(section);
      else next.delete(section);
      return next;
    });
  }

  async function runSection(sid: string, section: OutreachSection): Promise<boolean> {
    setLoadingFor(section, true);
    setErrors((prev) => ({ ...prev, [section]: undefined }));
    try {
      const data = await api.runOutreachSection(sid, section);
      setState(data.state);
      return true;
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [section]: err instanceof Error ? err.message : String(err),
      }));
      return false;
    } finally {
      setLoadingFor(section, false);
    }
  }

  async function handleVerify(section: OutreachSection) {
    if (!sessionId) return;
    setVerifying((prev) => new Set(prev).add(section));
    setErrors((prev) => ({ ...prev, [section]: undefined }));
    try {
      const data =
        section === "outreach"
          ? await api.verifyOutreachMessages(sessionId)
          : await api.verifyOutreachSection(sessionId, section as "company" | "people");
      setState(data.state);
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [section]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setVerifying((prev) => {
        const next = new Set(prev);
        next.delete(section);
        return next;
      });
    }
  }

  async function handleIntakeSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const myCompany = (form.elements.namedItem("myCompany") as HTMLInputElement).value.trim();
    const whatIDo = (form.elements.namedItem("whatIDo") as HTMLTextAreaElement).value.trim();
    if (!myCompany || !whatIDo) return;
    setIntakeBusy(true);
    setIntakeError("");
    try {
      const data = await api.startOutreachSession(myCompany, whatIDo);
      setSessionId(data.sessionId);
      setState(data.state);
      await runSection(data.sessionId, "icp");
    } catch (err) {
      setIntakeError(err instanceof Error ? err.message : String(err));
    } finally {
      setIntakeBusy(false);
    }
  }

  async function handlePickTarget(name: string) {
    if (!sessionId) return;
    try {
      const data = await api.setOutreachTarget(sessionId, name);
      setState(data.state);
      setErrors((prev) => ({
        ...prev,
        industry: undefined,
        company: undefined,
        people: undefined,
        outreach: undefined,
      }));
      for (const section of DOWNSTREAM) {
        const ok = await runSection(sessionId, section);
        if (!ok) break;
      }
    } catch (err) {
      setIntakeError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSaveCompanyInfo(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!sessionId) return;
    const form = e.currentTarget;
    const myCompany = (form.elements.namedItem("myCompany") as HTMLInputElement).value.trim();
    const whatIDo = (form.elements.namedItem("whatIDo") as HTMLTextAreaElement).value.trim();
    if (!myCompany || !whatIDo) return;
    const data = await api.updateOutreachCompanyInfo(sessionId, myCompany, whatIDo);
    setState(data.state);
    setCompanyEditOpen(false);
  }

  function startEdit(section: OutreachSection) {
    if (!state) return;
    setEditing(section);
    setEditError("");
    setEditDraft(JSON.stringify(state.sections[section], null, 2));
  }

  async function saveEdit() {
    if (!sessionId || !editing) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(editDraft);
    } catch (err) {
      setEditError("That's not valid JSON — " + (err instanceof Error ? err.message : String(err)));
      return;
    }
    try {
      const data = await api.editOutreachSection(sessionId, editing, parsed);
      setState(data.state);
      setEditing(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 md:px-8">
      <Button type="button" variant="ghost" size="sm" onClick={() => go("today")} className="mb-4">
        ← Back to dashboard
      </Button>

      <div className="mb-6 rounded-nb border-[3px] border-edge bg-card p-5 shadow-[var(--nb-shadow)]">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--color-ink-muted)]">
          Art of Selling · AI Agent Workshops 1 &amp; 2
        </p>
        <h1 className="mb-2 text-2xl font-bold">Outreach agent</h1>
        <p className="max-w-[70ch] text-[14px] text-[color:var(--color-ink-muted)]">
          Five research steps (Step 0 → Step 4), each grounded in live search and the course&apos;s
          own brain, each showing exactly what it fed in, and each with a process log of what it
          actually did. An independent grading pass bans unsourced claims before they can reach a
          message.
        </p>
      </div>

      {!state && (
        <Card>
          <SectionHeader>Step 0 — who should you sell to?</SectionHeader>
          <form onSubmit={handleIntakeSubmit} className="grid gap-3">
            <label className="text-[13px] font-bold" htmlFor="myCompany">
              What company are you from?
            </label>
            <input
              id="myCompany"
              name="myCompany"
              type="text"
              placeholder="e.g. Zenskar"
              required
              className="rounded-nb border-[3px] border-edge bg-paper px-3 py-2 text-[14px]"
            />
            <label className="text-[13px] font-bold" htmlFor="whatIDo">
              What do you do?
            </label>
            <textarea
              id="whatIDo"
              name="whatIDo"
              rows={3}
              required
              placeholder="One line: what you sell and who it's for."
              className="rounded-nb border-[3px] border-edge bg-paper px-3 py-2 text-[14px]"
            />
            {intakeError && (
              <p className="rounded-nb border-[3px] border-edge bg-bad p-2 text-[13px] font-bold text-black">
                {intakeError}
              </p>
            )}
            <Button type="submit" disabled={intakeBusy}>
              {intakeBusy ? "Working…" : "Find my ICP"}
            </Button>
          </form>
        </Card>
      )}

      {state && (
        <>
          <div className="mb-6 flex items-start justify-between gap-4 rounded-nb border-[3px] border-edge bg-card p-4 shadow-[var(--nb-shadow)]">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--color-ink-muted)]">
                Selling for
              </p>
              <p className="font-bold">{state.myCompany}</p>
              <p className="text-[13px] text-[color:var(--color-ink-muted)]">{state.whatIDo}</p>
            </div>
            <Button
              type="button"
              variant="neutral"
              size="sm"
              onClick={() => setCompanyEditOpen((v) => !v)}
            >
              Edit
            </Button>
          </div>

          {companyEditOpen && (
            <Card className="mb-6">
              <form onSubmit={handleSaveCompanyInfo} className="grid gap-3">
                <input
                  name="myCompany"
                  defaultValue={state.myCompany}
                  className="rounded-nb border-[3px] border-edge bg-paper px-3 py-2 text-[14px]"
                />
                <textarea
                  name="whatIDo"
                  defaultValue={state.whatIDo}
                  rows={2}
                  className="rounded-nb border-[3px] border-edge bg-paper px-3 py-2 text-[14px]"
                />
                <div className="flex gap-2">
                  <Button type="submit" size="sm">
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="neutral"
                    size="sm"
                    onClick={() => setCompanyEditOpen(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </Card>
          )}

          <PipelineTable state={state} loading={loading} errors={errors} />

          <SectionCard
            section="icp"
            state={state}
            loading={loading.has("icp")}
            error={errors.icp}
            onRegenerate={() => sessionId && runSection(sessionId, "icp")}
            onEdit={() => startEdit("icp")}
            renderContent={(content) => (
              <IcpBody content={content} onPickTarget={handlePickTarget} />
            )}
          />

          {state.targetAccount && (
            <div className="mb-6 flex items-center justify-between gap-4 rounded-nb border-[3px] border-edge bg-card p-4 shadow-[var(--nb-shadow)]">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--color-ink-muted)]">
                  Target account
                </p>
                <p className="font-bold">{state.targetAccount}</p>
              </div>
              <Button
                type="button"
                variant="neutral"
                size="sm"
                onClick={() =>
                  document.getElementById("section-icp")?.scrollIntoView({ behavior: "smooth" })
                }
              >
                Change
              </Button>
            </div>
          )}

          {state.doNotUse.length > 0 && (
            <div className="mb-6 rounded-nb border-[3px] border-edge bg-bad p-4 text-black shadow-[var(--nb-shadow)]">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em]">
                Banned by grading — {state.doNotUse.length} claim(s) excluded from outreach
              </p>
              <ul className="list-disc space-y-1 pl-5 text-[13px]">
                {state.doNotUse.map((claim, i) => (
                  <li key={i}>{claim}</li>
                ))}
              </ul>
            </div>
          )}

          {state.targetAccount &&
            DOWNSTREAM.map((section) => (
              <SectionCard
                key={section}
                section={section}
                state={state}
                loading={loading.has(section)}
                verifying={SECTION_META[section].verifiable ? verifying.has(section) : false}
                error={errors[section]}
                onRegenerate={() => sessionId && runSection(sessionId, section)}
                onVerify={
                  SECTION_META[section].verifiable ? () => handleVerify(section) : undefined
                }
                onEdit={() => startEdit(section)}
                renderContent={(content) => <BodyFor section={section} content={content} />}
              />
            ))}
        </>
      )}

      {editing && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[80vh] w-full max-w-[700px] overflow-auto rounded-nb border-[3px] border-edge bg-card p-4 shadow-[var(--nb-shadow)]">
            <p className="mb-2 font-bold">Edit {SECTION_META[editing].title}</p>
            <textarea
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              rows={18}
              className="w-full rounded-nb border-[3px] border-edge bg-paper p-3 font-mono text-[12px]"
            />
            {editError && (
              <p className="mt-2 rounded-nb border-[3px] border-edge bg-bad p-2 text-[13px] font-bold text-black">
                {editError}
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <Button type="button" size="sm" onClick={saveEdit}>
                Save
              </Button>
              <Button type="button" variant="neutral" size="sm" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionCard({
  section,
  state,
  loading,
  verifying = false,
  error,
  onRegenerate,
  onVerify,
  onEdit,
  renderContent,
}: {
  section: OutreachSection;
  state: OutreachState;
  loading: boolean;
  verifying?: boolean;
  error?: string;
  onRegenerate: () => void;
  onVerify?: () => void;
  onEdit: () => void;
  renderContent: (content: Record<string, unknown>) => React.ReactNode;
}) {
  const content = state.sections[section];
  const meta = SECTION_META[section];
  const verification = meta.verifiable
    ? (state.verification[section] as Record<string, unknown> | null | undefined)
    : undefined;
  return (
    <Card id={`section-${section}`} className="mb-6">
      <div className="mb-1 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--color-ink-muted)]">
            {meta.step}
          </p>
          <CardTitle className="text-lg">{meta.title}</CardTitle>
        </div>
        {content && !loading && (
          <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
            {state.edited[section] && <StatePill state="soon">Edited by you</StatePill>}
            {onVerify && (
              <Button
                type="button"
                variant="neutral"
                size="sm"
                onClick={onVerify}
                disabled={verifying}
              >
                {verifying ? "Grading…" : "Verify"}
              </Button>
            )}
            <Button type="button" variant="neutral" size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button type="button" variant="neutral" size="sm" onClick={onRegenerate}>
              Regenerate
            </Button>
          </div>
        )}
      </div>
      <p className="mb-3 text-[11px] text-[color:var(--color-ink-muted)]">
        <b className="font-bold">In</b> {meta.input} <span className="mx-1">→</span>
        <b className="font-bold">Out</b> {meta.output}
      </p>

      {loading && (
        <div className="flex items-center gap-3 py-2">
          <div className="h-6 w-6 flex-shrink-0 animate-spin rounded-full border-[3px] border-edge border-t-transparent" />
          <p className="text-[13px] text-[color:var(--color-ink-muted)]">
            Researching &amp; grounding — live search plus the course brain…
          </p>
        </div>
      )}

      {!loading && error && (
        <div>
          <p className="mb-2 rounded-nb border-[3px] border-edge bg-bad p-2 text-[13px] font-bold text-black">
            {error}
          </p>
          <Button type="button" variant="neutral" size="sm" onClick={onRegenerate}>
            Try again
          </Button>
        </div>
      )}

      {!loading && !error && content && (
        <>
          {renderContent(content)}
          {verification && section === "outreach" && (
            <MessageVerificationPanel result={verification} />
          )}
          {verification && section !== "outreach" && <VerificationPanel result={verification} />}
          <SourcesFooter sources={content._sources} />
          <ProcessLog log={content._log} />
        </>
      )}
    </Card>
  );
}
