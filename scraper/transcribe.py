"""Transcribe class recordings: pull audio from the YouTube link with yt-dlp,
run faster-whisper. All recordings are YouTube links (see docs/lms-api.md)."""
import hashlib
import os
import subprocess
import tempfile
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
            ["yt-dlp", "-x", "--audio-format", "m4a", "--no-playlist",
             "-o", out_tmpl, url],
            check=True, capture_output=True, timeout=900,
        )
    except Exception:  # noqa: BLE001 - never let audio pull abort transcription
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


def transcribe_url(slug: str, url: str, title: str | None = None) -> dict:
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
                segs = _whisper(audio)
            except Exception as exc:  # noqa: BLE001
                return {"ok": False, "error": f"transcription failed: {exc}"}
        _write_url_transcript(dest, url, resolved, segs)
        return {"ok": True, "path": f"transcripts/{dest.name}", "url": url, "title": resolved}
    except Exception as exc:  # noqa: BLE001 - never raise
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def step_transcribe(index: list[dict], course: str | None = None,
                    inbox_only: bool = False) -> dict:
    scope = [c for c in index if course is None or c["slug"] == course]
    transcribed, skipped, failed = [], [], []
    for c in scope:
        try:
            _transcribe_course(c, transcribed, skipped, failed, inbox_only=inbox_only)
        except Exception as exc:  # noqa: BLE001 - one bad course must not abort the rest
            failed.append({"id": c.get("slug", "?"), "status": "needs-manual",
                           "error": f"{type(exc).__name__}: {exc}"})
    return {"transcribed": transcribed, "skipped": skipped, "failed": failed}


def _transcribe_course(c: dict, transcribed: list, skipped: list, failed: list,
                       inbox_only: bool = False) -> None:
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
                        segs = _whisper(audio)
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
                segs = _whisper(f)
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
