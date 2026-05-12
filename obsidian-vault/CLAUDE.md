# CLAUDE.md — Operating Instructions for the Second Brain Vault

## Purpose

This vault is the user's persistent, searchable, cross-referenced memory for
coding work. Every project the user does should leave a trace here: a project
note while it's active, a retro when it ends, and any reusable solutions
extracted into patterns. Future Claude Code sessions read this vault first so
the user never re-solves the same problem twice.

**Vault root:** `/home/user/Obsidian/SecondBrain`

## Folder taxonomy

```
00-inbox/      Quick capture, unsorted notes. Triage weekly into other folders.
10-projects/   One folder per active coding project. Slug-named.
20-areas/      Ongoing areas of focus that aren't bounded projects.
30-resources/  Reference material, snippets, captured external links.
40-archive/    Completed or dormant projects moved out of 10-projects.
50-daily/      Daily notes, one per day, dated YYYY-MM-DD.md.
60-retros/     End-of-project retrospectives. Source of truth for "what worked".
70-patterns/   Reusable solution patterns extracted from real work.
90-meta/       Vault config: templates/ and skills/.
```

## Naming conventions

- Project notes: `kebab-case-slug.md` (e.g. `auth-rewrite.md`)
- Daily notes: `YYYY-MM-DD.md` (e.g. `2026-05-11.md`)
- Retros: `YYYY-MM-DD-project-slug.md` (e.g. `2026-05-11-auth-rewrite.md`)
- Patterns: `pattern-<short-name>.md` (e.g. `pattern-idempotent-webhooks.md`)
- Resources: `<source>-<short-topic>.md` (e.g. `mdn-cors-preflight.md`)

## Frontmatter spec

Every note **must** open with YAML frontmatter. Minimum fields:

```yaml
---
created: 2026-05-11
updated: 2026-05-11
tags: [tag1, tag2]
type: project   # one of: project | daily | retro | pattern | resource | area | inbox
---
```

Project notes additionally require:

```yaml
status: active   # one of: active | paused | done | archived
stack: [typescript, nextjs]
```

Retro notes additionally require:

```yaml
project: auth-rewrite
outcome: shipped   # shipped | abandoned | paused
```

Pattern notes additionally require:

```yaml
problem_domain: [auth, webhooks]
origin: auth-rewrite
```

## Linking conventions

- Use `[[wikilinks]]` for cross-references between notes. Example:
  `See [[pattern-idempotent-webhooks]] for the dedupe approach.`
- Tag heavily — every note gets at least 2 tags. Prefer reusing existing tags
  over inventing new ones; check `30-resources/` and `70-patterns/` for
  established tag vocabulary first.
- Project notes link out to their retro when written; retros link back to the
  project note and to any patterns they extracted.

## Before you start a coding task — checklist

Run this **at the top of every session** before writing code:

1. **Search the vault for related work.** Grep `10-projects/`, `40-archive/`,
   `60-retros/` for the problem domain, stack keywords, and any obvious tags.
2. **Check `70-patterns/`** for a pattern that already solves this. If one
   exists, link to it from the new project note instead of re-deriving.
3. **Read the most recent retro** if this work continues a prior project. The
   retro contains the "don't repeat" lessons.
4. **Open or create the project note** in `10-projects/<slug>/` from the
   `_template/` before starting. Set `status: active`.
5. **Add a line to today's daily note** linking the project you're working on.

## When you finish — checklist

When a project ships, is paused, or is abandoned:

1. **Write a retro** to `60-retros/YYYY-MM-DD-<project-slug>.md` using
   `90-meta/templates/retro.md`. Be honest about what didn't work.
2. **Extract reusable solutions** into `70-patterns/pattern-<name>.md`.
   Anything you'd Google for again is a pattern candidate.
3. **Update the project note's frontmatter:** set `status` to `done`,
   `paused`, or `archived`, and bump `updated`.
4. **Move the project folder** to `40-archive/` if `status` is `done` or
   `archived` (leave `paused` projects in `10-projects/`).
5. **Cross-link**: project note ↔ retro ↔ patterns ↔ today's daily.

## Vault skills

Vault-specific skills live in `90-meta/skills/`. Each is a folder with a
`SKILL.md` describing trigger phrases and the workflow. Current skills:

**Workflow skills (user-triggered):**

