---
name: lecture-notes
description: Turn a raw lecture transcript from the vault's raw/ folder into structured, linked study notes in wiki/lectures/. Use when the user pastes or points to a lecture transcript or recording dump.
---

# Lecture notes

Convert a messy transcript into durable wiki notes.

## Workflow

1. Read the transcript in `raw/transcripts/` (the exact file is given in the task).
2. Identify the lecture's structure: main sections, key concepts, definitions, examples, anything the lecturer stressed ("this will be on the exam").
3. Search `wiki/` for existing notes on the same concepts so you can link to them with `[[wikilinks]]`.
4. Write the main note using `template.md`, inside the new folder given in the task (`wiki/lectures/YYYY-MM-DD-title/`).
5. Optionally add a few short concept notes in the same folder if a concept deserves its own page. Link them from the main note.

## Rules

- Only create files inside the new lecture folder. Never edit existing notes; link to them instead.
- Clean up filler ("um", repeated phrases) but keep the lecturer's meaning.
- Mark anything you're unsure about from the transcript with `(?)`.
- Link back to the raw transcript in the Source section.
