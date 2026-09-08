import { useRef, useState } from "preact/hooks";
import { Card } from "./Card";
import { upload } from "../api";

export function UploadCard({
  kind,
  course,
  busy,
  onQueued,
}: {
  kind: "book" | "recording";
  course: string;
  busy: boolean;
  onQueued: (kind: "ingest" | "transcribe-inbox") => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState("");
  const title = kind === "book" ? "Add books" : "Add recordings";
  const hint = kind === "book" ? "PDF or DOCX" : "Audio — transcribes after upload (~19 min)";

  async function pick(files: FileList | null) {
    if (!files?.length || !course) return;
    setMsg("uploading…");
    const r = await upload(course, kind, files);
    setMsg(
      [
        r.written.length ? `${r.written.length} uploaded` : "",
        r.rejected.length ? `${r.rejected.length} rejected` : "",
      ]
        .filter(Boolean)
        .join(" · ") || "nothing uploaded",
    );
    if (r.written.length) onQueued(kind === "book" ? "ingest" : "transcribe-inbox");
  }

  return (
    <Card icon={kind === "book" ? "book" : "microphone"} title={title}>
      <p class="mb-3 text-[13px] text-[var(--color-ink-soft)]">{hint}</p>
      <button
        class="h-9 w-full rounded-md border border-dashed border-[var(--color-line)] text-[13px] text-[var(--color-ink-soft)] disabled:opacity-50"
        disabled={busy || !course}
        onClick={() => input.current?.click()}
      >
        Choose files
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={kind === "book" ? ".pdf,.docx" : ".m4a,.mp3,.wav,.mp4,.webm"}
        onChange={(e) => pick((e.target as HTMLInputElement).files)}
      />
      {msg && <p class="mt-2 text-[12px] text-[var(--color-ink-soft)]">{msg}</p>}
    </Card>
  );
}
