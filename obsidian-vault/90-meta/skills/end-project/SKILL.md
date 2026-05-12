---
name: end-project
description: Wrap up a coding project — generate a retro from the project note + git history, extract reusable solutions into patterns, update status, archive. TRIGGER PHRASES — "wrap up project X", "close out X", "X is done", "retro for X", "archive project X", "end project X". Always run when a project ships, is paused, or is abandoned; never let a project just go quiet without a retro.
version: 1.0
---

# end-project

## Trigger phrases

- "wrap up project ___"
- "close out ___"
- "___ is done"
- "retro for ___"
- "archive project ___"
- "end project ___"

## Purpose

Convert a finished/paused/dead project into durable vault knowledge:
retro, patterns, status update, archive move. Triggers `harvest-patterns/`
to detect cross-retro themes.

## Workflow

### 1. Locate the project

Find the project note: `/home/user/Obsidian/SecondBrain/10-projects/<slug>/<slug>.md`.
If `<slug>` ambiguous, list all `status: active` projects and ask.

Read its frontmatter (created, stack, repo) and "Daily log" section.

### 2. Determine outcome

Ask the user (one question):

- **shipped** — released, deployed, merged
- **paused** — coming back later
- **abandoned** — won't finish, but lessons remain

### 3. Pull git history (if repo path is set)

```bash
cd "<repo_path>"
git log --since="<project.created>" --pretty=format:"%h %s" --no-merges
```

Top 10 commits by line-count change become candidates for "What I built".

### 4. Generate the retro

Copy `/home/user/Obsidian/SecondBrain/90-meta/templates/retro.md` to:

`/home/user/Obsidian/SecondBrain/60-retros/<TODAY>-<slug>.md`

Substitute placeholders. Pre-fill from the project note:

- **What I built** ← Goal + top commits
- **What worked / didn't** ← user input (prompt them; don't make these up)
- **Patterns extracted** ← see step 5
- **Links to code** ← repo + top commit hashes/links
- **Don't repeat** ← single most important lesson (ask the user; this is
  the most valuable line in the whole retro — never auto-generate)

### 5. Extract patterns

For each "decision" or "what worked" item, ask: "Is this reusable across
projects?" If yes:

```bash
cp "$VAULT/90-meta/templates/pattern.md" \
   "$VAULT/70-patterns/pattern-<short-name>.md"
```

Fill in `origin: <slug>`. Link from the retro's "Patterns extracted" section.

### 6. Run harvest-patterns/

Pass this new retro to `harvest-patterns/`. It scans existing retros for
recurring themes and either proposes additional new patterns or strengthens
existing ones with a "seen also in [[<slug>]]" backreference.

### 7. Update the project note

Edit `/home/user/Obsidian/SecondBrain/10-projects/<slug>/<slug>.md`:

- `updated: <TODAY>`
- `status: done` (or `paused` / `archived`)
- Append a "Retro" line: `[[<TODAY>-<slug>]]`

### 8. Archive (if done or abandoned)

```bash
mv "$VAULT/10-projects/<slug>" "$VAULT/40-archive/<slug>"
```

Leave `paused` projects in `10-projects/` so they remain visible.

### 9. Run auto-link/

Pass the new retro and any new patterns through `auto-link/` to fold them
into the graph.

### 10. Link from today's daily

Append to today's daily's "Done" section:
`- Wrapped [[<slug>]] — see [[<TODAY>-<slug>]]`

### 11. Report back

Summarize:
- Retro path
- Patterns extracted (with paths)
- Themes harvested across prior retros (from harvest-patterns)
- Where the project folder lives now
- Any orphaned cross-references that need cleanup
