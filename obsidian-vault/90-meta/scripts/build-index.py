#!/usr/bin/env python3
"""
build-index.py — Walk the Second Brain vault, parse every note, and
write a JSON graph index to 90-meta/graph/index.json.

The index is the foundation for autonomous connection-making. The skills
(auto-link, connect-dots, graph-health, harvest-patterns) consume this
index instead of re-walking the filesystem on every call.

Output schema:
  {
    "built_at": "<ISO-8601>",
    "vault_root": "<absolute path>",
    "notes": [
      {
        "slug": "<filename without .md>",
        "path": "<absolute path>",
        "rel_path": "<path relative to vault>",
        "dir": "<top-level folder, e.g. 70-patterns>",
        "title": "<H1 text or slug if missing>",
        "type": "<from frontmatter or inferred from dir>",
        "tags": [<frontmatter tags>],
        "status": "<from frontmatter, project notes only>",
        "stack": [<frontmatter stack>],
        "created": "<YYYY-MM-DD>",
        "updated": "<YYYY-MM-DD>",
        "outlinks": [<target slugs>],
        "inlinks": [<source slugs>]
      },
      ...
    ],
    "by_tag":  { "<tag>":  [<slug>, ...] },
    "by_type": { "<type>": [<slug>, ...] },
    "orphans": [<slugs with zero inlinks, excluding inbox/daily/meta>],
    "stale_active": [<project slugs with status:active and updated > 30d ago>]
  }

Idempotent. Safe to re-run at any time. Used by hooks/post-write.sh.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

VAULT = Path("/home/user/Obsidian/SecondBrain")
OUT = VAULT / "90-meta" / "graph" / "index.json"
WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)(?:\|[^\]]+)?(?:#[^\]]+)?\]\]")
FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---", re.DOTALL)
H1_RE = re.compile(r"^# +(.+)$", re.MULTILINE)
CODE_FENCE_RE = re.compile(r"```.*?```", re.DOTALL)


def parse_frontmatter(text: str) -> dict:
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}
    body = m.group(1)
    fm: dict = {}
    for line in body.splitlines():
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        key = key.strip()
        val = val.strip()
        if val.startswith("[") and val.endswith("]"):
            inner = val[1:-1].strip()
            fm[key] = [v.strip() for v in inner.split(",") if v.strip()] if inner else []
        else:
            fm[key] = val
    return fm


def strip_for_links(text: str) -> str:
    # Remove code fences before extracting wikilinks
    return CODE_FENCE_RE.sub("", text)


def extract_outlinks(text: str) -> list[str]:
    body = strip_for_links(text)
    return list({m.group(1).strip() for m in WIKILINK_RE.finditer(body)})


def extract_title(text: str, slug: str) -> str:
    body = FRONTMATTER_RE.sub("", text, count=1)
    m = H1_RE.search(body)
    return m.group(1).strip() if m else slug


def infer_type(rel_path: Path, fm: dict) -> str:
    if "type" in fm:
        return fm["type"]
    top = rel_path.parts[0] if rel_path.parts else ""
    return {
        "00-inbox": "inbox",
        "10-projects": "project",
        "20-areas": "area",
        "30-resources": "resource",
        "40-archive": "project",
        "50-daily": "daily",
        "60-retros": "retro",
        "70-patterns": "pattern",
        "90-meta": "meta",
    }.get(top, "unknown")


def days_since(date_str: str) -> int:
    try:
        d = dt.date.fromisoformat(date_str)
        return (dt.date.today() - d).days
    except (ValueError, TypeError):
        return -1


def main() -> int:
    if not VAULT.exists():
        print(f"vault not found: {VAULT}", file=sys.stderr)
        return 1

    notes: dict[str, dict] = {}
    for path in VAULT.rglob("*.md"):
        # Skip the .obsidian config, .git, and the templates dir (templates
        # contain placeholder wikilinks like [[]] that pollute the graph).
        parts = path.relative_to(VAULT).parts
        if any(p.startswith(".") for p in parts):
            continue
        if "templates" in parts:
            continue

        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue

        slug = path.stem
        fm = parse_frontmatter(text)
        rel = path.relative_to(VAULT)
        notes[slug] = {
            "slug": slug,
            "path": str(path),
            "rel_path": str(rel),
            "dir": rel.parts[0] if rel.parts else "",
            "title": extract_title(text, slug),
            "type": infer_type(rel, fm),
            "tags": fm.get("tags", []) if isinstance(fm.get("tags"), list) else [],
            "status": fm.get("status", ""),
            "stack": fm.get("stack", []) if isinstance(fm.get("stack"), list) else [],
            "created": fm.get("created", ""),
            "updated": fm.get("updated", ""),
            "outlinks": extract_outlinks(text),
            "inlinks": [],
        }

    # Resolve inlinks: for each note, for each outlink, push self into target's inlinks
    for slug, note in notes.items():
        for target in note["outlinks"]:
            if target in notes:
                notes[target]["inlinks"].append(slug)

    # Dedup inlinks
    for note in notes.values():
        note["inlinks"] = sorted(set(note["inlinks"]))

    # Aggregations
    by_tag: dict[str, list[str]] = {}
    by_type: dict[str, list[str]] = {}
    for note in notes.values():
        for tag in note["tags"]:
            by_tag.setdefault(tag, []).append(note["slug"])
        by_type.setdefault(note["type"], []).append(note["slug"])

    orphan_dirs_excluded = {"00-inbox", "50-daily", "90-meta"}
    orphan_files_excluded = {"README", "CLAUDE", "welcome"}
    orphans = [
        n["slug"] for n in notes.values()
        if not n["inlinks"]
        and n["dir"] not in orphan_dirs_excluded
        and n["slug"] not in orphan_files_excluded
    ]

    stale = [
        n["slug"] for n in notes.values()
        if n["type"] == "project"
        and n.get("status") == "active"
        and days_since(n.get("updated", "")) > 30
    ]

    index = {
        "built_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "vault_root": str(VAULT),
        "notes": sorted(notes.values(), key=lambda n: n["slug"]),
        "by_tag": {k: sorted(set(v)) for k, v in sorted(by_tag.items())},
        "by_type": {k: sorted(set(v)) for k, v in sorted(by_type.items())},
        "orphans": sorted(orphans),
        "stale_active": sorted(stale),
        "stats": {
            "total_notes": len(notes),
            "total_tags": len(by_tag),
            "total_outlinks": sum(len(n["outlinks"]) for n in notes.values()),
            "orphan_count": len(orphans),
            "stale_count": len(stale),
        },
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(index, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {OUT} ({index['stats']['total_notes']} notes, "
          f"{index['stats']['total_outlinks']} links, "
          f"{index['stats']['orphan_count']} orphans, "
          f"{index['stats']['stale_count']} stale)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
