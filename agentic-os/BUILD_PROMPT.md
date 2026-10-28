# Build me a personal Agentic OS (full stack, self-hosted on my server) — v3

You are Claude Code. Build me a complete, working personal "Agentic OS": a JARVIS-style system
**hosted on my own DigitalOcean server** (`kiaan-cloud`, Ubuntu 24.04), reachable **privately**
from my devices through **Tailscale**. It must also still run locally on my Mac as a fallback.
I'm not a developer, so:

- give me one simple step at a time;
- explain what each command does and what output to expect;
- show me the architecture and a visual preview (screenshots) before I run anything.

**Put this plainly in the README.** "Self-hosted" means the app and its data live on my own server,
and my vault syncs through my own private GitHub repo. Nothing is public. But the intelligence comes
from external model APIs (Anthropic via Claude Code, OpenAI for voice). When a skill runs, its
prompts and the file contents it reads are sent to those providers, and research skills also search
and fetch the web. That's expected.

---

## 0. Ground rules for how you work

- **Where you're running.** If you're running in a cloud sandbox rather than on my Mac, say so up
  front. Don't pretend you can search my Mac. Give me the exact commands to run locally instead.
- **Git.**
  - Don't commit or push unless I explicitly say **"commit and push"**.
  - When I do, commit only the `agentic-os/` folder, to the branch I name.
  - Never commit `.env`, data, logs or backups.
- **Checkpoints.** After each phase, tell me in plain words what you built and how to see it. Wait
  for my OK at the checkpoints marked ⏸.
- **Honesty.** Never claim something works if you didn't verify it. At the end, list exactly what
  was verified automatically, what was verified with real Claude, and what only I can verify on my
  Mac (mic, speakers, macOS install, my real network).

## 0b. Hosting: my own server, private via Tailscale (the default)

- **Check the server first.** Report its CPU, RAM, disk, and the services already running (my
  dashboard, MCP server, Caddy, hermes). Don't disturb them.
- **Memory.** Claude Code runs need roughly 300–500 MB each. If the server has less than about
  2 GB, tell me and recommend resizing before going further. Resizing costs money, so ask.
- **Network: private only.**
  - The app still binds **127.0.0.1 only**.
  - **Tailscale Serve** publishes it over HTTPS to my tailnet only:
    `tailscale serve --bg --https=8443 http://127.0.0.1:<port>`. Use port 8443 so it can't clash
    with Caddy on 443.
  - No public exposure, no Funnel, no firewall changes.
  - MagicDNS and HTTPS Certificates must be enabled in the Tailscale admin console.
- **Identity.**
  - Every request (page and API) must carry a `Tailscale-User-Login` header that matches
    `TAILSCALE_ALLOWED_USERS`.
  - If `PUBLIC_ORIGIN` is set but no users are listed, **refuse to start** (fail closed).
  - Allow `PUBLIC_ORIGIN`'s host and origin alongside 127.0.0.1.
  - Keep the local token, the CSP and the origin checks.
  - State the limit honestly: other programs on the server itself could reach 127.0.0.1.
- **Vault sync.**
  - My vault becomes a **private GitHub repo**. The Mac side uses GitHub Desktop plus the Obsidian
    Git plugin, with auto pull and commit every 5 minutes.
  - The server keeps a clone. It pulls before every job and every N minutes. After each successful
    job it commits **only `raw/`, `wiki/`, `outputs/`** and pushes, retrying once after
    pull-rebase.
  - Git runs with prompts disabled. Sync errors show as a "Vault sync: error" pill, never silently.
- **Claude Code on the server.**
  - Install with the native installer for a dedicated user.
  - Log in with `claude setup-token` and store the token as `CLAUDE_CODE_OAUTH_TOKEN` in `.env`.
    It's my subscription, not an API key.
  - Pass the token to child runs and status checks, and redact it everywhere.
- **Process and OS isolation.** Run as a dedicated unprivileged user `agentic` under a hardened
  systemd unit:
  - `ProtectSystem=strict`, read-only code;
  - `ReadWritePaths` only for data/, logs/ and the agentic home folder;
  - `NoNewPrivileges`, `PrivateTmp`, the kernel/cgroup protections, `MemoryMax`;
  - `Restart=on-failure`;
  - starts on boot.
