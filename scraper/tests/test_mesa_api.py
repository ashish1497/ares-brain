import json
import os
import pytest
import mesa_api


class FakeResp:
    def __init__(self, status, body=None, cookies=None, set_cookie=None):
        self.status_code = status
        self.ok = 200 <= status < 300
        self._body = body or {}
        self.cookies = cookies or {}
        self.headers = {}
        if set_cookie:
            self.headers["Set-Cookie"] = set_cookie
    def json(self):
        return self._body


def test_refresh_persists_rotated_token(home, monkeypatch):
    (home / ".env").write_text("MESA_REFRESH_TOKEN=old-token\n")
    os.chmod(home / ".env", 0o600)

    def fake_post(url, headers=None, cookies=None, data=None, timeout=None):
        assert cookies == {"refresh_token": "old-token"}
        assert headers["Content-Type"] == "application/json"
        return FakeResp(200, {"data": {"accessToken": "new-access"}},
                        cookies={"refresh_token": "rotated-token"})

    monkeypatch.setattr(mesa_api.requests, "post", fake_post)
    token = mesa_api.refresh()
    assert token == "new-access"
    assert "MESA_REFRESH_TOKEN=rotated-token" in (home / ".env").read_text()
    assert oct(os.stat(home / ".env").st_mode)[-3:] == "600"


def test_refresh_spent_token_raises(home, monkeypatch):
    (home / ".env").write_text("MESA_REFRESH_TOKEN=spent\n")
    monkeypatch.setattr(mesa_api.requests, "post",
                        lambda *a, **k: FakeResp(200, {"error": {"message": "invalid"}}))
    with pytest.raises(mesa_api.AuthError):
        mesa_api.refresh()


def test_refresh_takes_lock_and_fsyncs(home, monkeypatch):
    (home / ".env").write_text("MESA_REFRESH_TOKEN=old-token\n")
    events = []

    real_flock = mesa_api.fcntl.flock
    real_fsync = os.fsync
    monkeypatch.setattr(mesa_api.fcntl, "flock",
                        lambda fd, op: (events.append("flock"), real_flock(fd, op))[1])
    monkeypatch.setattr(mesa_api.os, "fsync",
                        lambda fd: (events.append("fsync"), real_fsync(fd))[1])
    monkeypatch.setattr(mesa_api.requests, "post",
                        lambda *a, **k: FakeResp(200, {"data": {"accessToken": "a"}},
                                                 cookies={"refresh_token": "rot"}))

    mesa_api.refresh()
    assert "flock" in events and "fsync" in events
    # fsync happens inside persist, under the lock
    assert events.index("flock") < events.index("fsync")
    assert (home / ".token.lock").exists()
    assert "MESA_REFRESH_TOKEN=rot" in (home / ".env").read_text()


def test_get_unwraps_data_and_retries_on_401(home, monkeypatch):
    calls = []

    class FakeSession:
        def __init__(self): self.headers = {}
        def get(self, url, params=None, timeout=None):
            calls.append(url)
            if len(calls) == 1:
                return FakeResp(401, {"error": {"message": "expired"}})
            return FakeResp(200, {"data": {"courses": [{"id": "c1"}]}})

    monkeypatch.setattr(mesa_api.requests, "Session", FakeSession)
    monkeypatch.setattr(mesa_api, "refresh", lambda: "fresh-access")
    cfg = mesa_api.load_config()
    c = mesa_api.MesaClient("stale-access", cfg)
    data = c.get(cfg["endpoints"]["courses"], {"termId": "t1"})
    assert data == {"courses": [{"id": "c1"}]}
    assert len(calls) == 2
