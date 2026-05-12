#!/usr/bin/env python3
"""
propose-links.py <note_path> — Scan one note against the graph index and
propose wikilinks for plain-text mentions of existing note titles/slugs.

Behavior:
- Reads the note at <note_path>
- Loads 90-meta/graph/index.json
- For each existing note in the index (except self), checks if its title
  or slug appears in plain text in the body (not inside code fences, not
  inside existing wikilinks, not in markdown links)
- Emits a structured proposal list to stdout

Usage:
  propose-links.py /path/to/note.md           # print proposals
  propose-links.py /path/to/note.md --apply   # also rewrite the file

Designed to be safe: --apply only replaces the FIRST occurrence per target
per file, never inside code fences or existing links. Bidirectional
backlink insertion happens via the --apply path too.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

VAULT = Path("/home/user/Obsidian/SecondBrain")
INDEX = VAULT / "90-meta" / "graph" / "index.json"
FRONTMATTER_RE = re.compile(r"^(---\n.*?\n---\n)", re.DOTALL)
CODE_FENCE_RE = re.compile(r"```.*?```", re.DOTALL)
WIKILINK_RE = re.compile(r"\[\[[^\]]+\]\]")
MD_LINK_RE = re.compile(r"\[[^\]]+\]\([^)]+\)")
STOPWORDS = {"a", "an", "the", "of", "and", "or", "to", "in", "on", "for",
             "with", "by", "from", "is", "are", "was", "were", "be", "been",
             "this", "that", "it", "as", "at", "but", "if", "so"}
# Slugs that look like notes but shouldn't be auto-linked because their
# string form is too generic or filename-like (e.g. CLAUDE.md is a config
# convention, not a topic). The note still exists; it just won't be the
# target of automatic in-body linking.
NO_AUTOLINK_SLUGS = {"CLAUDE", "README", "AGENTS", "SETUP"}


def load_index() -> dict:
    if not INDEX.exists():
        sys.stderr.write(
            f"index missing at {INDEX}. Run build-index.py first.\n"
        )
        sys.exit(2)
    return json.loads(INDEX.read_text(encoding="utf-8"))


def candidate_phrases(note: dict) -> list[tuple[str, str]]:
    """Return [(phrase, slug)] candidates for matching against body text."""
    phrases: list[tuple[str, str]] = []
    slug = note["slug"]
    title = note["title"]
    # Skip overly generic single-word slugs and meta-file conventions
    if len(slug) <= 3 or slug in STOPWORDS or slug in NO_AUTOLINK_SLUGS:
        return []
    # Single-word slugs that are common nouns or proper nouns ambiguous
    # with product names are skipped — auto-linker is conservative on these.
    if "-" not in slug and slug.lower() not in {n.lower() for n in [title]}:
        # Allow only multi-word titles to drive single-word slugs
        if len(title.split()) < 2:
            return []
    phrases.append((slug, slug))
    # The H1 title — only if it's distinct from the slug and >= 2 words
    if title and title.lower() != slug.lower() and len(title.split()) >= 2:
        phrases.append((title, slug))
    # Strip recurring title prefixes ("Pattern: ", "Retro: ") for matching
    for prefix in ("Pattern: ", "Retro: ", "Resource: "):
        if title.startswith(prefix):
            stripped = title[len(prefix):]
            if len(stripped.split()) >= 2:
                phrases.append((stripped, slug))
    return phrases


def split_protected(text: str) -> list[tuple[str, bool]]:
    """Split text into (chunk, is_protected) where protected chunks are
    code fences, existing wikilinks, and markdown links — never replaced."""
    spans: list[tuple[int, int]] = []
    for m in CODE_FENCE_RE.finditer(text):
        spans.append((m.start(), m.end()))
    for m in WIKILINK_RE.finditer(text):
        spans.append((m.start(), m.end()))
    for m in MD_LINK_RE.finditer(text):
        spans.append((m.start(), m.end()))
    spans.sort()
    # Merge overlaps
    merged: list[tuple[int, int]] = []
    for s, e in spans:
        if merged and s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    out: list[tuple[str, bool]] = []
    cursor = 0
    for s, e in merged:
        if cursor < s:
            out.append((text[cursor:s], False))
        out.append((text[s:e], True))
        cursor = e
    if cursor < len(text):
        out.append((text[cursor:], False))
    return out


def propose(note_path: Path, index: dict) -> list[dict]:
    text = note_path.read_text(encoding="utf-8")
    fm_match = FRONTMATTER_RE.match(text)
    body = text[fm_match.end():] if fm_match else text
    self_slug = note_path.stem

    proposals: list[dict] = []
    seen_targets: set[str] = set()
    for other in index["notes"]:
        if other["slug"] == self_slug:
            continue
        for phrase, target_slug in candidate_phrases(other):
            if target_slug in seen_targets:
                continue
            pat = re.compile(
                rf"(?<![A-Za-z0-9_\[]){re.escape(phrase)}(?![A-Za-z0-9_\]])",
                re.IGNORECASE,
            )
            for chunk, protected in split_protected(body):
                if protected:
                    continue
                m = pat.search(chunk)
                if m:
                    proposals.append({
                        "phrase": m.group(0),
                        "target_slug": target_slug,
                        "target_title": other["title"],
                        "target_path": other["rel_path"],
                    })
                    seen_targets.add(target_slug)
                    break
    return proposals


def apply_proposals(note_path: Path, proposals: list[dict]) -> int:
    if not proposals:
        return 0
    text = note_path.read_text(encoding="utf-8")
    fm_match = FRONTMATTER_RE.match(text)
    fm = text[: fm_match.end()] if fm_match else ""
    body = text[fm_match.end():] if fm_match else text

    applied = 0
    new_chunks: list[str] = []
    for chunk, protected in split_protected(body):
        if protected:
            new_chunks.append(chunk)
            continue
        for p in proposals:
            pat = re.compile(
                rf"(?<![A-Za-z0-9_\[]){re.escape(p['phrase'])}(?![A-Za-z0-9_\]])",
                re.IGNORECASE,
            )
            m = pat.search(chunk)
            if m:
                start, end = m.span()
                original = chunk[start:end]
                replacement = (
                    f"[[{p['target_slug']}|{original}]]"
                    if original.lower() != p["target_slug"].lower()
                    else f"[[{p['target_slug']}]]"
                )
                chunk = chunk[:start] + replacement + chunk[end:]
                applied += 1
        new_chunks.append(chunk)
    note_path.write_text(fm + "".join(new_chunks), encoding="utf-8")
    return applied


def ensure_backlinks(note_path: Path, proposals: list[dict]) -> list[str]:
    """For each proposal, ensure the target note mentions this note back."""
    self_slug = note_path.stem
    added: list[str] = []
    for p in proposals:
        target = VAULT / p["target_path"]
        if not target.exists():
            continue
        ttext = target.read_text(encoding="utf-8")
        if f"[[{self_slug}" in ttext:
            continue
        if "## Related" in ttext:
            ttext = ttext.replace(
                "## Related",
                f"## Related\n\n- [[{self_slug}]]",
                1,
            )
        else:
            if not ttext.endswith("\n"):
                ttext += "\n"
            ttext += f"\n## Related\n\n- [[{self_slug}]]\n"
        target.write_text(ttext, encoding="utf-8")
        added.append(p["target_slug"])
    return added


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        sys.stderr.write("usage: propose-links.py <note_path> [--apply]\n")
        return 1
    note_path = Path(argv[1]).resolve()
    if not note_path.exists():
        sys.stderr.write(f"note not found: {note_path}\n")
        return 1
    apply = "--apply" in argv[2:]

    index = load_index()
    proposals = propose(note_path, index)

    if not proposals:
        print(f"no proposals for {note_path.name}")
        return 0

    print(f"proposals for {note_path.name}:")
    for p in proposals:
        print(f"  '{p['phrase']}' -> [[{p['target_slug']}]]  ({p['target_path']})")

    if apply:
        n_applied = apply_proposals(note_path, proposals)
        n_back = ensure_backlinks(note_path, proposals)
        print(f"applied: {n_applied} links, {len(n_back)} backlinks added")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