- **Node.** A pinned Node.js downloaded from nodejs.org **with SHA-256 verification** into its own
  folder (`/opt/agentic-node`), so it never touches any other Node on the box.
- **GitHub access.** Two separate SSH deploy keys, generated on the server:
  - a **read-only** key for the code repo;
  - a **write** key for the vault repo only.

  Use SSH host aliases, and pin GitHub's published ed25519 host key (no trust-on-first-use).
- **`deploy/setup-server.sh`** is root, interactive, idempotent and step-numbered with ✓/!/✗. For
  each step it says exactly what to click on GitHub, Tailscale and DigitalOcean, and waits while I
  do it. Steps:
  1. checks
  2. packages + Node
  3. user
  4. deploy keys (wait until they work)
  5. code
  6. vault clone + missing folders (`.gitkeep`) + `CLAUDE.md` append with consent + push
  7. install + build
  8. Claude Code + `setup-token`
  9. `.env`: token, vault, port (avoid ports in use), optional OpenAI key (hidden input),
     allowed Tailscale user
  10. Tailscale install/up/serve
  11. systemd + skills + verify. Direct access without Tailscale must return 403.

  Also provide `deploy/update.sh` (pull, build, restart).
- **How I get the script onto the server:** download it from GitHub, `scp` it to the server, then
  `ssh -t` to run it.

## 1. Phase 0: discover before you build ⏸

1. **Existing project.** Look for an existing version: folders named like `agentic-os*` in
   `~/Downloads`, `~/Documents`, `~/dev` and my home folder.
   - If you find one: audit it (implemented / broken / reusable), recommend build-on vs
     start-fresh, and **wait for my answer**.
   - If you find nothing, say so.
   - If there's a related existing app (e.g. a Next.js "Command Center"), don't modify it. Build
     `agentic-os/` alongside it.
2. **My vault.** Find my Obsidian vault "second brain" and ask me to confirm the path. Also check
   iCloud: `~/Library/Mobile Documents/iCloud~md~obsidian/Documents`.
   - **Never delete, move or overwrite anything in the vault.**
   - If the vault already has a root `CLAUDE.md`, never overwrite it. Only append a clearly marked
     section, after asking me, and keep a backup copy in `agentic-os/backups/`.
3. **Present the plan:**
   - architecture diagram (text)
   - file tree
   - visual direction (sections 3–4 below)
   - cost/safety model
   - pinned dependency list

   Wait for my OK.

## 2. Architecture (build exactly this)

### Stack

- **Frontend.** Vite + React + Tailwind, served by the backend after `npm run build`.
  - 3D orb: **three.js**, lazy-loaded so the page paints instantly.
  - Display font: **Oswald**, bundled locally via `@fontsource-variable/oswald`. No external
    font/CDN requests.
- **Backend.** Node.js + Express, **bound to 127.0.0.1 only** (never 0.0.0.0, not configurable).
  One port (default 4777), printed at startup with a plain-English "Open / Stop" message.
- **Persistence.** SQLite via `better-sqlite3`, holding:
  - `jobs` (status, limits, turns, session id, output path)
  - `job_events` (every progress event, so streams replay after reloads)
  - `automation_runs` (unique per automation + scheduled minute)
  - `settings`
  - `usage`

  Jobs and logs survive restarts. The vault stays plain markdown and is never imported into the DB.
- **Pinned versions.**
  - Use exact versions (no `^`) and commit lockfiles.
  - Prefer current mainstream releases. Run `npm audit` and resolve advisories (e.g. a patched
    `zod` 4.x, Vite 7, Tailwind 4) before calling it done.
  - Node engines: 20.19+, 22.12+ or 23–26.

### Browser-origin protection (state its purpose honestly)

- At install, generate a random 32-byte token into `.env`. The backend injects it into the
  dashboard page it serves, and every API call must send it as `X-Local-Token`, compared in
  constant time.
- Also enforce:
  - the `Host` header must be `127.0.0.1:<port>` or `localhost:<port>` (blocks DNS rebinding);
  - any `Origin` must be the app's own origin, and `Sec-Fetch-Site: cross-site` is rejected;
  - CSP `default-src 'self'` (plus the OpenAI API for voice), `frame-ancestors 'none'`,
    `X-Frame-Options: DENY`, `nosniff`, `no-referrer`.
- **README wording:** this stops other *websites* I visit from calling the local API through my
  browser. It does **not** protect against other *programs* already running as me on my Mac. Don't
  claim that anywhere.

