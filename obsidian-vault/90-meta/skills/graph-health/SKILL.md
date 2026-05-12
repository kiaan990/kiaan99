---
name: graph-health
description: Audit the Second Brain graph for orphan notes, weak clusters, and stale active projects. Surfaces what needs attention. TRIGGER PHRASES — "graph health", "vault health check", "what's stale", "find orphan notes", "audit my vault". Run automatically by daily-rollup in light mode; run manually weekly in full mode.
version: 1.0
---

# graph-health

## Trigger phrases

- "graph health"
- "vault health check"
- "what's stale"
- "find orphan notes"
- "audit my vault"

Implicitly run by: `daily-rollup/` in light mode (stale projects + recent
orphans only).

## Modes

- **light** — invoked from daily-rollup. Returns: stale active projects,
  orphan notes from last 7 days. Cap output at 10 items.
- **full** — manual invocation. Returns: all orphan notes ever, weak
  clusters, frontmatter violators, broken wikilinks, untagged notes.

## Workflow (full mode)

### 1. Build the link graph

Walk every `*.md`. For each note, parse out:
- All `[[wikilinks]]` (outlinks)
- Frontmatter fields

Build:
- `outlinks[note] → [targets]`
- `inlinks[note] → [sources]`  (reverse of outlinks)

### 2. Find orphans

A note is an orphan if `len(inlinks[note]) == 0`. Exclude:
- `00-inbox/` (inbox is allowed to be orphan; that's its job)
- `50-daily/` (dailies are time-based, not topic-linked)
- `90-meta/` (meta is structural)
- The two README/CLAUDE files

Report orphans grouped by directory. For each, suggest 1-3 likely link
targets based on tag overlap.

### 3. Find broken wikilinks

For every `[[<target>]]`, check if `<target>.md` exists somewhere in the
vault. If not, report:

```
Broken: in [[source-note]] line N → [[missing-target]]
  Suggestion: did you mean [[closest-existing-slug]]?
```

### 4. Find stale active projects

For every note in `10-projects/` with `status: active`:

```
days_since_update = today - frontmatter.updated
```

If `days_since_update > 30`: warn (likely abandoned).
If `> 14`: flag (worth checking in).
If `> 7`: surface in light-mode output too.

### 5. Find weak clusters

A cluster is "weak" if:
- A pattern has `inlinks ≤ 1` (no retros use it)
- A retro has `outlinks ≤ 1` (didn't reference any prior work)

Either is a sign of a graph hole.

### 6. Find frontmatter violators

For each note, check that:
- `created`, `updated`, `tags`, `type` exist
- `type` is in the allowed set (project | daily | retro | pattern |
  resource | area | inbox)
- Project notes have `status` and `stack`
- Retro notes have `project` and `outcome`
- Pattern notes have `problem_domain` and `origin`

Report violators with the specific missing field.

### 7. Find untagged notes

`tags: []` or `tags:` (empty) → flag. Per house rules, every note has ≥2 tags.

### 8. Report

Sectioned report:

```
GRAPH HEALTH REPORT (full mode)
================================
Orphans (N):           <list grouped by dir>
Broken wikilinks (M):  <list with suggestions>
Stale active (K):      <list with days idle>
Weak nodes (L):        <patterns with no inlinks, retros with no outlinks>
Frontmatter issues:    <list with fields>
Untagged (J):          <list>

Overall score: <orphan rate, broken rate, freshness>
```

## Workflow (light mode)

Skip steps 3, 5, 6, 7. Run only steps 1, 2 (filtered to last 7 days), 4.
Cap each list at 10 items. Compress output to 2-line summary per category.

## Repair suggestions

Never auto-fix. Always propose, let the user decide:

- "Want me to delete orphan [[X]]?" — N
- "Want me to fix broken link in [[X]]?" — N
- "Want me to mark stale project [[X]] as paused?" — Y/N
