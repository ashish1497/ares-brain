"""Transcribe class recordings: pull audio from the YouTube link with yt-dlp,
run faster-whisper. All recordings are YouTube links (see docs/lms-api.md)."""
import hashlib
import os
import re
import subprocess
import sys
import tempfile
import time
from datetime import date
from pathlib import Path

from paths import course_dir, raw_dir, ensure
from scrape_steps import _write_json, _read_or_none, global_file

try:
    from ingest import _yaml_scalar
except Exception:  # pragma: no cover - defensive against import cycles
    import json as _json

    def _yaml_scalar(v) -> str:
        return _json.dumps(str(v))

_MODEL = None


def _fmt_ts(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"


def _pull_audio(url: str, dest_dir: Path) -> Path | None:
    out_tmpl = str(dest_dir / "%(id)s.%(ext)s")
    try:
        subprocess.run(
            [sys.executable, "-m", "yt_dlp", "-x", "--audio-format", "m4a",
             "--no-playlist", "-o", out_tmpl, url],
            check=True, capture_output=True, timeout=900,
        )
    except subprocess.CalledProcessError as e:
        print(f"transcribe: yt-dlp failed for {url}: "
              f"{e.stderr.decode(errors='replace')[-800:]}", file=sys.stderr)
        return None
    except subprocess.TimeoutExpired:
        print(f"transcribe: yt-dlp timed out for {url}", file=sys.stderr)
        return None
    except Exception as e:  # noqa: BLE001 - never let audio pull abort transcription
        print(f"transcribe: yt-dlp error for {url}: {type(e).__name__}: {e}",
              file=sys.stderr)
        return None
    files = list(dest_dir.glob("*.m4a"))
    return files[0] if files else None


def _get_model():
    global _MODEL
    if _MODEL is None:
        from faster_whisper import WhisperModel
        _MODEL = WhisperModel(
            os.environ.get("WHISPER_MODEL", "small"),
            device="auto", compute_type="int8",
        )
    return _MODEL


def _whisper(audio: Path) -> list[tuple[float, str]]:
    segments, _info = _get_model().transcribe(str(audio), vad_filter=True)
    return [(seg.start, seg.text.strip()) for seg in segments if seg.text.strip()]


_GEMINI_RETRY_MARKERS = (
    "429", "resource_exhausted", "quota", "rate", "503", "500", "502", "504",
    "overloaded", "unavailable", "timeout", "timed out", "deadline",
    "connection", "temporarily",
)

_GEMINI_PROMPT = (
    "Transcribe this audio verbatim. Speakers mix Hindi and English (Hinglish) "
    "— transcribe each language as spoken, romanising Hindi in Latin script. "
    "Output ONLY lines of the form [MM:SS] text, one utterance or sentence per "
    "line, each line starting with its own [MM:SS] marker, timestamps relative "
    "to the start of THIS clip. No preamble, no notes."
)

_GEMINI_PROMPT_RETRY = (
    "Write out everything spoken in this audio, word for word. The speech mixes "
    "Hindi and English — keep both, romanising Hindi in Latin script. Begin "
    "every sentence with a [MM:SS] timestamp (minutes:seconds from the start of "
    "this clip). Output nothing but those timestamped lines."
)

# A timestamp marker anywhere in the text — Gemini sometimes runs several onto
# one line instead of one per line, so we scan rather than match line-anchored.
_GEMINI_TS_RE = re.compile(r"\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]")


def _gemini_keys() -> list[str]:
    keys = [os.environ.get(k) for k in
            ("GOOGLE_GEMINI_KEY", "GOOGLE_GEMINI_KEY_2", "GOOGLE_GEMINI_KEY_3")]
    return [k for k in keys if k]


class _GeminiClient:
    """Rotates through the available Gemini API keys on rate-limit / 5xx errors.

    ``call(fn)`` invokes ``fn(client)`` and, if it raises an error whose type
    name or message looks like a quota / rate-limit / server error, advances to
    the next key and retries the same call. The current key index is kept across
    calls so a run does not keep starting from an already-throttled key.
    """

    def __init__(self):
        self._keys = _gemini_keys()
        if not self._keys:
            raise RuntimeError("no GOOGLE_GEMINI_KEY* in env")
        self._idx = 0
        self._client = None

    @staticmethod
    def _is_retryable(exc: Exception) -> bool:
        blob = f"{type(exc).__name__} {exc}".lower()
        return any(m in blob for m in _GEMINI_RETRY_MARKERS)

    def _make_client(self):
        from google import genai
        from google.genai import types
        # Bound every HTTP call — a stalled socket must not hang the whole run.
        return genai.Client(
            api_key=self._keys[self._idx],
            http_options=types.HttpOptions(timeout=180_000),  # ms
        )

    def call(self, fn):
        attempts = 0
        while True:
            if self._client is None:
                self._client = self._make_client()
            try:
                return fn(self._client)
            except Exception as exc:  # noqa: BLE001
                attempts += 1
                if not self._is_retryable(exc) or attempts >= len(self._keys):
                    raise
                self._idx = (self._idx + 1) % len(self._keys)
                self._client = None
                print(f"transcribe: gemini key rotated ({type(exc).__name__}), "
                      f"retrying with key #{self._idx + 1}", file=sys.stderr)


def _gemini_split(audio: Path, out_dir: Path) -> list[Path]:
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(audio), "-f", "segment",
         "-segment_time", "900", "-c:a", "libmp3lame", "-ar", "16000",
         "-ac", "1", "-b:a", "64k", str(out_dir / "chunk_%03d.mp3")],
        check=True, capture_output=True, timeout=1800,
    )
    return sorted(out_dir.glob("chunk_*.mp3"))


