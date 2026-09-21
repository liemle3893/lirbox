---
name: feedback
description: "User-invoked only: file scrubbed, actionable feedback about a lirbox skill as a GitHub issue on liemle3893/lirbox. Never auto-invoked."
disable-model-invocation: true
argument-hint: "[ <skill> | <free-text concern> ]"
---

# Feedback — file a scrubbed, actionable issue about a lirbox skill

Turn a user's experience with a lirbox skill into a redacted GitHub issue on `liemle3893/lirbox`,
shaped as a structured backlog record so a future ingestion step (by hand, or by a future
eval-gated improvement loop) can turn it into a fix.

## When to use

- ONLY when the user explicitly invokes `/feedback` or `lirbox:feedback`. This skill is
  `disable-model-invocation: true` — never trigger it on your own initiative.
- For feedback about a lirbox **skill/tool itself** — e.g. "plan-check flagged a false positive",
  "flowchart didn't escape `<` in a label", "skill-lint was too lax". NOT for the user's own project
  work, and NOT a general bug tracker for their code.

## Inputs

- `$ARGUMENTS` (optional): a lirbox skill name and/or free text describing the concern.
- If no skill is named: ask the user which lirbox skill the feedback is about.

## Workflow

### 1. Resolve the target skill
Determine `<skill>` from the argument, else by asking. Confirm it back to the user in one line
("Feedback about **flowchart** — right?").

### 2. Elicit the concern
Ask, briefly (one or two focused exchanges — not a survey): what happened, what you expected
instead, and how we'd know it's fixed. Push for an observable **Expected vs Actual**.

### 3. Classify and shape into a record
Choose `type` ∈ `bug | concern | suggestion | subjective`. Build a record:

```json
{ "id": "<kebab-slug-of-summary>", "type": "<type>", "text": "Expected: …\nActual: …", "suggestedCriterion": "<observable pass/fail idea, prose>" }
```

- Omit `acceptanceCheck` entirely (a prose criterion there would be misread as a shell command).
- `subjective` items carry no `suggestedCriterion` — they stay human-only; no deterministic check
  will ever gate them.
- For `bug|concern|suggestion`, `text` MUST contain an Expected/Actual and `suggestedCriterion` an
  observable check idea.

### 4. Assemble the issue body, then SCRUB it
Write the draft body (prose + fenced ```json record + footer) to a scratch file, then redact
deterministically:

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/feedback/scripts/scrub.cjs < /path/to/draft.md > /path/to/scrubbed.md
```

Then do a **semantic pass yourself** over the scrubbed text: redact company/customer/project names,
account names, and anything in the goal text that identifies the user — regex can't catch these.

### 5. Confirm (mandatory gate)
Show the user the EXACT title and scrubbed body. Do nothing else — no upload, no URL — until they
explicitly approve. If they want edits, apply them and re-scrub.

### 6. Upload
Check `gh auth status`. If authed:

```bash
gh issue create --repo liemle3893/lirbox \
  --title "[feedback][<skill>] <short summary>" \
  --body-file /path/to/scrubbed.md \
  --label feedback --label "skill:<skill>"
```

If that fails because the labels don't exist (the user may lack label-create permission), retry the
same command **without** the two `--label` flags.

**Fallback (no `gh` / unauthed):** keep the saved `scrubbed.md`, and print a prefilled issue URL the
user can click. Build it with:

```bash
node -e 'const fs=require("fs");const t=encodeURIComponent(process.argv[1]);const b=encodeURIComponent(fs.readFileSync(process.argv[2],"utf8"));console.log("https://github.com/liemle3893/lirbox/issues/new?title="+t+"&body="+b)' "[feedback][<skill>] <short summary>" /path/to/scrubbed.md
```

### 7. Report
Print the created issue URL (or, in fallback mode, the prefilled URL and the saved body path).

## Issue format

- **Title:** `[feedback][<skill>] <short summary>`
- **Body:** Expected/Actual prose, then a fenced ```json block carrying the record, then a footer:
  `_Filed via lirbox:feedback. Scrubbed of local paths/identities; review before acting._`
- The title prefix `[feedback]` + the JSON block are what a future ingestion puller keys off — not
  the labels.

## Quality bar

- Nothing leaves the machine before the human confirms the exact body.
- No report content, absolute paths, emails, IPs, hostnames, or tokens in the issue.
- Verifiable feedback carries an observable Expected/Actual + `suggestedCriterion`; subjective
  feedback is honestly tagged `type: subjective`, not dressed up as checkable.
