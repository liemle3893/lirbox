# Interrogation playbook

The point of stop-and-ask is not politeness — it is to extract the evidence the
plan omits. Grill like the plan's success depends on it, because it does.

## Rules

1. **One question at a time.** Never batch. Each answer reshapes the next question.
2. **Prioritize by verdict-flip.** Ask first about the propositions whose answer
   would flip GO↔NO-GO. A question that can't change the verdict is low value —
   defer or drop it. (From "Finding Your Unknowns": *prioritize questions where my
   answer would change the architecture.*)
3. **Demand specifics, reject hand-waving.** Not "is the cluster healthy?" but
   "paste `ceph -s` — I need HEALTH_OK vs the actual PG states." Not "does this
   function exist?" but a `file:line`. A vague answer is an `UNVERIFIED`, not a pass.
4. **Ask for the reference.** The strongest confirmation is a source: the doc, the
   release note, the current-state output, the code. If the human asserts it,
   ask what they'd point to. No pointer → tacit assumption (unknown-known) to log.
5. **Follow the deviation.** If an answer contradicts the plan, don't move on —
   that thread often unspools the real unknown-unknown.
6. **Know when to stop.** When an answer can only come from touching the live
   system (and you have no handed-over environment), stop asking and mark it
   `UNVERIFIED (needs: run X on the target)`. That becomes a condition-to-clear —
   it is not a failure of the interview.

## Prompt shapes

- "You claim step 3 is safe to run while clients are connected. What version are
  you on, and what does that version's doc say about it? Link it."
- "The plan assumes the OSDs are already `noout`. Are they? Paste the flags."
- "This step edits `config.rs` — which function, and have you checked its callers?
  Give me the `file:line`."
- "If step 4 fails halfway, what's the actual state, and is the rollback in the
  plan reversible from there — or is it a new plan?"

## What each answer produces

| Human's answer | Adjudication |
|---|---|
| specific + sourced | `VERIFIED` (cite the source) |
| specific but no source available | `UNVERIFIED (needs: <the source/command>)` |
| "I assumed / I think so" | `UNSTATED-ASSUMPTION` (unknown-known surfaced) |
| contradicts the plan | pursue; likely `REFUTED` or a new `BLIND-SPOT-RISK` |
| only knowable on the live system | `UNVERIFIED (needs: run on target)` → condition |