def _gemini_parse(text: str, offset: float) -> list[tuple[float, str]]:
    text = (text or "").strip()
    marks = list(_GEMINI_TS_RE.finditer(text))
    if not marks:
        return []
    lead = text[: marks[0].start()].strip()  # text before the first marker
    out = []
    for i, m in enumerate(marks):
        a, b, c = m.groups()
        secs = float(int(a) * 3600 + int(b) * 60 + int(c)) if c is not None \
            else float(int(a) * 60 + int(b))
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        body = re.sub(r"\s+", " ", text[m.end():end]).strip()
        if i == 0 and lead:
            body = f"{lead} {body}".strip()
        if body:
            out.append((secs + offset, body))
    return out


def _gemini_transcribe(audio: Path) -> list[tuple[float, str]]:
    model = os.environ.get("GEMINI_TRANSCRIBE_MODEL", "gemini-flash-latest")
    client = _GeminiClient()
    pairs: list[tuple[float, str]] = []
    with tempfile.TemporaryDirectory() as tmp:
        chunks = _gemini_split(audio, Path(tmp))
        if not chunks:
            print(f"transcribe: gemini produced no chunks for {audio}",
                  file=sys.stderr)
            return []
        for i, chunk in enumerate(chunks):
            offset = i * 900
            if i:
                time.sleep(1)
            uploaded = client.call(lambda cl, ch=chunk: cl.files.upload(file=str(ch)))
            try:
                for _ in range(60):
                    st = getattr(getattr(uploaded, "state", None), "name", "") or ""
                    if st != "PROCESSING":
                        break
                    time.sleep(1)
                    uploaded = client.call(
                        lambda cl, n=uploaded.name: cl.files.get(name=n))
                resp = client.call(
                    lambda cl, up=uploaded: cl.models.generate_content(
                        model=model, contents=[up, _GEMINI_PROMPT]))
                raw = getattr(resp, "text", "") or ""
                got = _gemini_parse(raw, offset)
                if not got:
                    # Gemini ignored the [MM:SS] format for this chunk. Rather
                    # than lose ~15 min, retry once with a blunt prompt, then
                    # fall back to keeping the whole chunk as one block.
                    resp = client.call(
                        lambda cl, up=uploaded: cl.models.generate_content(
                            model=model, contents=[up, _GEMINI_PROMPT_RETRY]))
                    raw = getattr(resp, "text", "") or ""
                    got = _gemini_parse(raw, offset)
                if not got:
                    block = re.sub(r"\s+", " ", raw).strip()
                    if len(block) > 40:
                        got = [(float(offset), block)]
                        print(f"transcribe: gemini chunk {i} of {audio} had no "
                              f"timestamps — kept as one block", file=sys.stderr)
                    else:
                        print(f"transcribe: gemini chunk {i} of {audio} yielded "
                              f"nothing usable", file=sys.stderr)
                pairs.extend(got)
            finally:
                name = getattr(uploaded, "name", None)
                if name:
                    try:
                        client.call(lambda cl, n=name: cl.files.delete(name=n))
                    except Exception:  # noqa: BLE001
                        pass
    return pairs


def _transcribe_audio(audio: Path, engine: str = "whisper") -> list[tuple[float, str]]:
    if engine == "gemini":
        return _gemini_transcribe(audio)
    return _whisper(audio)


def _write_transcript(dest: Path, rec: dict, course: dict, segs: list) -> None:
    body = "\n".join(f"[{_fmt_ts(start)}] {text}" for start, text in segs)
    fm = [
        "---",
        "type: transcript",
        f"source: {_yaml_scalar('raw/recordings.json#' + str(rec['id']))}",
        f"title: {_yaml_scalar(rec.get('title', rec['id']))}",
        f"course: {_yaml_scalar(course['name'])}",
    ]
    if rec.get("recordedOn"):
        fm.append(f"recordedOn: {_yaml_scalar(rec['recordedOn'])}")
    fm += ["---", ""]
    ensure(dest.parent)
    dest.write_text("\n".join(fm) + body + "\n")


def _write_url_transcript(dest: Path, url: str, title: str, segs: list) -> None:
    body = "\n".join(f"[{_fmt_ts(s)}] {t}" for s, t in segs)
    fm = [
        "---",
        "type: transcript",
        f"source: {_yaml_scalar('url:' + url)}",
        f"title: {_yaml_scalar(title)}",
        f"recordedOn: {_yaml_scalar(date.today().isoformat())}",
        "---", "",
    ]
    ensure(dest.parent)
    dest.write_text("\n".join(fm) + body + "\n")


