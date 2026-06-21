# Understanding checklist — {{TOPIC}}

> Running doc for a deep-understanding session. Check an item `[x]` ONLY when the human has
> demonstrated mastery (restated in their words / reasoned answer / correct prediction) — not
> when it has merely been explained. Add, split, or reword items to fit the actual subject.

**Subject:** {{what is being understood — PR #, branch, feature, subsystem}}
**Learner's starting point:** {{filled in after step 3 — what they already know / misconceptions}}

---

## Stage 1 — The problem  (do this thoroughly first)
- [ ] What the problem actually was (concretely, not abstractly)
- [ ] **Why** the problem existed — the root cause, and the why beneath that
- [ ] Who/what it affected and how it showed up (symptoms, the failure mode)
- [ ] The branches / alternatives that were possible, and why the obvious ones fall short

## Stage 2 — The solution
- [ ] What was changed (the shape of the fix, the key files/components)
- [ ] **Why this approach** and not the alternatives (the design decision + its trade-offs)
- [ ] The core business logic / mechanism, step by step
- [ ] The edge cases handled — *which* ones and *why* they matter
- [ ] What could still go wrong / the limits of the solution

## Stage 3 — The broader context
- [ ] Why this matters (the stakes — users, scale, correctness, security…)
- [ ] What the change impacts downstream (callers, data, other systems)
- [ ] What to watch / what could break, and how you'd notice

---

## Notes
- _quiz results, misconceptions corrected, open follow-ups…_