### Job API (the backbone)

- `POST /api/jobs {skillId, input}`:
  1. Validate `skillId` against the registry.
  2. Validate `input` with the skill's strict schema (unknown keys rejected).
  3. Create the job, queue it (one runs at a time) and return its id.
- `GET /api/jobs`, `GET /api/jobs/:id`: list, status, result. Cost is always reported as
  `{usd: null, label: "Unknown — runs on your Claude subscription"}`.
- `GET /api/jobs/:id/events`: **Server-Sent Events**.
  - Replay stored events first (supports `Last-Event-ID` / `?after=`), then stream live events and
    send a heartbeat.
  - The browser reads it with `fetch` (not `EventSource`) so it can send the token header, and
    reconnects automatically.
- `GET /api/events`: a dashboard-wide stream so panels refresh live.
- `POST /api/jobs/:id/continue`: only for jobs paused at a limit.
- `POST /api/jobs/:id/cancel`.
- On restart: running jobs become `interrupted`, queued jobs resume. On shutdown, running jobs are
  marked `interrupted`, not `cancelled`.

### Filesystem access control: two distinct layers (build both, don't confuse them)

- **Application-level (the app's own reads and writes):**
  - Resolve every path to its canonical real path, including the deepest existing ancestor for
    files that don't exist yet.
  - The path must stay inside an allowed root: the project folder, or the vault's `raw/`, `wiki/`
    or `outputs/`.
  - Reject symlinks that resolve outside, and dangling symlinks.
  - Writes are **create-only** (`wx` flag), with a re-check after creating folders.
  - Denied operations **fail closed**: the request returns 403 `PATH_DENIED` and nothing is read or
    written.
  - The file viewer API only serves `.md`/`.txt` from those three vault folders. The vault-root
    `CLAUDE.md` is not served.
- **Subprocess-level (headless `claude -p`):** stay inside Claude Code's own permission system.
  - `--tools <exact list>`: only the built-in tools the skill needs. No Bash, no code execution.
  - `--allowedTools`:
    - `Read(//<real path>/**)` for raw/, wiki/ and outputs/;
    - `Write(...)` and `Edit(...)` scoped to **this run's single new output file** (or one
      brand-new folder for multi-note skills);
    - `WebSearch` and `WebFetch` only for web skills.
  - `--permission-mode dontAsk`: anything not pre-approved is denied, never auto-approved.
    Never `--dangerously-skip-permissions`.
  - `--strict-mcp-config`: my personal MCP servers aren't loaded into runs.
  - Working folder `vault/outputs`, plus `--add-dir` for raw/ and wiki/. **Say plainly this is a
    convenience, not a security boundary.**
  - Strip `LOCAL_TOKEN`, `OPENAI_API_KEY`, `MCP_AUTH_TOKEN` and `ANTHROPIC_API_KEY` from the child
    environment, so runs use my Claude login rather than metered API billing. An opt-in env flag
    can allow the API key.
  - Pass the skill's `SKILL.md` and `template.md` via `--append-system-prompt`, because Claude
    can't read the project folder.
  - Parse `--output-format stream-json --verbose`. Turn tool uses, text, turns and permission
    denials into job events, with paths shown vault-relative.
  - Emit a **Permissions** event at the start of every run, showing the exact tools and
    pre-approved write. Tell me once how to review this.
  - Success = Claude reports success **and** the expected output file exists. Otherwise the job
    fails with a clear reason.

### Skill execution (safety-critical)

- Jobs can only come from an **allowlisted skill registry** (`server/jobs/registry.js`). Each entry
  has: id, name, description, UI fields, a strict zod input schema, a tools list, a web flag,
  limits, a `plan()` that picks a new unique output path and saves any raw input first, and a
  `prompt()`.
- User text goes into prompts as delimited data.
- There is **no endpoint that runs arbitrary commands or arbitrary prompts**.

## 3. The four layers (also the dashboard's visual structure)

### Layer 2: Memory (the Obsidian vault)

- Ensure `raw/` (with `raw/transcripts/`), `wiki/` (with `wiki/lectures/`) and `outputs/` (with
  `briefs/`, `research/`, `reviews/`) exist. Create only what's missing.
