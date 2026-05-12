# Second Brain — Deployment Guide

This branch contains a complete "second brain" system that links an Obsidian
vault to Claude Code. It was built end-to-end in a sandbox; deploying it
onto your local machine takes ~5 minutes.

## What's in this commit

| Path in repo | Goes to on your machine |
|---|---|
| `obsidian-vault/` | `/home/user/Obsidian/SecondBrain/` |
| `claude-config/claude.json` | `~/.claude.json` (merge `mcpServers` key) |
| `claude-config/settings.json` | `~/.claude/settings.json` (merge `hooks` key) |
| `claude-config/commands/*.md` | `~/.claude/commands/` (copy as-is) |
| `CLAUDE.md` | already updated with second-brain bridge |

## Deploy steps

### 1. Place the vault

```bash
mkdir -p ~/Obsidian
cp -r obsidian-vault ~/Obsidian/SecondBrain
chmod +x ~/Obsidian/SecondBrain/90-meta/hooks/post-write.sh
chmod +x ~/Obsidian/SecondBrain/90-meta/scripts/*.py
```

### 2. Merge Claude Code config (user-global)

The `mcpServers` block and `hooks` block need to be merged into your
existing `~/.claude.json` and `~/.claude/settings.json`. If those files
don't exist, copy the provided ones directly:

```bash
# If ~/.claude.json doesn't exist:
cp claude-config/claude.json ~/.claude.json

# If ~/.claude/settings.json doesn't exist:
mkdir -p ~/.claude
cp claude-config/settings.json ~/.claude/settings.json

# Slash commands:
mkdir -p ~/.claude/commands
cp claude-config/commands/*.md ~/.claude/commands/
```

If those files **already exist**, open each and merge the relevant top-level
key (`mcpServers` for `claude.json`, `hooks` for `settings.json`) — don't
overwrite.

### 3. Install the Obsidian Local REST API plugin

In Obsidian:
1. **Settings → Community plugins → Browse → "Local REST API"** (author:
   Adam Coddington) → Install → Enable.
2. **Settings → Local REST API** → copy the **API Key**.

### 4. Paste the API key

```bash
sed -i 's/REPLACE_ME_WITH_LOCAL_REST_API_KEY/<paste-key-here>/' ~/.claude.json
```

(Use the key from step 3. Don't commit it to git.)

### 5. Open the vault in Obsidian

`File → Open vault → Open folder as vault` → `~/Obsidian/SecondBrain`.

### 6. Verify

Open a new Claude Code session anywhere and ask:

> List 3 notes from my Obsidian vault.

You should see paths like `00-inbox/welcome.md`, `70-patterns/...`,
`60-retros/...`. If you get a connection error, see
`obsidian-vault/90-meta/mcp/SETUP.md` for troubleshooting.

### Node version note

`obsidian-mcp-server@3.1.7` (the pinned version) requires **Node ≥24**.
Check with `node --version`. If you're on Node 22, edit `~/.claude.json`
and pin to `@2.0.7` instead — it boots cleanly on Node 16+ but has fewer
surgical edit tools. Skip `@3.0.0` (known strict-validation boot failures).

## Daily-use cheat sheet

Five phrases to remember:

| Say | What happens |
|---|---|
| "Start a new project for X" | Clone template, slugify, link from today's daily, drop bridge into repo. Implicit `vault-search` for prior work first. |
| "Have I solved this before?" / "Find related work for X" | Cluster-search across retros + patterns + projects. Proposes new pattern if a dense cluster has no file. |
| "Wrap up project Y" | Generate retro from project note + git log. Extract patterns. Run `harvest-patterns` for cross-retro themes. Archive. |
| "Rollup my day" / "/brain-daily" | Idempotent merge of today's commits + vault edits + inbox into the daily note. Plus light `graph-health` pass. |
| "What's stale?" / "/brain-health" | Surface orphan notes, broken wikilinks, stale active projects. |

Slash command equivalents: `/brain-search`, `/brain-start`, `/brain-connect`,
`/brain-wrap`, `/brain-daily`, `/brain-health`.

## Self-learning loop

Once deployed, the vault extends itself without explicit prompts:

- **Every `Write`/`Edit` of any `.md` file inside the vault** triggers
  `90-meta/hooks/post-write.sh` (via Claude Code's `PostToolUse` hook).
  That script rebuilds `90-meta/graph/index.json` and runs
  `propose-links.py --apply` on the changed note. Result: new notes get
  wikilinked into the graph with no human prompting.
- **Every retro** triggers `harvest-patterns/` from inside the
  `end-project` skill. Cross-retro themes appearing in ≥3 retros become
  new pattern proposals.
- **Every daily rollup** runs `graph-health/` in light mode, surfacing
  stale `status: active` projects (>7 days untouched).

You can disable the auto-link hook by removing the `hooks` block from
`~/.claude/settings.json`. Manual invocations always still work.

## What's the first project you should run through this?

Pick a coding task you're starting this week — ideally one in TypeScript
or Python (the stacks you flagged). Say to Claude:

> Start a new project for <name>

Claude will run vault-search first (catching the welcome note + the
vault-setup retro + the vault-search-first pattern), then prompt you for
goal/stack/repo. Watch it auto-link the new project note. When you ship
or pause it, say "wrap up project <slug>" and watch a retro + pattern
extraction happen automatically.

## Files of note

- `obsidian-vault/CLAUDE.md` — the operating contract every Claude session
  follows when working in the vault. Single source of truth.
- `obsidian-vault/90-meta/mcp/SETUP.md` — MCP setup detail + troubleshooting.
- `obsidian-vault/90-meta/skills/*/SKILL.md` — workflow for each of the 8
  skills (5 user-triggered + 3 self-learning).
- `obsidian-vault/90-meta/scripts/*.py` — the actual self-learning
  machinery: index builder, link proposer, theme harvester.

## Smoke-tested in the build sandbox

| Test | Result |
|---|---|
| Create project from template, fill frontmatter | ✅ |
| Add pattern; vault-search surfaces it via body + tags | ✅ |
| Generate retro from end-project workflow; archive project | ✅ |
| Build graph index across 8 seed notes (12 tags, 13 outlinks) | ✅ |
| harvest-themes finds clusters | ✅ |
| propose-links runs cleanly on already-linked notes | ✅ |
| MCP server (`@3.1.7`) boots past env validation; JSON valid | ✅ |
| Live MCP query against Obsidian | ⏸ requires your local machine |
