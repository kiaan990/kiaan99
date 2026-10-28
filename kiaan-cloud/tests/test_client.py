import httpx
import pytest

from brightspace.client import Client, Forbidden, SessionExpired, redact


def make(bs_home, handler):
    return Client(transport=httpx.MockTransport(handler), retry_delay=0)


def test_happy_path_sends_cookies_and_ua(bs_home):
    seen = {}

    def h(req):
        seen["cookie"] = req.headers.get("cookie", "")
        seen["ua"] = req.headers.get("user-agent", "")
        return httpx.Response(200, json={"FirstName": "Student"})

    with make(bs_home, h) as c:
        assert c.whoami()["FirstName"] == "Student"
    assert "d2lSessionVal=SECRET-SESSION" in seen["cookie"]
    assert "Mozilla/5.0" in seen["ua"]


def test_401_raises_session_expired(bs_home):
    with make(bs_home, lambda r: httpx.Response(401)) as c:
        with pytest.raises(SessionExpired):
            c.news(1)


def test_redirect_to_login_raises_session_expired(bs_home):
    h = lambda r: httpx.Response(302, headers={"location": "/d2l/login?sessionExpired=1"})
    with make(bs_home, h) as c:
        with pytest.raises(SessionExpired):
            c.toc(1)


def test_403_with_dead_session_is_session_expired(bs_home):
    with make(bs_home, lambda r: httpx.Response(403)) as c:
        with pytest.raises(SessionExpired):
            c.quizzes(1)


def test_403_with_live_session_is_forbidden(bs_home):
    def h(r):
        if r.url.path.endswith("/users/whoami"):
            return httpx.Response(200, json={"FirstName": "S"})
        return httpx.Response(403)

    with make(bs_home, h) as c:
        with pytest.raises(Forbidden):
            c.quizzes(1)


def test_5xx_is_retried_once(bs_home):
    calls = []

    def h(r):
        calls.append(1)
        return httpx.Response(503) if len(calls) == 1 else httpx.Response(200, json=[])

    with make(bs_home, h) as c:
        assert c.news(1) == []
    assert len(calls) == 2


def test_5xx_twice_raises(bs_home):
    from brightspace.client import BrightspaceError

    with make(bs_home, lambda r: httpx.Response(502)) as c:
        with pytest.raises(BrightspaceError):
            c.news(1)


def test_html_login_page_instead_of_json_is_session_expired(bs_home):
    h = lambda r: httpx.Response(200, text="<html>Sign in</html>", headers={"content-type": "text/html"})
    with make(bs_home, h) as c:
        with pytest.raises(SessionExpired):
            c.news(1)


def test_missing_cookie_file(bs_home):
    (bs_home / "cookies.json").unlink()
    with pytest.raises(SessionExpired):
        Client()


def test_errors_and_redaction_never_leak_cookie_values(bs_home):
    with make(bs_home, lambda r: httpx.Response(401)) as c:
        with pytest.raises(SessionExpired) as ei:
            c.whoami()
    assert "SECRET" not in str(ei.value)
    assert "SECRET" not in str(redact({"d2lSessionVal": "SECRET-SESSION"}))
