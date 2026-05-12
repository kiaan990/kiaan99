---
name: harvest-patterns
description: Scan all retros in the Second Brain for recurring themes and propose new patterns or strengthen existing ones. A theme appearing in ≥3 retros becomes a pattern candidate. TRIGGER PHRASES — "harvest patterns", "what patterns am I missing", "scan retros for themes". Run automatically by end-project after each new retro is written; safe to run manually weekly to catch missed patterns.
version: 1.0
---

# harvest-patterns

## Trigger phrases

- "harvest patterns"
- "what patterns am I missing?"
- "scan retros for themes"

Implicitly run by: `end-project/` after each new retro.

## Purpose

The vault should generate its own patterns. If three retros all complain
about webhook idempotency, that's a pattern waiting to be born. This skill
detects that and proposes the pattern file rather than waiting for the
user to notice.

## Workflow

### 1. Load all retros

Read every `*.md` under `60-retros/`. Extract:

- `tags`
- The "Don't repeat" line (most important)
- Bullets under "What worked", "What didn't", "Patterns extracted"
- The retro's `project` slug

### 2. Cluster by theme

For each retro's content, extract n-grams (2-4 word phrases, lowercased,
stop-words removed). Build a phrase → [retro_slugs] frequency map.

Filter to phrases appearing in ≥3 distinct retros.

Also cluster by tag co-occurrence: if `[auth, jwt, refresh-tokens]` appear
together in ≥3 retros, that's a tag-cluster theme.

### 3. Cross-check against existing patterns

Load all `70-patterns/*.md` and their `problem_domain` arrays.

For each candidate theme:

- If a pattern already covers it → **strengthen**: add the new retro to
  the pattern's "Origin / seen also in" list
- If no pattern covers it → **propose**: scaffold a new pattern file

### 4. Strengthen existing patterns

For each strengthen candidate:

```
Edit /home/user/Obsidian/SecondBrain/70-patterns/pattern-<name>.md:
  - Add to a "Seen also in" section (create if missing):
    - [[<retro-slug>]] — <retro one-line>
  - Bump `updated:` to today
```

### 5. Propose new patterns

For each propose candidate:

```
Suggested new pattern: pattern-<short-name>.md
  Based on retros: [[retro-1]], [[retro-2]], [[retro-3]]
  Common theme: <phrase / tag cluster>
  Suggested origin (oldest retro): [[retro-1]]
```

Ask the user: "Scaffold this pattern now? (Y/n)"

If yes:

```bash
cp /home/user/Obsidian/SecondBrain/90-meta/templates/pattern.md \
   /home/user/Obsidian/SecondBrain/70-patterns/pattern-<name>.md
```

Pre-fill: `tags`, `problem_domain`, `origin` (oldest retro), and a
"Source retros" list pointing at the cluster.

### 6. Run auto-link/

On every modified or new file. Ensures the new pattern is wikilinked into
the cluster's retros and vice versa.

### 7. Report

```
Pattern harvest scanned <N> retros.
  Strengthened: <K> existing patterns
  Proposed: <J> new patterns
  Themes ignored (below threshold): <L>
```

## Threshold tuning

Default minimum: **3 retros** per theme. Adjust in this file if signal is
too noisy or too sparse:

- 2 retros = jumpy, lots of false positives early in vault life
- 3 retros = balanced default
- 5 retros = high-confidence, may miss real patterns

## When MCP is available

Replace n-gram + Jaccard with embedding-based clustering via the MCP
server's similarity tool. Threshold: cosine ≥ 0.75 across ≥3 retros.