def transcribe_url(slug: str, url: str, title: str | None = None,
                   engine: str = "whisper") -> dict:
    try:
        idx = _read_or_none(global_file("_index.json")) or []
        course = next((c for c in idx if c.get("slug") == slug), None)
        if course is None:
            return {"ok": False, "error": f"unknown course slug: {slug}"}
        resolved = title or url
        dest = (course_dir(slug) / "transcripts"
                / f"url-{hashlib.sha1(url.encode()).hexdigest()[:10]}.md")
        if dest.exists():
            return {"ok": True, "path": f"transcripts/{dest.name}", "url": url,
                    "title": resolved, "skipped": True}
        with tempfile.TemporaryDirectory() as tmp:
            audio = _pull_audio(url, Path(tmp))
            if audio is None:
                return {"ok": False, "error": "could not pull audio from the url"}
            try:
                segs = _transcribe_audio(audio, engine)
            except Exception as exc:  # noqa: BLE001
                return {"ok": False, "error": f"transcription failed: {exc}"}
        _write_url_transcript(dest, url, resolved, segs)
        return {"ok": True, "path": f"transcripts/{dest.name}", "url": url, "title": resolved}
    except Exception as exc:  # noqa: BLE001 - never raise
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def step_transcribe(index: list[dict], course: str | None = None,
                    inbox_only: bool = False, engine: str = "whisper") -> dict:
    scope = [c for c in index if course is None or c["slug"] == course]
    transcribed, skipped, failed = [], [], []
    for c in scope:
        try:
            _transcribe_course(c, transcribed, skipped, failed,
                               inbox_only=inbox_only, engine=engine)
        except Exception as exc:  # noqa: BLE001 - one bad course must not abort the rest
            failed.append({"id": c.get("slug", "?"), "status": "needs-manual",
                           "error": f"{type(exc).__name__}: {exc}"})
    return {"transcribed": transcribed, "skipped": skipped, "failed": failed}


def _transcribe_course(c: dict, transcribed: list, skipped: list, failed: list,
                       inbox_only: bool = False, engine: str = "whisper") -> None:
    tdir = course_dir(c["slug"]) / "transcripts"
    recs = []
    if not inbox_only:
        try:
            recs = _read_or_none(raw_dir(c["slug"]) / "recordings.json") or []
        except Exception as exc:  # noqa: BLE001
            recs = []
            failed.append({"id": c.get("slug", "?"), "status": "needs-manual",
                           "error": f"recordings.json unreadable: {exc}"})
        if not isinstance(recs, list):
            recs = []
    inbox_root = course_dir(c["slug"]) / "inbox" / "recordings"
    inbox_recs = sorted(inbox_root.glob("*")) if inbox_root.exists() else []
    failed_here = []
    for rec in recs:
        try:
            if not isinstance(rec, dict) or "id" not in rec:
                raise ValueError(f"malformed recording entry: {rec!r}")
            dest = tdir / f"{rec['id']}.md"
            if dest.exists():
                skipped.append(rec["id"])
                continue
            with tempfile.TemporaryDirectory() as tmp:
                audio = _pull_audio(rec.get("videoUrl", ""), Path(tmp))
                segs = None
                if audio is not None:
                    try:
                        segs = _transcribe_audio(audio, engine)
                    except Exception:  # noqa: BLE001
                        segs = None
                if segs is None:
                    failed.append({"id": rec["id"], "status": "needs-manual"})
                    failed_here.append({"id": rec["id"], "status": "needs-manual",
                                        "title": rec.get("title")})
                    continue
            _write_transcript(dest, rec, c, segs)
            transcribed.append(rec["id"])
        except Exception as exc:  # noqa: BLE001
            rid = rec["id"] if isinstance(rec, dict) and "id" in rec else "?"
            failed.append({"id": rid, "status": "needs-manual"})
            failed_here.append({"id": rid, "status": "needs-manual",
                                "error": f"{type(exc).__name__}: {exc}"})
    for f in inbox_recs:
        try:
            if not f.is_file():
                continue
            rid = f"inbox-{f.stem}"
            dest = tdir / f"{rid}.md"
            if dest.exists():
                skipped.append(rid)
                continue
            try:
                segs = _transcribe_audio(f, engine)
            except Exception:  # noqa: BLE001
                failed.append({"id": rid, "status": "needs-manual"})
                failed_here.append({"id": rid, "status": "needs-manual", "title": f.name})
                continue
            _write_transcript(dest, {"id": rid, "title": f.name}, c, segs)
            transcribed.append(rid)
        except Exception as exc:  # noqa: BLE001
            failed.append({"id": f"inbox-{f.stem}", "status": "needs-manual"})
            failed_here.append({"id": f"inbox-{f.stem}", "status": "needs-manual",
                                "error": f"{type(exc).__name__}: {exc}"})
    if failed_here:
        ensure(tdir)
        _write_json(tdir / "_failed.json", failed_here)
