#!/usr/bin/env python3
"""Silent Brightspace session refresh (runs every 6h from launchd).

Loads ~/.brightspace/state.json headlessly, lets Microsoft SSO re-authenticate
silently, confirms it landed on Brightspace (not a login page), saves the
refreshed state, and pushes the Brightspace cookies to kiaan-cloud over ssh.

Never loops and never types a password. If Microsoft wants a password or MFA,
it notifies (Mac notification + kiaan-cloud activity feed) and exits 2.

    refresh.py            # refresh + push
    refresh.py --status   # show local + droplet status, change nothing
"""
import argparse
import fcntl
import json
import sys
from datetime import datetime

import common

# Any of these visible means Microsoft wants a human (email, password, or MFA).
INTERACTIVE_SELECTORS = [
    'input[name="loginfmt"]:visible', 'input[type="password"]:visible', 'input[name="otc"]:visible',
    '#idDiv_SAOTCAS_Title:visible', '#idDiv_SAOTCC_Title:visible', '#idRichContext_DisplaySign:visible',
]


def refresh(host: str) -> int:
    from playwright.sync_api import TimeoutError as PWTimeout, sync_playwright

    if not common.STATE.exists():
        common.die("Brightspace: no saved login. Run capture.py once on the Mac.")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(storage_state=str(common.STATE))
        page = ctx.new_page()
        try:
            page.goto(f"https://{host}/d2l/home", wait_until="domcontentloaded", timeout=60000)
        except PWTimeout:
            pass
        me = None
        for _ in range(30):  # ~45s total, single pass, no retries of the login itself
            page.wait_for_timeout(1500)
            url = page.url
            if common.on_home(url, host):
                me = common.whoami_ok(ctx, host)
                if me:
                    break
                continue
            if "login.microsoftonline.com" in url or "login.live.com" in url:
                if any(page.locator(s).count() for s in INTERACTIVE_SELECTORS):
                    browser.close()
                    common.die("Brightspace login needs you: Microsoft is asking for password/MFA. "
                               "Run capture.py on the Mac.")
                # Harmless clicks only: account tile in "Pick an account", "Yes" on "Stay signed in?"
                for sel in ('div[data-test-id][role="listitem"] >> nth=0', '#idSIButton9', 'input[value="Yes"]'):
                    loc = page.locator(sel)
                    if loc.count():
                        try:
                            loc.first.click(timeout=3000)
                        except Exception:
                            pass
                        break
        if not me:
            final = page.url.split("?")[0]
            browser.close()
            common.die(f"Brightspace silent refresh failed (ended at {final}). Run capture.py on the Mac.")
        page.wait_for_timeout(1000)
        common.save_state(ctx)
        payload = common.extract(ctx, host, page.evaluate("navigator.userAgent"))
        browser.close()

    try:
        common.push(payload)
    except Exception as e:
        common.die(f"Brightspace refresh worked but push to kiaan-cloud failed: {e}", 1)
    ok = common.remote_ping()
    common.write_status(ok, "refreshed" if ok else "pushed, droplet ping failed")
    if not ok:
        common.notify("Brightspace cookies pushed but the droplet's check failed.")
        return 1
    return 0


def status() -> int:
    if common.STATE.exists():
        age = (datetime.now().timestamp() - common.STATE.stat().st_mtime) / 3600
        print(f"local state: {common.STATE} (updated {age:.1f}h ago)")
    else:
        print("local state: MISSING - run capture.py")
    if common.STATUS.exists():
        print("last refresh:", json.loads(common.STATUS.read_text()))
    if common.LOG.exists():
        print("recent log:\n  " + "\n  ".join(common.LOG.read_text().splitlines()[-5:]))
    code, out = common.remote(f"{common.REMOTE_PY} -m brightspace.client ping; {common.REMOTE_PY} -m brightspace.dashboard")
    print("droplet:\n  " + out.replace("\n", "\n  "))
    return 0 if code == 0 else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--host", default=common.HOST)
    a = ap.parse_args()
    if a.status:
        return status()
    common.ensure_dir()
    with open(common.STATE_DIR / "refresh.lock", "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            common.log("another refresh is running; exiting")
            return 0
        return refresh(a.host)


if __name__ == "__main__":
    sys.exit(main())
