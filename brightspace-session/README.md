# brightspace-session (runs on the Mac)

Keeps a Brightspace browser session alive and copies its cookies to kiaan-cloud.
No password is ever stored. The saved state lives in `~/.brightspace/state.json` (0600).
It holds Microsoft's "stay signed in" cookies, which is why later refreshes are silent.

Setup once: `brightspace-session/install.sh` (creates `~/Projects/brightspace-session`, a venv,
installs Playwright Chromium, and loads the launchd job once a login exists).

## The three commands

```bash
# 1. First-time login, or whenever Microsoft asks for MFA again
~/Projects/brightspace-session/.venv/bin/python ~/Projects/brightspace-session/capture.py
#    Sign in + MFA in the window, click YES on "Stay signed in?". The window closes by itself.

# 2. Manual refresh (launchd runs this every 6 hours)
~/Projects/brightspace-session/.venv/bin/python ~/Projects/brightspace-session/refresh.py

# 3. Status (Mac side + droplet session + last sync)
~/Projects/brightspace-session/.venv/bin/python ~/Projects/brightspace-session/refresh.py --status
```

## What happens on failure

If Microsoft shows an email, password, or MFA prompt, `refresh.py` does not retry or loop.
It shows a Mac notification, writes a line to the kiaan-cloud activity feed (dashboard),
and exits with code 2. Run command 1.

launchd job: `~/Library/LaunchAgents/com.kiaan.brightspace-refresh.plist`
(`launchctl print gui/$(id -u)/com.kiaan.brightspace-refresh`). Log: `~/.brightspace/refresh.log`.
The log never contains cookie values.
