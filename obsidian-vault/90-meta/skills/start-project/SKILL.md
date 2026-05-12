---
name: start-project
description: Spin up a new project note in the Second Brain vault and link it into the graph. TRIGGER PHRASES — "start a new project for X", "kick off project X", "new project: X", "I'm starting work on X", "create a project note for X". Always run this when the user signals they're beginning a new piece of coding work; do NOT just edit code without anchoring it in a project note.
version: 1.0
---

# start-project

## Trigger phrases

- "start a new project for ___"
- "kick off project ___"
- "new project: ___"
- "I'm starting work on ___"
- "create a project note for ___"

## Purpose

Anchor every new piece of coding work in the vault before code is written.
Forces a name, a goal, a stack, and a connection to prior work.

## Workflow

### 1. Slugify the project name

`<slug> = lowercase(name).replace(/[^a-z0-9]+/g, '-').trim('-')`

Examples:
- "Auth Rewrite" → `auth-rewrite`
- "RAG over PDFs" → `rag-over-pdfs`

### 2. Run vault-search FIRST

Before creating anything, invoke `vault-search/` (or do its workflow inline)
with the project name as the query. Surface to the user:

- Any active or archived project with overlapping tags/stack
- Any pattern that might apply
- The most recent retro in the same domain, if any

Ask: "Should I link the new project to any of these?"

### 3. Gather metadata

Prompt the user (one question at a time, or in a single batch if you have
high confidence in defaults):

- **Goal** — one sentence; define done
- **Stack** — array (e.g. `[typescript, nextjs]`)
- **Repo path** — absolute path on disk

### 4. Clone the template

```bash
SLUG="<slug>"
VAULT="/home/user/Obsidian/SecondBrain"
mkdir -p "$VAULT/10-projects/$SLUG"
cp "$VAULT/90-meta/templates/project.md" "$VAULT/10-projects/$SLUG/$SLUG.md"
```

Then open the new file and substitute placeholders (`{{DATE}}`,
`{{PROJECT_NAME}}`, `{{STACK}}`, `{{REPO_PATH}}`, `{{SLUG}}`) with the
gathered metadata. Use today's date (ISO `YYYY-MM-DD`).

### 5. Link from today's daily

Open `/home/user/Obsidian/SecondBrain/50-daily/<TODAY>.md` (create from
`90-meta/templates/daily.md` if missing). Append to the "Notes" section:

```
- Started [[<slug>]]
```

And append `[[<slug>]]` to "Links touched".

### 6. Run auto-link/

Pass the new project note path to `auto-link/`. It will scan the body for
mentions of existing note titles (case-insensitive) and convert them into
`[[wikilinks]]`. Bidirectional: any pattern/retro the project links to
should mention the project in its "seen also in" or "Related" section.

### 7. Drop the project-CLAUDE.md bridge into the repo

If the user provided a `repo` path:

```bash
cp "$VAULT/90-meta/templates/project-CLAUDE.md" "<repo_path>/CLAUDE.md"
```

If `<repo_path>/CLAUDE.md` already exists, **ask** before overwriting.
Default to appending the bridge as a new section instead.

### 8. Report back

Tell the user:
- Path to the new project note
- What links/patterns were auto-suggested in step 2
- Whether the repo bridge was installed
- Any tags carried over from related work

## Failure modes

- Slug already exists in `10-projects/`: append `-2`, `-3` etc., or ask.
- No git repo at `<repo_path>`: skip step 7, warn the user.
- Today's daily doesn't exist: create it first from the template.