- Filing rules go in the vault-root `CLAUDE.md`, appended between markers
  `<!-- agentic-os:filing-rules v1 -->` … `<!-- /agentic-os:filing-rules -->`. They cover:
  - where raw material goes;
  - when raw is promoted to wiki (suggested only, never moved automatically);
  - where outputs go;
  - date-prefixed lowercase-kebab naming;
  - "agents only add files".
- If `CLAUDE.md` already has the markers, leave it unchanged. Verify the original bytes are intact
  after appending (`cmp`); restore from backup if not.

### Layer 3: Skills + Automations

- `skills/` in the standard **Agent Skills** format: one folder per skill, each with `SKILL.md`
  (YAML frontmatter `name` + `description`, then workflow and rules) and a `template.md`. Symlink
  them into `~/.claude/skills/`, but never replace an existing entry that isn't ours.
- Four starter skills:

  | Skill | Turns | Writes |
  |---|---|---|
  | **research-brief** | topic → sourced brief, numbered citations | `outputs/research/` |
  | **lecture-notes** | pasted transcript → saved to `raw/transcripts/` first, then structured notes | a brand-new `wiki/lectures/<date-slug>/` folder |
  | **daily-plan** | tasks + recent vault files + optional read-only server calendar/tasks → morning brief | `outputs/briefs/` |
  | **weekly-review** | the week's changed files → review that *lists* suggested raw→wiki promotions | `outputs/reviews/` |

- `skills/README.md` explains:
  - how I add a skill two ways: (a) paste a past conversation and ask Claude to propose one,
    (b) describe a recurring task in plain words;
  - the one extra step to give a new skill a dashboard button (a registry entry);
  - how to review its permissions.
- **Automations.** node-cron inside the backend, driven by `automations.config.json`, reloaded
  automatically on save.
  - Validate the file. If it's invalid, keep the last good version and show the error in the
    dashboard.
  - Ship one automation: **morning brief at 8:00**, skill `daily-plan`, output a dated note in
    `outputs/briefs/`.
- **Sleep semantics.** A sleeping Mac (or a stopped app) can't fire jobs.
  - Check for missed runs **on every start and every 5 minutes**, which catches wake-from-sleep.
    Use cron-parser to find the last scheduled time, with a 3-minute grace period.
  - Per-job `runOnCatchUp`:
    - `"ask"` (default) shows a banner: *"Morning brief didn't run at 8:00 (your Mac was asleep or
      the app was off). Run it now?"* with Run now / Skip;
    - `true` runs it;
    - `false` records it as skipped.
  - Only count misses within `catchUpWindowHours` and after the app was first installed. Never
    double-run the same scheduled minute.
  - Explain all this in the README.
- Automation history (scheduled / catch-up / manual; succeeded / failed / paused / missed /
  skipped; output link) comes from SQLite.

### Layer 1: Execution engine (Claude Code)

- Headless `claude -p`, using my **existing Claude Code login**. **Don't assume I have an Anthropic
  API key.**
- The dashboard shows Claude Code's version and login status (`claude auth status --json`), what's
  running now, and the limits.

### Layer 4: Access (dashboard + voice)

#### Visual structure

Copy the structure of my infographic "Claude Code Powered Agentic OS — 4 layers":

- **Header.**
  - Greeting and date, plus status pills: Claude ready / not logged in / not found; Voice on / not
    configured; Quick chat model / not configured; Server off / connected / not connected.
  - Centered title: an orange ✳ asterisk + **CLAUDE CODE** in white condensed caps.
  - Below it, **POWERED AGENTIC OS** very large in Oswald with a blue→violet gradient and a soft
    glow.
  - Tagline: *"4 layers. One system that thinks, remembers & executes."*
- **Four stacked layer bands, top to bottom: 4 → 3 → 2 → 1**, joined by small glowing chevron
  connectors.
  - Each band is a rounded panel with a colored 1.5px border, outer glow and tinted gradient.
  - Colors: **purple** = Access, **green** = Automation, **blue** = Memory, **orange** = Execution.
  - Left rail: a big outlined number box and the layer name in condensed caps ("ACCESS LAYER",
    "AUTOMATION LAYER", "MEMORY LAYER", "EXECUTION ENGINE").
  - Body: a condensed-caps title plus a one-line description, and on the right a 2-column icon
    list of **live** facts in the layer's color.
  - Below that, the layer's working panels as lighter inner cards (no nested blur).

