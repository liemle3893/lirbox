---
name: skill-lint
description: Use when auditing lirbox SKILL.md files for bloat and structure hygiene — flags skills that "read like a book" (over the word budget or dense with long prose), unbalanced or missing XML structural tags, weak frontmatter descriptions/triggers, and oversized inline flowcharts or reference files. Triggers on "lint the skills", "which skills are too long", "check skill structure", "are my skills concise". Reports findings; does not edit.
---

# skill-lint — measure skills against the concise-skill standard

A deterministic scanner. It does NOT rewrite skills — it reports, ranked most-severe-first, so a human (or a follow-up edit pass) can act.

<run>
From the repo root:

```bash
node plugins/lirbox/skills/skill-lint/scripts/analyze.cjs            # scan every lirbox skill
node plugins/lirbox/skills/skill-lint/scripts/analyze.cjs <skill…>   # one or more SKILL.md paths or skill dirs
node plugins/lirbox/skills/skill-lint/scripts/analyze.cjs --strict   # exit 1 if any ● flag (CI gate)
node plugins/lirbox/skills/skill-lint/scripts/analyze.cjs --json     # machine-readable
```

Output is a per-skill table (words · long-prose % · structural-tag count) plus the findings list. Severity: ● flag · ◐ warn · ○ note.
</run>

<checks>
| check | what it flags |
|-------|---------------|
| **book** | body words (frontmatter + fenced code excluded) — warn >500, flag >1200; plus a long-prose ratio. A flagged skill is told which section to extract into `references/`. |
| **tags** | structural XML tags that are unbalanced/unclosed; a big skill (>800 w) with **zero** tags gets an "add tags" nudge. Tags inside code and lowercase placeholders (`<name>`) are ignored. |
| **desc** | frontmatter `name`+`description` present, third-person, carrying an explicit *when/Triggers* cue. |
| **flow** | inline `dot`/`mermaid` blocks over 40 lines, and `references/*.md` over 500 lines. |
</checks>

<acting-on-findings>
- **●/◐ book** — move the named section into `references/`, or convert long prose into lists, tables, and tagged blocks. Do NOT delete meaning; relocate it (progressive disclosure).
- **● tags** — close the tag, or delete the stray one. Structural tags should wrap a block, not decorate a line.
- **○ desc** — rewrite the description as a third-person *when* trigger; the model reads only `name`+`description` to decide invocation.
- Re-run after edits. A subjective "still reads like a book" call is yours — the metrics only surface candidates.
</acting-on-findings>

<extending>
Thresholds live in the `T` object at the top of `analyze.cjs`. After any change, run the regression net:

```bash
node plugins/lirbox/skills/skill-lint/scripts/test-analyze.cjs
```

It asserts each check fires on a fixture AND that a clean skill stays clean (no false positives on placeholders, code, or ordinary prose).
</extending>
