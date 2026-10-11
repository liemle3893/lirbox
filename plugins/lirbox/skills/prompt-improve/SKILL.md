---
name: prompt-improve
description: Use when the user types /prompt-improve with a prompt, or says "improve this prompt", "sharpen my prompt", "grade this brief", or asks to improve, sharpen, grade or rewrite a prompt or brief they will give Claude Code or claude.ai (Opus 5.5, Sonnet 5.5) to build an app, a game, a fix, a port or an analysis.
---

# Prompt improve

Turn the user's rough prompt into a brief that Jev grades Ready by interviewing them with AskUserQuestion until every part holds their own answer. You write the parts in their voice. Jev is the judge (TypeSafe System One, a fraction of a cent a grade); when Jev isn't set up, a Haiku subagent answers Jev's exact questions instead (see **Judge**). `assemble` adds Anthropic's guard lines. No Anthropic API key is used: you write the parts in this session.

## The loop

1. **Prompt.** Take it from the arguments; with none, ask in plain text what they want built. Save it to `prompt.txt` in a temp folder (your scratchpad if the session has one).
2. **Read the options.** Run `node "${CLAUDE_PLUGIN_ROOT}/skills/prompt-improve/scripts/brief.mjs" suggest --json "<prompt>"`, then `node "${CLAUDE_PLUGIN_ROOT}/skills/prompt-improve/scripts/brief.mjs" template <id>` for the top pick. That gives the parts to fill, each with a `hint`, the `good` line and `snippets`.
3. **First AskUserQuestion: template, model, effort.**
   - Template: three options. Jev reads keywords ("browser extension" → extension) and can miss the request's main job ("overnight" → an unattended build), so read the whole prompt and put the template that fits it first, marked (Recommended). Then add Jev's top pick and the next best fit, from Jev, local match or `list`. Each description gives Jev's % and the parts the template brings in.
   - Model: Opus 5.5 or Sonnet 5.5.
   - Effort: Not set (API default: Opus medium, Sonnet high), medium, high, xhigh; Other covers low and max. Never pick it for them.

   If they pick a different template, run `template` for it.
