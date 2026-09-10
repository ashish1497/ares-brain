import json
import subprocess
import pytest
import transcribe


class FakeResp:
    def __init__(self, text):
        self.text = text


class FakeFiles:
    def __init__(self):
        self.uploaded = []
        self.deleted = []

    def upload(self, file):
        self.uploaded.append(file)
        return type("U", (), {"name": f"files/{len(self.uploaded)}"})()

    def delete(self, name):
        self.deleted.append(name)


class FakeModels:
    def __init__(self, texts):
        self._texts = list(texts)
        self.calls = 0

    def generate_content(self, model, contents):
        i = min(self.calls, len(self._texts) - 1)
        self.calls += 1
        return FakeResp(self._texts[i])


class FakeClient:
    def __init__(self, texts):
        self.files = FakeFiles()
        self.models = FakeModels(texts)


def _fake_split(n_chunks):
    def _split(audio, out_dir):
        chunks = []
        for i in range(n_chunks):
            p = out_dir / f"chunk_{i:03d}.mp3"
            p.write_bytes(b"x")
            chunks.append(p)
        return chunks
    return _split


@pytest.fixture(autouse=True)
def _keys(monkeypatch):
    monkeypatch.setenv("GOOGLE_GEMINI_KEY", "k1")
    monkeypatch.delenv("GOOGLE_GEMINI_KEY_2", raising=False)
    monkeypatch.delenv("GOOGLE_GEMINI_KEY_3", raising=False)


def test_gemini_transcribe_single_chunk(monkeypatch, tmp_path):
    monkeypatch.setattr(transcribe, "_gemini_split", _fake_split(1))
    client = FakeClient(["[00:05] hello ji\n[00:12] kaise ho"])
    monkeypatch.setattr(transcribe._GeminiClient, "_make_client",
                        lambda self: client)
    segs = transcribe._gemini_transcribe(tmp_path / "a.m4a")
    assert segs == [(5.0, "hello ji"), (12.0, "kaise ho")]
    assert client.files.deleted  # cleaned up


def test_gemini_transcribe_chunk_offset(monkeypatch, tmp_path):
    monkeypatch.setattr(transcribe, "_gemini_split", _fake_split(2))
    client = FakeClient(["[00:05] one", "[00:03] two"])
    monkeypatch.setattr(transcribe._GeminiClient, "_make_client",
                        lambda self: client)
    monkeypatch.setattr(transcribe.time, "sleep", lambda *_: None)
    segs = transcribe._gemini_transcribe(tmp_path / "a.m4a")
    assert segs == [(5.0, "one"), (903.0, "two")]


def test_gemini_transcribe_hms_timestamp(monkeypatch, tmp_path):
    monkeypatch.setattr(transcribe, "_gemini_split", _fake_split(1))
    # Gemini often wraps one utterance across lines without a fresh marker;
    # continuation text stays attached to the preceding timestamp.
    client = FakeClient(["[1:02:03] deep\ncontinues here\n[00:01] a"])
    monkeypatch.setattr(transcribe._GeminiClient, "_make_client",
                        lambda self: client)
    segs = transcribe._gemini_transcribe(tmp_path / "a.m4a")
    assert segs == [(3723.0, "deep continues here"), (1.0, "a")]


def test_gemini_transcribe_tiny_unusable_chunk_logged(monkeypatch, tmp_path, capsys):
    # short, no timestamps — retry (same fake text) also fails, text too short
    # to keep as a block → nothing, logged.
    monkeypatch.setattr(transcribe, "_gemini_split", _fake_split(1))
    client = FakeClient(["silence"])
    monkeypatch.setattr(transcribe._GeminiClient, "_make_client",
                        lambda self: client)
    segs = transcribe._gemini_transcribe(tmp_path / "a.m4a")
    assert segs == []
    assert "nothing usable" in capsys.readouterr().err


