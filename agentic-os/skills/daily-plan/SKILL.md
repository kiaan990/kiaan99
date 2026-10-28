---
name: daily-plan
description: Build a one-screen morning brief and plan for today from the user's tasks, calendar (if provided) and recent vault notes, saved in outputs/briefs/. Use for "plan my day", morning briefs, and the 8:00 automation.
---

# Daily plan (morning brief)

A calm, one-screen plan for today.

## Workflow

1. Collect inputs: tasks the user gave, calendar/tasks from their personal server (if included in the task), and the recently changed vault files listed in the task.
2. Skim the most relevant `wiki/` and newest `raw/` notes for deadlines, commitments and loose ends.
3. Pick the **top 3 priorities**. Prefer deadlines, things that unblock other things, and work already in progress.
4. Lay out a realistic schedule in time blocks around fixed calendar events. Leave buffer time.
5. Write the brief with `template.md` and save it as a NEW file in `outputs/briefs/` (exact path given in the task).

## Rules

- One screen. No long paragraphs.
- If there is no calendar or task data, say so in one line and plan from notes only.
- Never invent meetings or deadlines.
