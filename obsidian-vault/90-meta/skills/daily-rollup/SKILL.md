---
name: daily-rollup
description: Generate or update today's daily note in the Second Brain by scanning recent commits, edited files, and inbox notes. Also runs a quick graph-health pass to surface stale projects and orphan notes. TRIGGER PHRASES — "rollup my day", "daily rollup", "what did I do today", "wrap my day", "end of day rollup". Run at end-of-day or when the user wants a summary; safe to run multiple times per day (idempotent merge).
version: 1.0
---

# daily-rollup

## Trigger phrases

- "rollup my day"
- "daily rollup"
- "what did I do today"
- "wrap my day"
- "end of day rollup"

## Purpose

Capture the day's coding activity in `50-daily/<TODAY>.md` automatically.
Idempotent — re-running merges new info without duplicating bullets.

## Workflow

### 1. Compute today

`<TODAY>` = system local date in `YYYY-MM-DD`.

### 2. Open or create today's daily

```bash
DAILY="/home/user/Obsidian/SecondBrain/50-daily/<TODAY>.md"
if [ ! -f "$DAILY" ]; then
  cp "/home/user/Obsidian/SecondBrain/90-meta/templates/daily.md" "$DAILY"
  # substitute {{DATE}} with <TODAY>
fi
```

### 3. Gather signal

**A. Git activity across all known project repos:**

For each `status: active` project note in `10-projects/`, read its `repo`
frontmatter. Then:

```bash
cd "<repo>"
git log --since="<TODAY> 00:00" --until="<TODAY> 23:59" \
  --pretty=format:"%h %s" --no-merges
```

**B. Vault edits:**

```bash
find /home/user/Obsidian/SecondBrain -name '*.md' -newermt "<TODAY> 00:00" \
  -not -path '*/.obsidian/*' -not -path '*/.git/*'
```

**C. Inbox additions:**

```bash
find /home/user/Obsidian/SecondBrain/00-inbox -name '*.md' \
  -newermt "<TODAY> 00:00"
```

### 4. Merge into today's daily

Read the existing daily. For each section, append new bullets that aren't
already present (string match on the bullet body):

- **Done** ← commit subjects, prefixed with project link: `[[<slug>]] — <subject>`
- **Notes** ← inbox additions (link them: `Captured [[<inbox-slug>]]`)
- **Links touched** ← every project/pattern/retro file edited today

**Do not delete user-written content.** Always append-only merge.

### 5. Run graph-health/ (light pass)

Invoke `graph-health/` in "daily" mode. It returns:

- Active projects with no `updated` bump in ≥7 days → list under "Stale"
- Orphan notes from the last 7 days → list under "Orphans needing links"

Append these as a new section "## Health check" in today's daily (replace
the section if it already exists today).

### 6. Run auto-link/ on the daily

Auto-link any plain mentions of project/pattern names into wikilinks.

### 7. Report

```
Daily rolled up: /home/user/Obsidian/SecondBrain/50-daily/<TODAY>.md
- N commits across M projects
- K vault notes edited
- J new inbox notes
- Stale projects: ...
- Orphans: ...
```

## Idempotency rule

Re-running this skill must not duplicate bullets. Merge by content match.
The user can edit the daily freely between runs and the skill respects
their edits.
