#!/usr/bin/env python3
"""
harvest-themes.py — Scan all retros for recurring themes and emit
pattern proposals to stdout. Implements the harvest-patterns/ skill.

A "theme" is a 2-4 word phrase (n-gram) that appears across N or more
distinct retros, weighted by tag co-occurrence. Themes already covered
by an existing pattern (matched on slug, title, or problem_domain) are
marked as "strengthen" candidates instead of "propose new" candidates.

Output is JSON: a list of theme objects with type ("propose" | "strengthen"),
phrase, retros, and existing_pattern (for strengthen).

Usage:
  harvest-themes.py [--min-count N]   # default N=3
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

VAULT = Path("/home/user/Obsidian/SecondBrain")
FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---", re.DOTALL)
WORD_RE = re.compile(r"[a-z][a-z0-9-]+")
STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
    "by", "from", "is", "are", "was", "were", "be", "been", "this", "that",
    "it", "as", "at", "but", "if", "so", "than", "then", "i", "you", "we",
    "they", "my", "your", "our", "their", "me", "us", "do", "did", "does",
    "have", "has", "had", "will", "would", "should", "could", "can", "may",
    "might", "what", "when", "where", "who", "why", "how", "which", "via",
    "not", "no", "yes", "any", "all", "one", "two", "more", "less", "most",
    "into", "about", "over", "under", "out", "up", "down", "off", "very",
    "just", "only", "also", "even", "still", "much", "many", "some", "such",
    "now", "new", "old", "good", "bad", "well", "back", "before", "after",
    "first", "last", "next", "between", "without", "within", "during",
    "make", "made", "made", "use", "used", "using", "see", "set", "get",
    "got", "put", "take", "give", "go", "come", "find", "found", "keep",
    "kept", "let", "say", "said", "tell", "told", "ask", "asked", "thing",
    "things", "way", "ways", "time", "times", "lot", "lots", "kind", "kinds",
    "sort", "sorts", "case", "cases", "fact", "facts",
}


def tokenize_phrases(text: str, n_range=(2, 4)) -> list[str]:
    text = text.lower()
    text = re.sub(r"```.*?```", " ", text, flags=re.DOTALL)
    text = re.sub(r"`[^`]+`", " ", text)
    text = re.sub(r"\[\[[^\]]+\]\]", " ", text)
    words = [w for w in WORD_RE.findall(text) if w not in STOPWORDS and len(w) > 2]
    phrases = []
    for n in range(n_range[0], n_range[1] + 1):
        for i in range(len(words) - n + 1):
            ngram = " ".join(words[i:i + n])
            if any(w in STOPWORDS for w in words[i:i + n]):
                continue
            phrases.append(ngram)
    return phrases


def load_retros() -> list[dict]:
    retros = []
    for path in (VAULT / "60-retros").glob("*.md"):
        text = path.read_text(encoding="utf-8")
        m = FRONTMATTER_RE.match(text)
        fm = {}
        if m:
            for line in m.group(1).splitlines():
                if ":" in line:
                    k, _, v = line.partition(":")
                    fm[k.strip()] = v.strip()
        tags = []
        if "tags" in fm:
            inner = fm["tags"].strip("[]").strip()
            tags = [t.strip() for t in inner.split(",") if t.strip()]
        retros.append({
            "slug": path.stem,
            "path": str(path),
            "tags": tags,
            "body": text,
            "phrases": tokenize_phrases(text),
        })
    return retros


def load_patterns() -> list[dict]:
    patterns = []
    for path in (VAULT / "70-patterns").glob("*.md"):
        text = path.read_text(encoding="utf-8").lower()
        patterns.append({"slug": path.stem, "text": text, "path": str(path)})
    return patterns


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-count", type=int, default=3,
                    help="minimum distinct retros for a theme (default: 3)")
    args = ap.parse_args()

    retros = load_retros()
    if len(retros) < args.min_count:
        print(json.dumps({
            "themes": [],
            "note": f"only {len(retros)} retros; need >= {args.min_count}",
        }, indent=2))
        return 0

    # Count phrase -> set(retro_slugs)
    phrase_retros: dict[str, set[str]] = {}
    for r in retros:
        for phrase in set(r["phrases"]):
            phrase_retros.setdefault(phrase, set()).add(r["slug"])

    themes = [
        {"phrase": phrase, "retros": sorted(retros_set), "count": len(retros_set)}
        for phrase, retros_set in phrase_retros.items()
        if len(retros_set) >= args.min_count
    ]
    themes.sort(key=lambda t: (-t["count"], t["phrase"]))

    patterns = load_patterns()
    for theme in themes:
        existing = None
        phrase_words = theme["phrase"].split()
        for p in patterns:
            # rough: pattern slug or text contains all words of theme
            if all(w in p["text"] or w in p["slug"] for w in phrase_words):
                existing = p["slug"]
                break
        theme["type"] = "strengthen" if existing else "propose"
        theme["existing_pattern"] = existing

    print(json.dumps({
        "min_count": args.min_count,
        "retros_scanned": len(retros),
        "themes": themes,
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
