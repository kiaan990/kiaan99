# Second Brain

Persistent, searchable, cross-referenced memory for coding work.

**Vault root:** `/home/user/Obsidian/SecondBrain`

## Map

| Folder | What goes here |
|---|---|
| `00-inbox/` | Quick capture. Triage weekly. |
| `10-projects/` | One folder per active coding project. |
| `20-areas/` | Ongoing areas of focus (no end date). |
| `30-resources/` | Reference material, snippets, captured links. |
| `40-archive/` | Completed or dormant projects. |
| `50-daily/` | Daily notes (`YYYY-MM-DD.md`). |
| `60-retros/` | Project retrospectives — the "what worked / what didn't" log. |
| `70-patterns/` | Reusable solution patterns extracted from real work. |
| `90-meta/` | Templates and Claude vault skills. |

## How to use this vault day-to-day

These phrases trigger the corresponding skills in `90-meta/skills/`:

| Say to Claude | What happens |
|---|---|
| "Start a new project for X" | Clones `_template`, creates `10-projects/<slug>/`, fills frontmatter, links from today's daily. |
| "Have I solved this before?" | Semantic-style search across retros and patterns. |
| "Wrap up project Y" | Generates a retro, extracts patterns, updates status, archives. |
| "Rollup my day" | Builds today's daily note from commits + edits + inbox. |
| "What's on my plate?" | Lists all `status: active` project notes. |

## Operating instructions for Claude

See [`CLAUDE.md`](./CLAUDE.md) — that's the contract every Claude session
follows when working in this vault.

## Adding the vault to a coding project

In any new repo, drop `90-meta/templates/project-CLAUDE.md` into the repo root
as `CLAUDE.md` (or append it to an existing one). That tells Claude to read
this vault before solving anything non-trivial, and to write a retro back
here when the project wraps.
