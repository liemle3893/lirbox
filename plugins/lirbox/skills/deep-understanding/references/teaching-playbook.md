# Teaching playbook

Mechanics for running the loop well. The goal is verified understanding, not coverage.

## Gauging mastery (what "mastered" means per item)

An item is mastered when the human can do at least one of these *unprompted*:
- Restate it in their own words (not echoing your phrasing).
- Explain the **why** behind it, and one level deeper.
- Predict what happens in a case they haven't been shown ("what if the input is null here?").
- Spot why an alternative would be worse.

A correct multiple-choice pick alone is weak evidence (could be a guess) — follow a correct
MCQ with a quick "why is that right, and why not B?" to convert it into real evidence.

## Quizzing with AskUserQuestion

- One concept per question; 2–4 options for MCQ; keep options genuinely plausible (distractors
  should reflect real misconceptions, not filler).
- **Shuffle the correct option's position** across questions — never let it always be the first
  or "(Recommended)" slot. Do not hint the answer in the wording.
- **Never reveal the answer before they submit.** AskUserQuestion collects their choice first;
  only after it returns do you confirm and explain.
- After submission, always explain: why the right answer is right AND why each distractor is
  wrong. The explanation of the wrong options is where a lot of the learning happens.
- Mix formats: recall MCQs, "what happens if…" prediction questions, "which design would you
  pick and why" open-ended, and "find the bug / trace this" using real code.
- Batch related questions (AskUserQuestion takes up to 4) to quiz a cluster, but don't overload.

## The ELI ladder (offer on request, or drop down when they're stuck)

- **ELI5** — plain-language analogy, no jargon, the single core idea.
- **ELI14** — correct mechanism with light terminology; the "how it actually works" without the
  deep internals.
- **ELII (explain like an intern)** — precise and technical: real names, signatures, edge cases,
  trade-offs — the level they ultimately need to reach.

Climb the ladder: if an ELI5 lands, re-ask at ELI14, then ELII, confirming at each rung.

## Handling wrong / partial answers

- Don't just give the answer. Ask a narrowing follow-up that exposes the misconception
  ("what do you think `verifyToken` returns when the cookie is missing?").
- Use the real artifact: open the code, run the debugger, or point at the diff hunk.
- Re-test the same item a different way before checking it off. Confidence + wrongness is the
  most important thing to catch and fix.

## Pacing

- Problem stage first and thoroughly — if they don't grok *why the problem existed*, the
  solution won't stick. Resist jumping to the solution because it's more fun.
- Keep turns short: teach one point, confirm, move. Show the checklist periodically so they
  see progress and what's left.
- End only when every checklist item is mastered; then give a tight recap of the whole arc
  (problem → why → solution → why → impact) so it consolidates.
