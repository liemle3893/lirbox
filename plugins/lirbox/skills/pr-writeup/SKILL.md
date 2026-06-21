---
name: pr-writeup
description: This skill should be used to generate a polished, self-contained HTML write-up that explains a pull request to a reviewer — narrative TL;DR, motivation, file-by-file tour, where-to-focus guidance, test plan, and (when relevant) rollout. Triggers when the user asks to "write up a PR", "explain this PR", "make a PR review/write-up page", "PR summary HTML", or supplies a PR number/URL/branch and wants a reviewer-facing document rather than raw diffs. Works for any PR type — feature, bugfix, refactor, docs, chore — and adapts the sections to fit.
---

# PR write-up

Generate a single self-contained HTML page that walks a reviewer through a pull
request: not a raw diff, but the *narrative* — what problem it solves, what each
notable file does, where to spend review attention, how it's tested, and how it
ships. Output matches a warm editorial design system (ivory/clay/olive, serif
headings) and renders offline in any browser.

## When to use

Use when someone wants a reviewer-facing explanation of a PR (GitHub PR number/URL,
or an as-yet-unopened local branch). Not for: posting GitHub review comments
(that is a different task), or generating raw diffs.

## Inputs

- A **PR number** (optionally with `--repo owner/name`), **PR URL**, or a **local branch**.
- If unspecified, ask which PR/branch. If the user named a repo, pass `--repo`.
- **Code density** (optional). Default is *lean*: a code snippet appears only on the
  1–2 load-bearing files where a few lines clarify intent — every other file card is
  prose (role + what/why). This matches the "narrative, not diff" principle: the reviewer
  can already read the raw diff. If the request includes **"verbose"** (or "show code on
  every file" / "with snippets"), switch to *verbose*: add a short before/after snippet to
  every non-trivial file card (skip pure config/docs/lockfiles). See the verbose snippet
  pattern in `references/components.md`.

## Workflow

### 1. Gather the PR data

GitHub PR — run the bundled script (writes everything into one dir):

```bash
bash <skill_dir>/scripts/fetch_pr.sh <pr-number> [--repo owner/name]
```

It produces `meta.json`, `files.json`, `commits.json`, `diff.patch` (hidden
folders like `.planning/`/`.claude/` already stripped), and `stat.txt`.

Local branch (no PR yet) — gather equivalently:
```bash
git log --oneline <base>..HEAD
git diff --stat <base>...HEAD
git diff <base>...HEAD          # read; do not paste verbatim into the page
```
For metadata (title, +/−, files) derive from `git diff --stat` and the branch name.

### 2. Read and understand the change

Read `meta.json` (title, body, +/−, branches, author, state) and `stat.txt`.
Then read `diff.patch` to understand *what actually changed* — enough to explain
intent per file, not to transcribe it. For large diffs, focus on the load-bearing
files (biggest/most central) and skim the rest. Use the PR body and commit
messages as the author's stated intent, but verify against the diff.

The goal is comprehension: be able to state the problem, the approach, the riskiest
boundary, and the test story in your own words.

### 3. Choose sections for this PR type

Read `references/components.md` → "Adapting by PR type" and the section catalogue.
Decide which sections apply (feature vs bugfix vs refactor vs docs/chore vs large
PR). Delete sections that do not fit — and remove their TOC links too.

### 4. Assemble the HTML

Copy `assets/template.html` to the output path, then replace every `{{PLACEHOLDER}}`
and fill the marked content regions from the PR data. Use snippets from
`references/components.md` for variable-length lists (extra file cards, focus items,
checklist items, TOC sub-links). Keep the `<style>` block unchanged.

Default output path: `./pr-<number>-writeup.html` (or `./<branch>-writeup.html`).

### 5. Verify before claiming done

- Confirm valid standalone HTML: one `<h1 class="title">`, every section id has a
  matching TOC `href`, no leftover `{{...}}` placeholders, no unfilled template comments.
- Re-check every concrete claim against the diff: file paths, +/− counts, and
  especially any **metric, test, or rollout statement** — these must be true of the
  actual PR. Delete rather than fabricate.
- Report the output path and a one-line summary of what the PR does.

## Quality bar

- **Narrative, not diff.** Every file gets a *why*, not a paste of its changes.
- **Honest.** No invented metrics, tests, or rollout phases. If there are no tests,
  the test plan says so. If nothing ships gradually, drop the rollout section.
- **Attention-directing.** "Where to focus" points at the genuinely subtle/risky
  lines (concurrency, idempotency, auth, migrations, data loss), not boilerplate.
- **Self-contained.** No external CSS/JS/fonts/images. One file, opens offline.

See `references/components.md` for the component snippet library and the
non-negotiable design rules.
