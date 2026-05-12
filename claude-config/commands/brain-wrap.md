---
description: Wrap up a coding project. Generates a retro from the project note + git history, extracts patterns, runs harvest-patterns, updates status, archives if done.
argument-hint: <project-slug>
---

Invoke the `end-project` skill at
`/home/user/Obsidian/SecondBrain/90-meta/skills/end-project/SKILL.md`
for project slug: $ARGUMENTS

Run the full workflow including the `harvest-patterns` and `auto-link`
post-steps. Always ask the user for the "Don't repeat" line — never
auto-generate it.
