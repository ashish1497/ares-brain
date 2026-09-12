import { useEffect, useState, type ReactNode } from "react";
import { getDailyBrief } from "../../api";
import { Card } from "../ui/card";
import { SectionHeader } from "../SectionHeader";

/** `` `code` ``, `**bold**`, and `_italic_` runs within an otherwise plain line —
 * including a partial run (e.g. `_no pre-reads found_ (posted this morning)`),
 * not just a line that's wholly wrapped. Code spans are matched first so an
 * underscore inside one (e.g. `` `lms_scrape.py` ``) is never mistaken for an
 * italic marker — the digest text is full of underscored file/command names. */
function InlineText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|_[^_]+_)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("`") && p.endsWith("`"))
          return (
            <code key={i} className="rounded bg-paper px-1 py-0.5 font-mono text-[12px]">
              {p.slice(1, -1)}
            </code>
          );
        if (p.startsWith("**") && p.endsWith("**"))
          return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith("_") && p.endsWith("_"))
          return (
            <em key={i} className="text-[color:var(--color-ink-muted)]">
              {p.slice(1, -1)}
            </em>
          );
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

/** A `- ` (or indented `  - `) line, with its leading-space depth. */
function listMatch(line: string): { indent: number; content: string } | null {
  const m = /^( *)- (.*)$/.exec(line);
  return m ? { indent: m[1].length, content: m[2] } : null;
}

/** Recursively consumes `- ` lines at exactly `indent`, nesting any more-indented
 * run immediately under the item it follows. Returns the list and the next
 * unconsumed line index. */
function parseList(
  lines: string[],
  start: number,
  indent: number,
  key: () => number,
): { node: ReactNode; next: number } {
  const items: ReactNode[] = [];
  let i = start;
  while (i < lines.length) {
    const m = listMatch(lines[i]);
    if (!m || m.indent !== indent) break;
    i++;
    let nested: ReactNode = null;
    const nextM = i < lines.length ? listMatch(lines[i]) : null;
    if (nextM && nextM.indent > indent) {
      const r = parseList(lines, i, nextM.indent, key);
      nested = r.node;
      i = r.next;
    }
    items.push(
      <li key={key()}>
        <InlineText text={m.content} />
        {nested}
      </li>,
    );
  }
  return {
    node: (
      <ul key={key()} className="list-disc space-y-1 pl-5 text-[13px]">
        {items}
      </ul>
    ),
    next: i,
  };
}

/**
 * Renders exactly the subset of markdown the course-daily/course-evening
 * skills actually write (`#`/`##` headings, `> ` banners, `- ` lists with one
 * level of nesting, `**bold**`, `_italic_` empty-state lines, plain paragraphs)
 * — not a general parser.
 */
export function MarkdownLite({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let keyCounter = 0;
  const key = () => keyCounter++;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("> ")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quote.push(lines[i].slice(2));
        i++;
      }
      blocks.push(
        <div
          key={key()}
          className="rounded-nb border-[3px] border-bad bg-bad/10 px-3 py-2 text-[13px]"
        >
          {quote.map((q, j) => (
            <div key={j}>
              <InlineText text={q} />
            </div>
          ))}
        </div>,
      );
      continue;
    }

    if (line.startsWith("## ")) {
      blocks.push(
        <h4 key={key()} className="mt-3 text-[13px] font-bold uppercase tracking-wide">
          {line.slice(3)}
        </h4>,
      );
      i++;
      continue;
    }

    if (line.startsWith("# ")) {
      i++;
      continue; // the file's own H1 duplicates the panel's own header
    }

    const list = listMatch(line);
    if (list) {
      const r = parseList(lines, i, list.indent, key);
      blocks.push(r.node);
      i = r.next;
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("#") &&
      !listMatch(lines[i]) &&
      !lines[i].startsWith(">")
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key()} className="text-[13px] leading-relaxed">
        <InlineText text={para.join(" ")} />
      </p>,
    );
  }

  return <>{blocks}</>;
}

type Which = "morning" | "evening";

/** Surfaces the 6am/6pm ares-brain digest — the thing that previously only
 * existed as a `daily/<date>.md` file + a mac notification, invisible to the
 * dashboard itself. */
export function TodaysBrief() {
  const [morning, setMorning] = useState<string | null>(null);
  const [evening, setEvening] = useState<string | null>(null);
  const [tab, setTab] = useState<Which>("morning");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDailyBrief()
      .then((b) => {
        if (cancelled) return;
        setMorning(b.morning);
        setEvening(b.evening);
        setTab(b.evening ? "evening" : "morning");
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded || (!morning && !evening)) return null;

  const content = tab === "evening" ? evening : morning;

  return (
    <Card className="mb-6 gap-2 md:p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <SectionHeader rule={false} info="Written by the 6am/6pm ares-brain digest job.">
          Today's brief
        </SectionHeader>
        {morning && evening && (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setTab("morning")}
              className={`rounded-nb border-[3px] border-edge px-2 py-0.5 text-[11px] font-bold uppercase ${
                tab === "morning" ? "bg-cta text-black" : "bg-card"
              }`}
            >
              Morning
            </button>
            <button
              type="button"
              onClick={() => setTab("evening")}
              className={`rounded-nb border-[3px] border-edge px-2 py-0.5 text-[11px] font-bold uppercase ${
                tab === "evening" ? "bg-cta text-black" : "bg-card"
              }`}
            >
              Evening
            </button>
          </div>
        )}
      </div>
      {content && <MarkdownLite text={content} />}
    </Card>
  );
}
