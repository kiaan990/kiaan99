---
description: Start a new coding project. Creates a project note in the Second Brain vault, links it from today's daily, and (if a repo path is given) drops the project-CLAUDE.md bridge into the repo.
argument-hint: <project-name> [optional: repo path]
---

Invoke the `start-project` skill at
`/home/user/Obsidian/SecondBrain/90-meta/skills/start-project/SKILL.md`
for project: $ARGUMENTS

Run the full workflow:
1. Slugify
2. vault-search FIRST (surface related work)
3. Gather goal, stack, repo path (prompt if missing)
4. Clone the template
5. Link from today's daily
6. Run auto-link
7. Drop the project-CLAUDE.md bridge into the repo (ask before overwriting)
8. Report
