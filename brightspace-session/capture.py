#!/usr/bin/env python3
"""First-time (or after MFA re-prompt) Brightspace login.

Opens a real browser window on Brightspace. Sign in with Microsoft + MFA and
click YES on "Stay signed in?" (that is what makes later refreshes silent).
Saves the browser storage state to ~/.brightspace/state.json and pushes the
Brightspace cookies to kiaan-cloud. No password is stored anywhere.
"""
import argparse
import sys
import time

from playwright.sync_api import sync_playwright

import common


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default=common.HOST)
    ap.add_argument("--fresh", action="store_true", help="ignore any saved state")
    ap.add_argument("--no-push", action="store_true")
    ap.add_argument("--channel", default=None, help="e.g. 'chrome' to use installed Google Chrome")
    ap.add_argument("--timeout-min", type=int, default=10)
    a = ap.parse_args()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, channel=a.channel)
        state = str(common.STATE) if common.STATE.exists() and not a.fresh else None
        ctx = browser.new_context(storage_state=state)
        page = ctx.new_page()
        page.goto(f"https://{a.host}/d2l/home")
        print("\n>>> Sign in with your Bentley Microsoft account + MFA in the browser window.")
        print(">>> When asked 'Stay signed in?', click YES.\n")
        deadline = time.time() + a.timeout_min * 60
        me = None
        while time.time() < deadline:
            page.wait_for_timeout(2000)
            if common.on_home(page.url, a.host):
                me = common.whoami_ok(ctx, a.host)
                if me:
                    break
        if not me:
            browser.close()
            common.log("capture: timed out waiting for Brightspace home")
            return 2
        page.wait_for_timeout(1500)
        common.save_state(ctx)
        payload = common.extract(ctx, a.host, page.evaluate("navigator.userAgent"))
        browser.close()

    common.log(f"capture: signed in as {me.get('FirstName', '?')}, state saved to {common.STATE}")
    if a.no_push:
        return 0
    common.push(payload)
    ok = common.remote_ping()
    common.write_status(ok, "capture")
    print("Done. The droplet can read Brightspace now." if ok else "Pushed, but the droplet check failed; see above.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