def test_gemini_transcribe_untimestamped_chunk_kept_as_block(monkeypatch, tmp_path, capsys):
    # a real paragraph with no [MM:SS] markers is kept as one block at the
    # chunk offset rather than lost.
    prose = ("The speaker discussed personal branding on LinkedIn at length "
             "without any timestamps in the response at all here.")
    monkeypatch.setattr(transcribe, "_gemini_split", _fake_split(2))
    # chunk 0: initial + retry both return the untimestamped prose; chunk 1 ok
    client = FakeClient([prose, prose, "[00:04] second chunk ok"])
    monkeypatch.setattr(transcribe._GeminiClient, "_make_client",
                        lambda self: client)
    segs = transcribe._gemini_transcribe(tmp_path / "a.m4a")
    assert segs[0] == (0.0, prose)
    assert segs[1] == (904.0, "second chunk ok")
    assert "kept as one block" in capsys.readouterr().err


def test_gemini_key_rotation_on_429(monkeypatch, tmp_path):
    monkeypatch.setenv("GOOGLE_GEMINI_KEY_2", "k2")
    monkeypatch.setattr(transcribe, "_gemini_split", _fake_split(1))
    monkeypatch.setattr(transcribe.time, "sleep", lambda *_: None)

    good = FakeClient(["[00:02] ok"])

    def make(self):
        if self._idx == 0:
            raise RuntimeError("boom")  # not used; _make_client itself is fine
        return good

    calls = {"n": 0}

    class RaisingModels:
        def generate_content(self, model, contents):
            raise RuntimeError("429 RESOURCE_EXHAUSTED")

    bad = FakeClient(["x"])
    bad.models = RaisingModels()

    clients = [bad, good]

    def _make_client(self):
        return clients[self._idx]

    monkeypatch.setattr(transcribe._GeminiClient, "_make_client", _make_client)
    segs = transcribe._gemini_transcribe(tmp_path / "a.m4a")
    assert segs == [(2.0, "ok")]


def test_gemini_all_keys_fail_raises(monkeypatch, tmp_path):
    monkeypatch.setenv("GOOGLE_GEMINI_KEY_2", "k2")
    monkeypatch.setattr(transcribe, "_gemini_split", _fake_split(1))
    monkeypatch.setattr(transcribe.time, "sleep", lambda *_: None)

    class RaisingModels:
        def generate_content(self, model, contents):
            raise RuntimeError("503 overloaded")

    def _make_client(self):
        c = FakeClient(["x"])
        c.models = RaisingModels()
        return c

    monkeypatch.setattr(transcribe._GeminiClient, "_make_client", _make_client)
    with pytest.raises(RuntimeError):
        transcribe._gemini_transcribe(tmp_path / "a.m4a")


def test_gemini_no_keys_raises(monkeypatch):
    monkeypatch.delenv("GOOGLE_GEMINI_KEY", raising=False)
    with pytest.raises(RuntimeError, match="no GOOGLE_GEMINI_KEY"):
        transcribe._GeminiClient()


def test_transcribe_audio_whisper_dispatch(monkeypatch, tmp_path):
    monkeypatch.setattr(transcribe, "_whisper", lambda a: [(1.0, "w")])
    assert transcribe._transcribe_audio(tmp_path / "a", "whisper") == [(1.0, "w")]


def test_transcribe_audio_gemini_dispatch(monkeypatch, tmp_path):
    monkeypatch.setattr(transcribe, "_gemini_transcribe", lambda a: [(2.0, "g")])
    assert transcribe._transcribe_audio(tmp_path / "a", "gemini") == [(2.0, "g")]


def test_cli_transcribe_engine_threaded(home, monkeypatch):
    import importlib, paths, lms_scrape, scrape_steps
    (home / "courses").mkdir(parents=True, exist_ok=True)
    (home / "courses" / "_index.json").write_text(json.dumps([]))
    importlib.reload(paths)
    import transcribe as _t
    importlib.reload(_t)
    captured = {}
    monkeypatch.setattr(_t, "step_transcribe",
                        lambda *a, **k: captured.update(k) or {"ok": True})
    lms_scrape.run(["transcribe", "--course", "x", "--engine", "gemini", "--json"])
    assert captured.get("engine") == "gemini"
