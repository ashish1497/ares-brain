import json
import requests
import scrape_steps
import mesa_api

FILE_MAT = {
    "id": "file-mat-1", "topicId": "resources-topic", "title": "Deck",
    "category": "resource", "kind": "file", "content": None,
    "fileName": "deck.pdf", "fileType": "pdf", "sizeBytes": 123,
    "allowDownload": True, "updatedAt": "2026-08-28T05:54:00.896Z",
}


class FakeClient:
    def __init__(self, scrubbed): self.s = scrubbed
    def get(self, path, params=None):
        if path == "/content/topics/outline-topic/materials":
            return self.s("topic_materials.json")["data"]
        if path == "/content/topics/resources-topic/materials":
            return self.s("topic_materials_files.json")["data"]
        if path.startswith("/content/materials/") and path.endswith("/signed-url"):
            return {"url": "https://example.test/asset/file.pdf"}
        return {"materials": []}


def test_materials_manifest_and_file_fallback(home, scrubbed, monkeypatch):
    course = {"id": "bf", "name": "BF", "slug": "bf"}
    topics = [{"id": "outline-topic", "type": "outline"},
              {"id": "resources-topic", "type": "resources"}]

    class Resp:
        status_code = 200
        content = b"%PDF-1.4 fake"
        def raise_for_status(self): pass
    monkeypatch.setattr(scrape_steps.requests, "get", lambda *a, **k: Resp())

    cfg = mesa_api.load_config()
    r = scrape_steps.step_materials(FakeClient(scrubbed), cfg, course, topics)
    manifest = json.loads((home / "courses" / "bf" / "raw" / "materials.json").read_text())
    assert r["materials"] == len(manifest) >= 2
    file_entries = [m for m in manifest if m["kind"] == "file"]
    assert file_entries and file_entries[0]["localPath"].endswith(".pdf")
    dl = home / "courses" / "bf" / "raw" / "files" / f"{file_entries[0]['id']}.pdf"
    assert dl.exists()
    assert dl.read_bytes() == b"%PDF-1.4 fake"
    assert r["files"] == 1 and r["fileErrors"] == 0
    text_entries = [m for m in manifest if m["kind"] == "text"]
    assert text_entries[0]["content"]  # HTML kept inline


class OneFileClient:
    """Serves a single kind:file material; signed-url behaviour is configurable."""
    def __init__(self, signed): self._signed = signed
    def get(self, path, params=None):
        if path.endswith("/materials") and "resources-topic" in path:
            return {"materials": [dict(FILE_MAT)]}
        if path.endswith("/materials"):
            return {"materials": []}
        if path.endswith("/signed-url"):
            return self._signed()
        return {"materials": []}


_COURSE = {"id": "bf", "name": "BF", "slug": "bf"}
_TOPICS = [{"id": "resources-topic", "type": "resources"}]


def _run(client, monkeypatch, resp_factory=None):
    if resp_factory is not None:
        monkeypatch.setattr(scrape_steps.requests, "get", lambda *a, **k: resp_factory())
    cfg = mesa_api.load_config()
    return scrape_steps.step_materials(client, cfg, _COURSE, _TOPICS)


def _manifest(home):
    return json.loads((home / "courses" / "bf" / "raw" / "materials.json").read_text())


def test_signed_url_failure_never_raises(home, monkeypatch):
    def boom(): raise RuntimeError("signed-url endpoint gone")
    r = _run(OneFileClient(boom), monkeypatch, resp_factory=lambda: None)
    m = _manifest(home)
    assert len(m) == 1 and m[0]["localPath"] is None
    assert r == {"materials": 1, "files": 0, "fileErrors": 1}


def test_signed_url_missing_key_never_raises(home, monkeypatch):
    r = _run(OneFileClient(lambda: {}), monkeypatch, resp_factory=lambda: None)
    m = _manifest(home)
    assert m[0]["localPath"] is None
    assert r["fileErrors"] == 1 and r["files"] == 0


def test_download_http_error_counted(home, monkeypatch):
    class Resp:
        status_code = 500
        content = b""
        def raise_for_status(self): raise requests.HTTPError("500")
    r = _run(OneFileClient(lambda: {"url": "https://example.test/x.pdf"}),
             monkeypatch, resp_factory=Resp)
    m = _manifest(home)
    assert m[0]["localPath"] is None
    assert r["fileErrors"] == 1 and r["files"] == 0


def test_materials_idempotent(home, monkeypatch):
    files_dir = home / "courses" / "bf" / "raw" / "files"
    files_dir.mkdir(parents=True)
    (files_dir / "file-mat-1.pdf").write_bytes(b"already here")

    def explode(): raise AssertionError("signed-url should not be called")
    monkeypatch.setattr(scrape_steps.requests, "get",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("requests.get should not be called")))
    cfg = mesa_api.load_config()
    r = scrape_steps.step_materials(OneFileClient(explode), cfg, _COURSE, _TOPICS)
    m = _manifest(home)
    assert m[0]["localPath"] == "files/file-mat-1.pdf"
    assert r["files"] == 1 and r["fileErrors"] == 0
    assert (files_dir / "file-mat-1.pdf").read_bytes() == b"already here"


LINK_MAT = {
    "id": "L1", "topicId": "resources-topic", "title": "Workbook",
    "category": "resource", "kind": "link", "content": None,
    "fileName": None, "fileType": None, "sizeBytes": None,
    "url": "https://example.com/workbook", "allowDownload": False,
    "updatedAt": "2026-08-28T05:54:00.896Z",
}


class OneLinkClient:
    def get(self, path, params=None):
        if path.endswith("/materials") and "resources-topic" in path:
            return {"materials": [dict(LINK_MAT)]}
        return {"materials": []}


def test_link_material_keeps_url(home, monkeypatch):
    monkeypatch.setattr(scrape_steps.requests, "get",
                        lambda *a, **k: (_ for _ in ()).throw(
                            AssertionError("no download for kind:link")))
    r = _run(OneLinkClient(), monkeypatch)
    m = _manifest(home)
    assert len(m) == 1
    assert m[0]["url"] == "https://example.com/workbook"
    assert m[0]["localPath"] is None
    assert m[0]["kind"] == "link"
    assert r["materials"] == 1 and r["files"] == 0 and r["fileErrors"] == 0
