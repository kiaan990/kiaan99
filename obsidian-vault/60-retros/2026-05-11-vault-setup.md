---
created: 2026-05-11
updated: 2026-05-11
tags: [retro, meta, vault-setup, tooling]
type: retro
project: vault-setup
outcome: shipped
---

# Retro: Vault setup

**Project note:** _(no project note — this was a one-shot bootstrap, not a tracked project)_
**Dates:** 2026-05-11 → 2026-05-11

## What I built

A "second brain" Obsidian vault wired into Claude Code. File-based PARA-ish
taxonomy (`00-inbox` … `90-meta`), 6 markdown templates with strict YAML
frontmatter, 8 vault skills (5 user-triggered workflow + 3 self-learning),
and a project-bridging template (`project-CLAUDE.md`) that drops into any
coding repo to point it back to the vault.

## What worked

- Numbered folder prefixes (`00-`, `10-`, `20-`…) — sort naturally in any
  file browser and force a mental order.
- Template-based note creation forces frontmatter compliance from day one.
- Defining the "self-learning loop" up front (auto-link, harvest-patterns,
  graph-health) prevents the vault from being a passive filing cabinet.
- Slug discipline: `kebab-case` for projects, `YYYY-MM-DD-slug` for retros
  — collisions become impossible and chronological sorting is free.

## What didn't

- Initially scoped only to "search the vault", which is too passive. The
  vault has to actively propose connections and patterns or it rots into a
  write-only journal. Fixed by adding the self-learning skills.
- No auto-archival rule on day one. Stale `status: active` projects will
  accumulate without `graph-health` checking them.

## Patterns extracted

- [[pattern-vault-search-first]] — sweep patterns + retros + projects
  before any non-trivial work.

## Links to code

- Vault repo: `/home/user/Obsidian/SecondBrain` (not under git yet — see
  "Don't repeat" below).

## Tags for future search

- second-brain, vault-setup, obsidian, claude-code, mcp, knowledge-management,
  para, zettelkasten, self-learning

## Don't repeat

> A vault that only stores doesn't compound. Build the self-learning loop
> (auto-link on save, harvest patterns from retros, surface orphans
> weekly) on day one — not "later". And put the vault under git
> immediately so daily diffs become an audit trail.
