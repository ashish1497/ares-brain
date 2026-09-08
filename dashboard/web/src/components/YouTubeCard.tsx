import { useState } from "preact/hooks";
import { Card } from "./Card";

export function YouTubeCard({
  course,
  busy,
  onRun,
}: {
  course: string;
  busy: boolean;
  onRun: (url: string, title: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [err, setErr] = useState("");
  return (
    <Card icon="brand-youtube" title="YouTube transcribe">
      <p class="mb-2 text-[13px] text-[var(--color-ink-soft)]">Paste a lecture link.</p>
      <input
        class="mb-2 h-9 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-sm"
        placeholder="https://youtu.be/…"
        value={url}
        onInput={(e) => {
          setUrl((e.target as HTMLInputElement).value);
          setErr("");
        }}
      />
      <input
        class="mb-2 h-9 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-sm"
        placeholder="title (optional)"
        value={title}
        onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
      />
      {err && <p class="mb-2 text-[12px] text-red-600">{err}</p>}
      <button
        class="h-9 w-full rounded-md border border-[var(--color-line)] text-sm enabled:border-transparent enabled:bg-[var(--color-accent)] enabled:text-white disabled:opacity-50"
        disabled={busy || !course}
        onClick={() => {
          if (!/^https?:\/\//.test(url.trim())) {
            setErr("Enter a valid URL first");
            return;
          }
          onRun(url.trim(), title.trim());
        }}
      >
        Transcribe
      </button>
    </Card>
  );
}
