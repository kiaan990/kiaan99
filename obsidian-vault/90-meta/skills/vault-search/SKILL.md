---
name: vault-search
description: Search the Second Brain vault for prior work on a topic across patterns, retros, projects, and resources. Returns the top hits with one-line summaries. TRIGGER PHRASES — "search the vault for X", "what do I have on X", "look up X in my notes", "find notes about X", "vault search X". Run this at the start of any non-trivial coding task; do NOT skip the vault before writing code.
version: 1.0
---

# vault-search

## Trigger phrases

- "search the vault for ___"
- "what do I have on ___"
- "look up ___ in my notes"
- "find notes about ___"
- "vault search ___"

Implicitly triggered at the top of every coding task per the "Before you
start" checklist in the root `CLAUDE.md`.

## Purpose

Surface the top 5 most relevant notes from the vault for any query, ranked
by directory priority and tag overlap. Cheap, fast, always-on.

## Workflow

### 1. Build the query set

Take the user's query string. Generate variants:
- Exact phrase
- Lowercase
- kebab-case slug (for matching filenames)
- Each individual word (for grep -E)

### 2. Search in priority order

Search these directories in order — patterns and retros are highest signal:

1. `/home/user/Obsidian/SecondBrain/70-patterns/`
2. `/home/user/Obsidian/SecondBrain/60-retros/`
3. `/home/user/Obsidian/SecondBrain/10-projects/` (active)
4. `/home/user/Obsidian/SecondBrain/40-archive/` (dormant projects)
5. `/home/user/Obsidian/SecondBrain/30-resources/`
6. `/home/user/Obsidian/SecondBrain/20-areas/`
7. `/home/user/Obsidian/SecondBrain/00-inbox/`
8. `/home/user/Obsidian/SecondBrain/50-daily/` (lowest signal — chronological noise)

For each directory:

```bash
grep -rilE "<query_pattern>" "$DIR" 2>/dev/null
```

Also match on YAML frontmatter `tags:` if any query word appears as a tag:

```bash
grep -rlE "^tags:.*\b<word>\b" "$DIR"
```

### 3. Rank and deduplicate

For each hit, compute a score:

- +5 if filename contains the slug
- +3 if a query word appears in `tags:` frontmatter
- +2 if a query word appears in the H1
- +1 per occurrence in body (cap at +3)
- ×2 multiplier if dir is `70-patterns/` or `60-retros/`

Take top 5.

### 4. Extract a one-line summary per hit

For each top hit, read the file and pull:
- `type:` from frontmatter
- The first bullet under "Goal" (projects), "Problem" (patterns), or
  "What I built" (retros)

### 5. Report

Format:

```
Top 5 hits for "<query>":

1. [[<slug>]] — <type> — <one-line summary>   (<path>)
2. ...

No-hit zones (zero results in these dirs): <list>
```

If zero hits across the whole vault, say so explicitly and suggest the user
make this the first note in a new domain.

## When MCP is available

Prefer the `mcp__obsidian__*` search tools (full-text, frontmatter-aware,
respects Obsidian's index) over raw grep. Fall back to grep if the MCP
server isn't responding.

## Performance notes

- Limit grep depth with `--include='*.md'`
- Skip `.obsidian/` and `.git/` if present
- Cap result set to ~50 raw hits before ranking; users almost never want
  more than the top 5