4. **Grade the original** (see **Judge**). Show the total and each part's raw score in one table, marking every part under 2.9. Jev's `state` labels round 2.5 up to good, so don't show them.
5. **Sort their prompt into the parts.** Their sentences stay word for word wherever they're still true; later answers extend them. A sentence doing two jobs ("make it look nice and make sure it works") goes where it does the most work, and its other half becomes a question. If that half belongs to a part that isn't active (for example "overnight" → Time), add the part to `on`; it is then an empty part. Every fact goes into the part it belongs to, whichever question it answered.
6. **Interview round:** one AskUserQuestion call with up to 4 questions. Goal comes first whenever it scores under 2.9, since the other parts depend on it. Then the empty parts, then the parts under 2.9, each group in this order: Done & verify, Context, Scope, then the rest. Any part other than Goal and Done & verify can get the option "Doesn't apply". Picking it takes the part out of `on` (for example Inputs when nothing will be pasted).
7. **Rewrite each touched part as a whole** from everything said so far. Keep their own sentences, merge repeats, drop what a later answer replaced, and leave no reference to something no part defines (a "checklist" with no checklist). Put the parts in `parts.json`, run `assemble` to rebuild `prompt.txt`, then grade again. Show the score before → after, and the parts still empty or under 2.9. When Goal or Scope changed, check that Done & verify covers each thing the goal promises (each feature, each way in, the one-command start). If something is uncovered, Verify goes into the next round even at 2.9 or above.
8. **Repeat 6–7 until the exit condition holds.**
9. **Last round,** once it holds. One AskUserQuestion call:
   - **Extras:** which parts from the template's `optional` list matter here, leaving out any already active or already declined. Offer up to 3, most relevant first, with each one's `ask` as its description, plus "None of these". Use `multiSelect`; Other covers the rest. Ask Extras at most twice in a run.
   - **Switches**, only when they apply:
     - Sonnet: "Only what I asked?" (yes adds `--strict`, Anthropic's no-extras paragraph).
     - Opus on a long or overnight job, or when `flags.unattended` is set: "Unattended run?" (yes adds `--unattended`, Anthropic's no-early-stop paragraph).
   - **Finish:** "Keep going?", with the options "Finish (Recommended)" and "Keep refining".

   If they add a part or keep refining, go back to 6; an added part wins over Finish. Ask Switches once, and again only if the model changes.
10. **Finish.** Run `assemble` once more and `pbcopy < prompt.txt`. Reply with: the final prompt in a code block; the first and last score with the verdict; and the `notes` from `assemble --json`, which are for the user, not part of the prompt.

**Exit condition:** every active part has text, every active part scores 2.9 or more (the raw score; Jev's grades of the same text vary by about ±0.05), Jev's verdict is `ready`, and no `[?:` slot is left. Or the user picks Finish.

A part where the user chose "… is your call" is answered, so the 2.9 floor doesn't apply to it. Write it as Claude's call, add only what they said, and don't ask about it again. An optional part handed entirely to Claude adds nothing, so take it out of `on`. Never offer "your call" for Goal or Done & verify.

## Writing a question

- `header` is at most 12 characters. Use Goal, Context, Quality, Scope, Direction, Inputs, Autonomy, Time, Verify or Report for a part, and Template, Model, Effort, Extras, Switches or Finish for the other questions.
- `question` names the gap in *their* prompt concretely ("Who is the snake game for?", not "Describe the audience").
- Give 3–4 options, each an answer that would score the part 3 or more. Build them from the part's `hint`, its `snippets` (for Done & verify, the template's checks) and the user's own words. Put the strongest first; mark it (Recommended) only when one clearly is. Include "<topic> is your call" when handing the choice to Claude is reasonable.
- The exact sentence that goes into the prompt goes in each option's `preview` for single-select, and in its `description` for `multiSelect: true` (use multi-select for lists: checks, what's out of scope, when to stop).
- A fact only they know (a name, a path, a number, a date) is the question itself, ending with "(type it in Other)". The options are the ways to do without it: "Find it yourself in the repo", "<topic> is your call", "Leave it out".

## What the final prompt is

- The active parts in order, each 1–4 sentences (Done & verify up to 6), in the first person, written as plain prose to a coworker. No headings, no section labels, no bullet lists except a list of checks.
- Every fact comes from the user: their prompt, the text of an option they picked, or what they typed. When they chose "your call" or skipped a question, the part hands the choice to Claude ("The stack is your call."), with no value you picked: no hex codes, versions, paths or numbers they didn't see.
- What and why, not how: no file layout, code structure or step-by-step plan unless the user asked for one. The grade's `over` stays at 3 or above.
- Guard lines come from `assemble` only, quoted from Anthropic's guides. They speak of "the user" in the third person; leave them as they are.

## Judge

Run `judge --template <id> --on <ids> --json < prompt.txt`. Exit 3 means Jev is not set up (`TYPESAFE_API_KEY` missing). Then use the **Haiku fallback** for this grade and every later one in the run:

1. `questions --template <id> --on <ids> < prompt.txt > q.json`: Jev's exact state and questions.
2. Dispatch one Agent with `model: "haiku"`, given the contents of `q.json`, told: "Grade `state.brief` by answering each question in `questions`. For a `score` question pick the criteria level (0-based index) that fits best; for `noul` give the probability 0-1 that the statement is true. Reply with JSON only: `{"<key>": {"type": "score", "score": n}, …, "clarity": {"type": "noul", "noul": p}}`, one entry per question key." Save its JSON to `answers.json`.
3. `judge --template <id> --on <ids> --answers answers.json --json < prompt.txt`.

Say once that grades come from Haiku, not Jev; the card's `by` field names the judge. Haiku gives whole levels, so 2.9 means 3. Any other judge failure: say so and keep interviewing without grades. Never invent a score.

## Commands

| Need | Command |
|---|---|
| All templates | `node "${CLAUDE_PLUGIN_ROOT}/skills/prompt-improve/scripts/brief.mjs" list` |
| One template | `node "${CLAUDE_PLUGIN_ROOT}/skills/prompt-improve/scripts/brief.mjs" template <id>` |
| Suggest | `node "${CLAUDE_PLUGIN_ROOT}/skills/prompt-improve/scripts/brief.mjs" suggest --json "<text>"` |
| Grade | `node "${CLAUDE_PLUGIN_ROOT}/skills/prompt-improve/scripts/brief.mjs" judge --template <id> --on <ids> [--answers answers.json] --json < prompt.txt` |
| Fallback questions | `node "${CLAUDE_PLUGIN_ROOT}/skills/prompt-improve/scripts/brief.mjs" questions --template <id> --on <ids> < prompt.txt` |
| Final text | `node "${CLAUDE_PLUGIN_ROOT}/skills/prompt-improve/scripts/brief.mjs" assemble --template <id> --model opus\|sonnet [--effort e] [--unattended] [--strict] [--json] < parts.json` |

`parts.json` is `{"parts": {"goal": "…"}, "on": ["goal", …], "pasted": [{"source": "email from Linh", "text": "…"}]}`. `on` holds the template's parts plus any optional part an answer brings in (pasted material goes in `inputs`, repo details in `context`). Empty parts stay in `on`, and the exit condition makes you fill them. Pass the same list to `judge --on`. `--unattended` is for long unattended Opus runs (the template's `flags.unattended`); `--strict` is for Sonnet when they want only what they asked for.

## Common mistakes

| Mistake | Fix |
|---|---|
| One batch of questions, then a finished prompt | Grade after every round, and loop until the exit condition, then the last round. |
| Finishing with an empty part because Jev guessed it from the others | Empty parts get asked early; the exit condition needs text in every active part. |
| Appending each round's answer to the part | Rewrite the part as a whole; merge repeats, drop what was replaced. |
| Asking Done & verify before the goal is clear | Goal first while it's under 2.9; recheck Verify whenever Goal changes. |
| Turning "your call" into your own specifics | Write it as Claude's call. |
| A long spec with headings, code structure, file layout | Parts in prose; how to build it is the coding agent's job. |
| Choosing the effort level | Ask. "Not set" means the API default. |
| Replacing their sentence instead of building on it | Keep their words and extend them. |
| Skipping grades because Jev is missing | Exit 3 → the Haiku fallback in **Judge**. |