| Layer | Title | Live facts | Panels inside |
|---|---|---|---|
| ④ Access (purple) | Dashboard / Command Center | Web dashboard · 127.0.0.1:port; Voice; Chat; Access · this Mac only | **Voice** (3D orb), **Chat**, **Today's brief** |
| ③ Automation (green) | Skills + Automations | Skill packs; Workflows; Automations (next run); Missed runs | **Skills** tiles, **Live run** (SSE timeline, progress bar, Continue/Stop when paused, Open output), **Automations** (human-readable schedule like "Daily 8:00", next run, history) |
| ② Memory (blue) | Memory Layer (Obsidian Vault) — "A simple Markdown vault. Not an overbuilt RAG system." | Obsidian vault; Markdown files; Decisions & context (wiki notes); Long-term memory | **Vault** stats + recent files; **How memory flows** raw/ → wiki/ → outputs/ with counts, ending in a dashed strip **"✓ SIMPLE. LOCAL. PORTABLE. POWERFUL."** |
| ① Execution (orange) | Claude Code (Engine) | Reasoning; Task execution (runs today); Multi-step workflows (turns today); Scoped permissions | **Engine card** (orange "CC" tile, version, login, running now, limits, permission summary), **Job history**, **Usage** |

- **Footer strip.** Target icon + *"Built for you — runs on this Mac / One system. Your files. Your
  rules."* with three cells: **Local · Extensible · Private**. One small line underneath saying
  what gets sent to Anthropic/OpenAI.
- **Deliberate differences from the infographic** (tell me about them): no "Client / Team Access"
  (it's local-only), no "Code Generation" (skills can't run code), no "Monetizable"/"Scalable"
  claims.
- **Style.** Apple-quality glass on a dark background:
  - slow aurora behind everything (CSS transform-only animation, respects
    `prefers-reduced-motion`);
  - SF-style system font for body text;
  - generous spacing, 60fps motion;
  - responsive with no horizontal scroll at phone width.

#### The voice orb: a realistic, interactive 3D object (not a flat ball)

- three.js WebGL scene with a transparent background, made of:
  - **Core sphere.** A high-detail icosahedron with a custom shader. Its surface flows with 3D
    simplex noise:
    - calm and almost smooth when idle;
    - amplitude grows with the live audio level;
    - fine detail only appears with sound;
    - normals recomputed from the displaced surface so lighting follows the waves.
  - **Lighting and color.**
    - Luminous swirling plasma interior from the state palette, with bright veins.
    - Key + fill lights, a fresnel rim glow, and a faint iridescence.
    - Deeper color toward the bottom.
  - **Glass shell.** A slightly larger transparent sphere with a soft specular highlight, a studio
    light-streak reflection and a tinted rim. The shell doesn't rotate with the core, like real
    glass.
  - **Halo.** About 900 additive particles orbiting the ball (expanding with sound), plus an
    additive glow plane behind it.
- **States** (colors cross-fade smoothly):
  - **idle**: blue, slow breathing;
  - **connecting**: brighter blue;
  - **listening**: green, reacting to mic level;
  - **speaking**: violet, reacting to output audio;
  - **error**: red.
- **Interactive:**
  - tilts toward the cursor;
  - bulges under the pointer (ray-sphere hit → shader uniform);
  - drag to spin with inertia;
  - click/tap sends a ripple wave across the surface and starts/stops voice;
  - pointer cursor on hover.

  If voice isn't configured, clicking ripples and shows "Voice needs an OpenAI key".
- **Accessibility.** A labeled real button ("Start talking" / "End voice") as well, and a live
  status label.
- **Fallback.** If WebGL isn't available, show a 2D canvas orb with the same three states.
  `prefers-reduced-motion` slows everything down.
- Pixel ratio capped at 2. Dispose of all GPU resources on unmount.

#### Other Access-layer requirements

- **Chat** is a text alternative to voice. It shows which tier answered and an estimate when a
  model was used. Tier-3 proposals show a **Run** button; nothing runs until I press it.
- **Voice** is speech-to-speech via the **OpenAI Realtime API over WebRTC**:
  - The backend mints a short-lived client secret (`/v1/realtime/client_secrets`, model
    configurable, default `gpt-realtime`). `OPENAI_API_KEY` lives only in `.env` server-side and
    never reaches browser code, logs or responses.
  - The voice session has one function tool, `ask_os`, which calls the same router as chat.
  - Voice answers stay to 1–2 sentences. Long results are posted to chat as text.
  - A live timer runs during the session. It ends after N seconds of quiet and after a maximum
    length (both in `.env`).
  - Token usage from `response.done` is reported to the backend for estimates.
