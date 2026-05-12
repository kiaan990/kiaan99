---
created: 2026-05-11
updated: 2026-05-11
tags: [meta, mcp, setup]
type: resource
---

# MCP setup — Obsidian ↔ Claude Code

This vault is wired to Claude Code via the
[`cyanheads/obsidian-mcp-server`](https://github.com/cyanheads/obsidian-mcp-server)
MCP server, which talks to Obsidian through the **Local REST API**
community plugin. Setup is a four-step checklist.

## Why this server

- npx-installable (no Python / `uv` required)
- Structured audit logging — every Claude action against the vault is
  logged so you can trace what changed
- Sophisticated permission controls (read-only, append-only, full)
- Surgical edit support: can patch frontmatter, append to sections,
  insert at headings without rewriting the whole note

The alternative (`MarkusPfundstein/mcp-obsidian`) is also active but
requires `uvx` and has a smaller toolset.

## One-time setup on each machine

### 1. Install the Local REST API plugin in Obsidian

1. Open Obsidian → **Settings** → **Community plugins**
2. If community plugins are off, turn them on (you'll be warned about
   third-party code; that's expected)
3. Click **Browse**, search for **"Local REST API"** (author: Adam Coddington)
4. Click **Install**, then **Enable**

### 2. Generate and copy the API key

1. **Settings** → **Community plugins** → **Local REST API** (gear icon)
2. Copy the **API Key** value
3. Note the port (defaults to `27124` for HTTPS, `27123` for HTTP)
4. Recommended: leave HTTPS on; the plugin self-signs a cert. The MCP
   server is configured to accept the self-signed cert by default.

### 3. Wire the key into Claude Code

The MCP server config is already at `/home/user/.claude.json`. Open it
and replace `REPLACE_ME_WITH_LOCAL_REST_API_KEY` with the key from step 2.

```bash
# quick replace (Linux / macOS)
sed -i 's/REPLACE_ME_WITH_LOCAL_REST_API_KEY/<paste-key-here>/' ~/.claude.json
```

If `~/.claude.json` doesn't exist on a new machine, copy the reference at
`/home/user/Obsidian/SecondBrain/90-meta/mcp/claude-mcp-config.json` into
place and edit.

### 4. Open the vault in Obsidian

The MCP server reads whichever vault Obsidian currently has open. Open
`/home/user/Obsidian/SecondBrain` as a vault (File → Open vault → Open
folder as vault).

## Node version requirement

`obsidian-mcp-server@3.1.7` requires **Node ≥24**. Check with `node --version`.

If you're on Node 22 or older, skip `3.0.0` (it has known strict-validation
boot failures — 30 tool-definition errors). Use `@2.0.7` instead:

```json
"args": ["-y", "obsidian-mcp-server@2.0.7"]
```

`2.0.7` has a smaller toolset (no surgical frontmatter/tag tools) but boots
cleanly on Node 16+. Upgrade to Node 24 + `@3.1.7` when you can.

## Verification

Inside any Claude Code session, run:

```
List 3 notes from my Obsidian vault.
```

If the MCP tools `mcp__obsidian__*` are loaded and the call returns
note paths from this vault, the wiring is live. If you get a connection
refused or 401, check (in order):

1. Obsidian is running with the vault open
2. Local REST API plugin is enabled (toggle off/on)
3. The API key in `~/.claude.json` matches the one in the plugin settings
4. Port matches (default 27124 HTTPS)

## Security notes

- The Local REST API binds to `127.0.0.1` only — not exposed externally.
- The API key is the only auth. Treat it like a password. Don't commit
  it to git. The placeholder in this vault's reference config is
  intentional — never replace it in the committed copy.
- The MCP server logs every tool call. Logs live in the server's stderr
  which Claude Code captures.
