# CLAUDE.md — Project bridge to the Second Brain

## Second brain

The user maintains a second-brain vault at:

**`/home/user/Obsidian/SecondBrain`**

Read `/home/user/Obsidian/SecondBrain/CLAUDE.md` before doing any non-trivial
work in this repo. That file is the authoritative operating manual for the
vault.

## Required workflow

### Before solving any non-trivial problem

1. Search `/home/user/Obsidian/SecondBrain/70-patterns/` for a relevant pattern.
2. Search `/home/user/Obsidian/SecondBrain/60-retros/` for prior projects in
   the same problem domain — read at least the "Don't repeat" section of any
   match.
3. Search `/home/user/Obsidian/SecondBrain/10-projects/` and `40-archive/`
   for related work.
4. If this repo doesn't yet have a project note in the vault, create one from
   `/home/user/Obsidian/SecondBrain/90-meta/templates/project.md` under
   `/home/user/Obsidian/SecondBrain/10-projects/<slug>/`.

### While working

- Append a dated bullet to the project note's "Daily log" section when you
  make a meaningful decision or run into a notable obstacle.
- Add an entry to today's daily note at
  `/home/user/Obsidian/SecondBrain/50-daily/YYYY-MM-DD.md` linking the
  project.

### When this project is done or paused

1. Write a retro to
   `/home/user/Obsidian/SecondBrain/60-retros/YYYY-MM-DD-<slug>.md` using
   `90-meta/templates/retro.md`.
2. Extract reusable solutions into
   `/home/user/Obsidian/SecondBrain/70-patterns/pattern-<name>.md`.
3. Update the project note: bump `updated`, set `status` to `done` /
   `paused` / `archived`.
4. If `done` or `archived`, move the project folder to
   `/home/user/Obsidian/SecondBrain/40-archive/`.

## Project metadata

_Fill these in when this template is dropped into a repo._

- **Vault project note:** `/home/user/Obsidian/SecondBrain/10-projects/<slug>/<slug>.md`
- **Slug:** `<slug>`
- **Stack:** `<stack>`