- **Markdown** is rendered without raw HTML (react-markdown defaults). Links open in a new tab.
- **File viewer**: a modal `<dialog closedby="any">` with a click-outside fallback for Safari, plus
  an "Open in Obsidian" `obsidian://open?path=` link.
- **No fake data.** Empty states say "Nothing yet". Never seed demo briefs, runs or stats.

## 4. Routing, models and cost controls

- **Router** in one editable module (`server/router.js`). Tier-3 patterns are checked first, then
  Tier 1, then Tier 2.
  - **Tier 1, local/deterministic:** last brief, job status, list skills, usage, vault stats. No
    model call.
  - **Tier 2, quick chat:** a cheap model through a **configurable provider** (default OpenAI
    `gpt-4o-mini`, max ~300 tokens, 3 sentences). If no provider or key is set, it's disabled with
    a visible "not configured" state and a helpful fallback message.
  - **Tier 3, real work:** "research X", "plan my day", "weekly review" → **propose** an
    allowlisted skill job with validated input; nothing runs until confirmed.
- **Keys.** OpenAI is only for voice and Tier 2. Without it, the app fully works with those
  features visibly disabled.
- **Cost guardrails.** Be precise about what can and can't be known.
  - **OpenAI** (metered): record token counts per request. Show dollar **estimates labeled
    "estimate"**, priced from an editable `pricing.config.json`. Mark unpriced models.
  - **Claude Code** runs use my subscription and have **no dollar meter**: show runs, turns and
    minutes, and label cost "unknown". Never invent dollar amounts.
  - **Per-run limits**: max turns and max minutes per skill, capped by `.env`.
    - Enforce them in the app, by counting assistant turns and running a timer that stops the
      process. Pass `--max-turns` as a backstop.
    - On hitting a limit, the job becomes `paused_limit`, the dashboard asks
      **"Continue (+10 turns, 10 min) / Stop"**, and Continue resumes the same session with
      `--resume`.
  - Never claim an exact spend cap is guaranteed.

## 5. Hard constraints

- Self-hosted on my own server only, private via Tailscale. No public tunnels/Funnel, no third-party
  hosting, no opened firewall ports, and no changes to my other services on the server.
- The optional MCP connector is **read-only**, enforced in code:
  - an allowlist of read tools;
  - any tool name containing add/create/delete/update/complete/save/set/write/send/… is refused,
    even if listed.
- Secrets live in `.env` (mode 600). `.env`, `data/`, `logs/`, `backups/`, DB files, builds and
  `node_modules` are gitignored.
- Keys are never printed, logged (redacted logger) or sent to the browser. Installer prompts for
  keys use hidden input and pass values via stdin, never as command arguments.
- Vault writes are additive-only and scoped as above.
- No new paid accounts. If a feature would need one, skip it and tell me.
- Mainstream, pinned dependencies. Don't promise it "just works".

### Optional integration (off by default)

If `MCP_SERVER_URL` (and optional `MCP_AUTH_TOKEN`) is set:
- connect via the MCP SDK's streamable HTTP client, read-only, with timeouts;
- feed calendar/tasks into the morning brief;
- show "connected" / "not connected".

If it's unset or unreachable, everything works and the UI says so.

## 6. install.sh (macOS, bash 3.2-compatible, safe to re-run)

The installer runs these 8 steps, with ✓ / ! / ✗ output and the exact fix for anything that fails:

1. **Prerequisites.**
   - Node version (fix: nodejs.org LTS installer).
   - Xcode command line tools / git (fix: `xcode-select --install`).
   - Claude Code installed (fix: `curl -fsSL https://claude.ai/install.sh | bash`).
   - Logged in (`claude auth status --json`; fix: run `claude`, log in, `/exit`).
   - Warn that `ANTHROPIC_API_KEY` will be ignored.
2. **Find the vault.** Search for "second brain" (skip `~/Library`, but check the iCloud Obsidian
   folder), list numbered choices marked "(Obsidian vault)", accept a number or a dragged-in path,
   and confirm.
