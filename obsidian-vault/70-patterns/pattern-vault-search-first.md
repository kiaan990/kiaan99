---
created: 2026-05-11
updated: 2026-05-11
tags: [pattern, meta, workflow]
type: pattern
problem_domain: [meta, workflow]
origin: vault-setup
---

# Pattern: Vault search first

## Problem

Re-deriving solutions you've already solved. Repeating the same dead ends.
Forgetting that "future me" left notes for "now me".

## Context

Any non-trivial coding task — a new feature, a tricky debug, an
architecture choice. Especially relevant when the problem feels familiar
but you can't quite place it.

## Solution

Before opening an editor, run a 3-step vault sweep:

1. **Patterns:** `grep -ril <keyword> /home/user/Obsidian/SecondBrain/70-patterns/`
2. **Retros:** `grep -ril <keyword> /home/user/Obsidian/SecondBrain/60-retros/`
3. **Active + archived projects:** check `10-projects/` and `40-archive/`
   for the same domain or stack.

If any hit, read the "Don't repeat" line of the most recent retro before
writing code. Link the new project note to whatever you found.

## Code snippet

```bash
# Quick vault sweep
QUERY="$1"
VAULT="/home/user/Obsidian/SecondBrain"
echo "== patterns =="; grep -ril "$QUERY" "$VAULT/70-patterns/"
echo "== retros =="; grep -ril "$QUERY" "$VAULT/60-retros/"
echo "== projects =="; grep -ril "$QUERY" "$VAULT/10-projects/" "$VAULT/40-archive/"
```

## When to use

- Always, before any non-trivial coding task.
- Especially when something feels familiar.

## When NOT to use

- Trivial 30-second tasks (rename a variable, fix a typo).
- When you already know the answer cold.

## Origin project

[[2026-05-11-vault-setup]] — discovered while bootstrapping this vault.

## Related patterns

- _(none yet — first pattern in the vault)_
