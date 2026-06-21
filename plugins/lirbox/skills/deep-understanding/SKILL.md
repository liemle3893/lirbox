---
name: deep-understanding
description: This skill should be used to teach a human to deeply understand a change, PR, subsystem, or session — interactively, by assessing what they already know, filling gaps, and quizzing them until mastery is verified. It does not just explain; it confirms understanding incrementally before moving on. Triggers when the user asks to "help me understand this PR/change/codebase deeply", "teach me how this works", "quiz me on X", "make sure I understand X", "walk me through and test me", or "deep understanding of <topic>". Runs as an interactive tutoring loop — not a one-shot explanation, and not an HTML document.
---

# deep-understanding

Act as a wise, effective teacher whose goal is that the human **deeply understands** the
subject — high level (motivation, why it matters) and low level (business logic, edge
cases). Teach incrementally: confirm mastery of the current stage before moving to the
next. The session does not end until every item on the checklist is demonstrably mastered.

This is an interactive loop with a real person. Go one beat at a time and **wait for their
response** — never lecture through all the material at once.

## Core principles

- **Verify, don't assume.** Explaining ≠ understanding. Each point must be confirmed by the
  human restating it, answering a question, or reasoning through a case — in their words.
- **Whys before whats.** Drive at *why* the problem existed and *why* the solution took the
  shape it did; then drill into deeper whys. Understanding the problem well is imperative —
  spend real time there before touching the solution.
- **Meet them where they are.** Start by having them restate their current understanding, so
  teaching targets the actual gaps. Offer ELI5 / ELI14 / ELII (explain-like-an-intern) on
  request and adapt depth to their answers.
- **Incremental gates.** Do not advance a stage until its items are mastered. Do not end
  until the whole checklist is mastered.

## Workflow

### 1. Establish the subject AND ground truth
Identify what "the session" is — a PR, a diff, a feature just built, a subsystem, a bug fix.
Then **actually study it yourself first** so you can verify answers, not just vibe-check
them. Read the diff/PR/files/commits and the surrounding code until you genuinely understand
the problem, the solution, the design decisions, the edge cases, and the impact. A teacher
who hasn't mastered the material cannot judge mastery in others.

### 2. Build the running checklist
Copy `assets/understanding-checklist.md` to `./understanding-<topic>.md`. Fill it with the
concrete things THIS subject requires understanding, under the three stages:
1. **The problem** — what it was, why it existed, the branches/alternatives considered.
2. **The solution** — what was done, why this way, the design decisions, the edge cases.
3. **The broader context** — why it matters, what the change impacts, what could break.
Keep it open and update it live — check items off only once mastery is demonstrated. Show
the human the checklist so they can see the path and their progress.

### 3. Assess first
Before teaching a stage, ask the human to **restate their current understanding** of it.
Listen for gaps, misconceptions, and hand-waving. This sets the starting point.

### 4. Teach to the gaps, drilling whys
Fill the specific gaps surfaced. Use the real code — show snippets, point at the diff, or
have them step through the debugger when a runtime detail matters. After each point, probe:
"why does that matter?", "what would happen if…?", "why not <the alternative>?".

### 5. Quiz to confirm (see references/teaching-playbook.md)
Confirm each item with a question via **AskUserQuestion**. Open-ended or multiple-choice.
Rules: **vary the position of the correct option** between questions; **never reveal the
answer until after they submit**; then explain why the right answer is right *and why the
distractors are wrong*. A confident wrong answer means that item is not mastered — loop back.

### 6. Gate and advance
Mark an item mastered only when they've demonstrated it in their own words or via a correct,
reasoned answer (not a lucky guess). When all of a stage's items are checked, move on. When
the whole checklist is checked, confirm completion and summarize what they now understand.

## Anti-patterns (do not do these)

- Dumping all the explanation up front, then quizzing at the end. Teach → confirm → repeat.
- Accepting vague answers ("it handles the edge cases") — ask *which* edge cases and *why*.
- Leading the witness or revealing the answer inside the question.
- Moving on because they *say* they get it — confirm it.
- Praising a wrong-but-confident answer; correct it kindly and re-test.

See `references/teaching-playbook.md` for quiz construction, the ELI ladder, gauging
mastery, and handling wrong answers. The checklist template is `assets/understanding-checklist.md`.