3. **Vault folders.** Create only the missing ones.
4. **Filing rules.** Preview them, ask, back up, append, verify the original bytes are intact.
5. **Packages and build.** `npm ci` for server and web, then build, quietly.
6. **`.env`.** Create it from `.env.example` (mode 600), generate the token, save the vault path,
   and prompt with hidden input for an optional OpenAI key.
7. **Skills.** Link them into `~/.claude/skills`.
8. **Verify and finish.** Run `npm run verify`: `.env`, vault folders, Claude login, OpenAI key
   (`/v1/models`), MCP. Then print **one** start command and the URL.

## 7. Deliverables

- the complete `agentic-os/` project;
- `install.sh`;
- `scripts/verify.js`, `scripts/set-env.js` (stdin) and `scripts/get-env.js` (refuses to print
  secrets);
- `.env.example`;
- `automations.config.json` and `pricing.config.json`;
- `vault-template/CLAUDE.md.additions`;
- `.gitignore`;
- `docs/` screenshots (the full dashboard and the orb's three states);
- a non-developer `README.md` covering:
  - the plain-language local-hosting note;
  - what you need;
  - install, step by step;
  - start/stop;
  - **what you'll see on first load, layer by layer**;
  - everyday use;
  - adding a skill and an automation (cron cheat-sheet);
  - sleep / missed runs;
  - the cost and security models;
  - the optional server connector;
  - where things live, and how to push it to my own private repo;
  - troubleshooting;
  - self-checks.

## 8. Acceptance tests (all must pass before you call it done)

Ship an automated suite (`npm test`, node:test) that uses a **temporary fake vault and a stand-in
`claude` script** that emits stream-json, plus a **mock OpenAI server**, so it never touches my vault
or uses credit. Also run **one real research-brief job with real Claude Code** and show me the
result.

1. A fresh `install.sh` completes and prints one start command. The app loads on
   `http://127.0.0.1:<port>` with the four-layer layout, the 3D orb and empty states. The page
   carries its token and security headers.
2. Click **research-brief** with a test topic:
   - the job appears and progress streams live;
   - the run used the locked-down flags (`dontAsk`, `--strict-mcp-config`, exact `--tools`, writes
     scoped to one file);
   - the file lands in `outputs/research/` and the run is recorded in history.
3. `POST /api/jobs` with an unknown skill ID, extra input keys or invalid input is rejected. No
   `/api/run|exec|command|shell|prompt` endpoint exists.
4. Calls without the token, from another origin, cross-site, or with a foreign Host header are
   rejected. The port only listens on 127.0.0.1 and isn't reachable on the LAN address.
   **Cloud mode:**
   - the app refuses to start without `TAILSCALE_ALLOWED_USERS`;
   - requests without the right Tailscale identity get 403, pages included;
   - requests via the tailnet Host/Origin with the right identity work.

   Also test **vault Git sync** against a local bare repo: only `raw/`, `wiki/`, `outputs/` are
   committed and pushed, and unrelated local edits are left alone.
5. File requests via `../`, absolute paths, non-allowed vault folders, the vault `CLAUDE.md`,
   symlinked files or folders pointing outside, or dangling symlinks fail closed (403
   `PATH_DENIED`). Create-only writes refuse to overwrite.
6. Kill and restart the app: job history and event logs persist. A missed 8:00 brief is detected on
   start, offered via Run now / Skip, runs as `catch-up` and can't be double-run.
7. Vault diff after running all skills: only new files, only inside `raw/`, `wiki/`, `outputs/`
   (plus the agreed `CLAUDE.md` append). A pre-existing `CLAUDE.md` and notes are byte-identical.
8. **Without `OPENAI_API_KEY`:** the app fully works; voice and Tier 2 are visibly disabled;
   Tier 1 and Tier 3 still work.

   **With it:**
   - a voice client secret is minted server-side;
   - the real key appears nowhere in responses, the page or logs;
   - the orb listens and speaks.
9. The usage view updates after runs: OpenAI as estimates, Claude runs as unknown dollars. A job
   that hits its configured limit pauses and asks; Continue resumes it to completion.
10. **Visual check** with headless-browser screenshots:
    - the four colored layers in order 4→1 with connectors, the gradient title and the footer
      strip;
    - the 3D orb rendering in idle / listening / speaking, and reacting to hover;
    - no console errors;
    - no horizontal scroll at 390px width.