- `start-project/` — when the user says "start a new project for X"
- `vault-search/` — search the vault for prior work on a topic
- `end-project/` — wrap up a project: retro + patterns + status update
- `daily-rollup/` — generate or update today's daily note from activity
- `connect-dots/` — "have I solved this before?" — clusters across retros + patterns

**Self-learning skills (run automatically by other skills, or on demand):**

- `auto-link/` — after writing a note, scan the vault for existing titles,
  aliases, and tags and convert plain mentions into `[[wikilinks]]`.
- `harvest-patterns/` — scan recent retros for recurring themes; propose new
  `pattern-*.md` files when a theme appears in ≥3 retros.
- `graph-health/` — surface orphan notes (no incoming links), weak clusters,
  and outdated `status: active` projects (>30 days since `updated`).

Read the relevant `SKILL.md` before executing — they encode the exact workflow.

## Self-learning loop (the vault improves itself)

The vault is not a passive filing cabinet. After every meaningful operation,
Claude is expected to extend the graph:

1. **Every new note** runs through `auto-link/` before being saved. Plain text
   mentions of an existing note title or alias become `[[wikilinks]]`.
2. **Every retro** (`end-project/`) triggers `harvest-patterns/` to check
   whether the lessons in this retro echo lessons in prior retros — if so,
   propose a new pattern, or strengthen an existing one by adding this retro
   to its "Origin / seen also in" section.
3. **Every daily rollup** (`daily-rollup/`) runs a quick `graph-health/` pass:
   any active project that hasn't been updated in 7 days gets surfaced;
   orphan notes from the last week get flagged for triage.
4. **Every `connect-dots/`** call doesn't just keyword-match — it clusters
   notes by shared tags + co-occurring wikilinks + textual similarity, and
   reports the cluster, not just hits. If a cluster is dense but has no
   pattern file, it proposes one.
5. **Bidirectional links are mandatory.** If A links to B, B should mention A
   somewhere. `auto-link/` enforces this on save.

The vault's value compounds: every retro feeds patterns, every pattern is
auto-linked into future projects, every daily rollup surfaces stale work.
Claude should never finish a vault operation without asking: "did the graph
get richer because of this turn?"

## Active infrastructure (scripts + hook)

The self-learning loop runs on three Python/shell tools in `90-meta/`:

- `scripts/build-index.py` — walks the vault, parses frontmatter and
  wikilinks, writes `90-meta/graph/index.json` with notes, tags, outlinks,
  inlinks, orphans, and stale active projects. Idempotent. Source of
  truth for the graph; all skills consume this index.
- `scripts/propose-links.py <note> [--apply]` — reads the index, finds
  plain-text mentions of existing note titles in `<note>`, proposes (or
  applies) wikilinks. Adds reciprocal `## Related` backlinks when
  applying. Guards against generic words and meta-file slugs (CLAUDE,
  README) being auto-linked.
- `scripts/harvest-themes.py [--min-count N]` — n-gram clusters across all
  retros, cross-checks against existing patterns, emits JSON of
  `propose`/`strengthen` candidates.

The hook at `90-meta/hooks/post-write.sh` is wired into Claude Code's
`PostToolUse` event for `Write|Edit`. After any markdown write inside the
vault, it rebuilds the index and runs propose-links in apply mode. This
means **the graph extends itself with zero human prompting** — the user
writes a note, the hook wikilinks it.

To wire the hook on a new machine, merge the snippet at
`90-meta/hooks/claude-settings.json` into `~/.claude/settings.json`.

## Templates

All note templates live in `90-meta/templates/`. Always copy a template rather
than writing from scratch — it guarantees frontmatter compliance:

- `project.md`, `retro.md`, `daily.md`, `pattern.md`, `resource.md`
- `project-CLAUDE.md` — drop into a coding repo to bridge it back to the vault

## House rules

- Never delete user notes without asking.
- Never modify `.obsidian/` config without asking.
- When unsure where a note belongs, drop it in `00-inbox/` with good tags
  and let the user triage later.
- Keep notes scannable: prefer short sentences and bulleted lists over prose.
- Date stamps in frontmatter use ISO `YYYY-MM-DD`. Use the current date.

---

This file is the contract. If a future change to the vault makes any rule
above obsolete, update this file in the same commit.
