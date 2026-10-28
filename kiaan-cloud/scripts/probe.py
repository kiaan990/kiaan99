"""Probe which D2L endpoints work for this student account.

Run on the droplet once cookies.json exists:
    cd /opt/kiaan-cloud && .venv/bin/python scripts/probe.py > /tmp/probe.md
Prints a markdown table (paste into docs/brightspace-api.md) and writes
scrubbed sample responses to tests/fixtures/recorded/. GET only.
"""
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from brightspace.client import BrightspaceError, Client, Forbidden, NotFound, SessionExpired  # noqa: E402
from brightspace.sync import select_courses  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "recorded"
PII_KEYS = re.compile(r"(FirstName|LastName|UniqueName|DisplayName|Email|ProfileIdentifier|OrgDefinedId|SubmittedBy|CreatedBy|LastModifiedBy|UserName)", re.I)


def scrub(o):
    if isinstance(o, dict):
        return {k: ("REDACTED" if PII_KEYS.search(k) else scrub(v)) for k, v in o.items()}
    if isinstance(o, list):
        return [scrub(x) for x in o[:5]]
    if isinstance(o, str) and len(o) > 160:
        return o[:160] + "…"
    return o


def try_versions(c, product, build, versions):
    for v in versions:
        path = f"/d2l/api/{product}/{v}{build}"
        try:
            return v, c.get_json(path), None
        except (Forbidden, NotFound) as e:
            err = type(e).__name__
            if isinstance(e, Forbidden):
                return v, None, err
        except SessionExpired:
            raise
        except BrightspaceError as e:
            err = str(e)
    return None, None, err


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    c = Client()
    v = c.versions()
    lp_try = [v["lp"], "1.50", "1.43", "1.30"]
    le_try = [v["le"], "1.80", "1.67", "1.50"]
    rows = []
    me = c.whoami()
    rows.append(("lp", "/users/whoami", v["lp"], "OK", ""))
    enr = c.enrollments()
    json.dump(scrub({"Items": enr}), open(OUT / "enrollments.json", "w"), indent=1)
    courses = select_courses(enr, datetime.now(timezone.utc))
    rows.append(("lp", "/enrollments/myenrollments/", v["lp"], "OK", f"{len(enr)} enrollments, {len(courses)} current: " + ", ".join(x["code"] for x in courses)))
    ou = courses[0]["org_unit_id"] if courses else None
    now = datetime.now(timezone.utc)
    fmt = "%Y-%m-%dT%H:%M:%S.000Z"
    checks = [
        ("le", f"/{ou}/dropbox/folders/", "dropbox"),
        ("le", f"/{ou}/grades/values/myGradeValues/", "grades"),
        ("le", f"/{ou}/grades/final/values/myGradeValue", "grades_final"),
        ("le", f"/{ou}/news/", "news"),
        ("le", f"/{ou}/content/toc", "toc"),
        ("le", f"/{ou}/quizzes/", "quizzes"),
        ("le", f"/calendar/events/myEvents/?startDateTime={now.strftime(fmt)}&endDateTime={(now + timedelta(days=30)).strftime(fmt)}", "calendar"),
    ]
    for product, build, name in checks:
        try:
            ver, data, err = try_versions(c, product, build, le_try if product == "le" else lp_try)
        except SessionExpired as e:
            print(f"SESSION EXPIRED during probe: {e}")
            return 3
        if data is not None:
            json.dump(scrub(data), open(OUT / f"{name}.json", "w"), indent=1)
            n = len(data) if isinstance(data, list) else len(data.get("Objects") or data.get("Modules") or []) if isinstance(data, dict) else ""
            rows.append((product, re.sub(r"/\d+/", "/{ou}/", build.split("?")[0]), ver, "OK", f"{n} items" if n != "" else ""))
            if name == "dropbox" and data:
                fid = data[0]["Id"]
                try:
                    c.my_submissions(ou, fid)
                    rows.append(("le", "/{ou}/dropbox/folders/{id}/submissions/mysubmissions/", v["le"], "OK", ""))
                except BrightspaceError as e:
                    rows.append(("le", "/{ou}/dropbox/folders/{id}/submissions/mysubmissions/", v["le"], type(e).__name__, ""))
            if name == "toc":
                def first_file(mods):
                    for m in mods or []:
                        for t in m.get("Topics") or []:
                            if t.get("TypeIdentifier") == "File":
                                return t
                        f = first_file(m.get("Modules"))
                        if f:
                            return f
                t = first_file(data.get("Modules"))
                if t:
                    try:
                        r = c._get(c.le(f"/{ou}/content/topics/{t['TopicId']}/file"), stream=True)
                        r.close()
                        rows.append(("le", "/{ou}/content/topics/{id}/file", v["le"], "OK", r.headers.get("content-type", "")))
                    except BrightspaceError as e:
                        rows.append(("le", "/{ou}/content/topics/{id}/file", v["le"], type(e).__name__, ""))
        else:
            rows.append((product, re.sub(r"/\d+/", "/{ou}/", build.split("?")[0]), ver or "-", err or "FAIL", "blocked for students" if err == "Forbidden" else ""))
    print(f"Probed {datetime.now().strftime('%Y-%m-%d %H:%M')} on {c.host} (lp {v['lp']}, le {v['le']}) as {me.get('FirstName','?')}\n")
    print("| product | endpoint | version | result | notes |\n|---|---|---|---|---|")
    for r in rows:
        print("| " + " | ".join(str(x) for x in r) + " |")
    return 0


if __name__ == "__main__":
    sys.exit(main())
