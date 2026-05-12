---
name: auto-link
description: Scan a newly written or edited note in the Second Brain and convert plain mentions of existing note titles, slugs, and aliases into [[wikilinks]]. Also enforces bidirectional linking — if A links to B, ensures B mentions A. TRIGGER PHRASES — "auto-link this note", "wikilink the references in X", "fold X into the graph". Run automatically by start-project, end-project, daily-rollup, and harvest-patterns. Run manually after any significant edit to a note.
version: 1.0
---

# auto-link

## Trigger phrases

- "auto-link this note"
- "wikilink the references in ___"
- "fold ___ into the graph"

Implicitly run by: `start-project/`, `end-project/`, `daily-rollup/`,
`harvest-patterns/`. Should run on every note-write.

## Purpose

Keep the graph dense automatically. Plain text "I used the
idempotent-webhooks pattern" becomes "I used [[pattern-idempotent-webhooks]]"
without the user thinking about it. Enforces that every link is
bidirectional.

## Workflow

### 1. Build the title/alias index

Walk the entire vault once. For each `*.md`:

```
title    = filename without .md
H1       = first `# ` line in body
aliases  = frontmatter `aliases: [...]` if present
slug     = filename
```

Build a dict: `{ phrase_lowercase: target_slug }`.

Add common stack tokens that match pattern slugs (e.g. "idempotent
webhooks" → `pattern-idempotent-webhooks`).

### 2. Scan the target note

Read the note. Skip:
- Code fences (between triple backticks)
- Existing `[[wikilinks]]` (already linked)
- URLs and markdown links `[text](url)`
- Frontmatter

For each remaining text span, find longest-match phrases from the index.

### 3. Replace

Replace plain phrases with `[[<slug>]]` or `[[<slug>|<original phrase>]]`
(the second form preserves the user's phrasing).

Limit to **first occurrence per slug per file** — don't link the same
phrase 12 times in one note.

### 4. Enforce bidirectional links

For every `[[<target>]]` that the target note now contains:

- Open `<target>.md`
- Check if it mentions this note's slug or H1 anywhere
- If not, find a "Related" / "Seen also in" / "Origin" section and append
  `- [[<this-note-slug>]]`
- If no such section exists, append a new `## Related` section

### 5. Skip rules

- Do not auto-link inside `40-archive/` notes (frozen history)
- Do not auto-link the daily template's placeholder `[[]]`
- Do not auto-link mentions of stop words or single common nouns

### 6. Report

```
Auto-linked <N> phrases in <path>:
  - "<phrase>" → [[<slug>]]
Backlinks added to:
  - [[<slug>]] (Related section)
```

## Failure modes

- **Phrase ambiguity** (matches multiple notes): prefer `70-patterns/`
  > `60-retros/` > `10-projects/` > others. If still tied, leave plain
  text and report the ambiguity for user decision.
- **Backlink target is read-only or in archive**: skip backlink, log it.
