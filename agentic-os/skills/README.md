# Skills

A **skill** is a reusable workflow Claude can run for you. Each one is a folder with a `SKILL.md`
(a short header with `name` and `description`, then the steps) and any templates it needs. This is
the standard Agent Skills format, so Claude Code can use these skills directly too: `install.sh`
links each folder into `~/.claude/skills/`.

| Skill | What it does | Where the result goes |
|---|---|---|
| `research-brief` | Topic → sourced brief | `outputs/research/` |
| `lecture-notes` | Raw transcript → structured notes | `raw/transcripts/` (source), `wiki/lectures/` (notes) |
| `daily-plan` | Tasks + notes → morning plan (also the 8:00 automation) | `outputs/briefs/` |
| `weekly-review` | The week's notes → review | `outputs/reviews/` |

## Add a new skill: two ways

You don't need to write code for either. Open Terminal in the `agentic-os` folder, run `claude`,
and paste one of these prompts.

### (a) From a conversation you already had

> Here is a conversation where I did a task by hand with an AI. Propose a reusable skill for it in
> the Agent Skills format: a new folder in `skills/` with a `SKILL.md` (frontmatter `name` +
> `description`, then a numbered workflow and rules) and a `template.md`. Ask me before creating files.
>
> [paste the conversation here]

### (b) From a plain description

> I do this regularly: *"Every Friday I turn my meeting notes into a list of follow-up emails."*
> Create a skill for it in `skills/` in the Agent Skills format, with a template. Ask me anything
> you need to know first.

### Make it a dashboard button (one extra step)

A new skill folder works straight away inside Claude Code, as `/skill-name`. For safety, the
**dashboard** can only run skills that are also listed in the allowlist file
`server/jobs/registry.js`, each with fixed inputs, tools and an output folder. Ask Claude:

> Add the `<skill-name>` skill to `server/jobs/registry.js`, following the existing entries.
> Inputs: … Output folder: `outputs/…`. Tools: read + write only (no web) unless I say otherwise.

Then restart the app (Control + C, then `npm start`).

## Review the permissions a skill needs

Each entry in `server/jobs/registry.js` lists its `tools`. When a job runs, its first event in the
dashboard (**Permissions**) shows exactly what was pre-approved. Typically:

- **Read** in `raw/`, `wiki/` and `outputs/`
- **Write** to the one new output file (or one new folder) for this run, and nothing else
- **WebSearch / WebFetch** only for skills marked `web: true`

Anything else is refused automatically (`--permission-mode dontAsk`): there is no Bash, nothing
runs in the background, and nothing is auto-approved. Your personal Claude Code settings
(`~/.claude/settings.json`) still apply too. If you've allowed extra tools there, they apply to
these runs as well.
