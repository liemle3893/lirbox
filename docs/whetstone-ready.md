# Making a skill whetstone-ready

`lirbox:whetstone` improves a skill by grinding a backlog of concerns behind a deterministic
floor — but only if the skill gives it something to **prove a fix against**. This is the recipe
for getting a skill into that state. (Worked example: `conductor` — see its `evals/`.)

## The mental model

Whetstone keeps a fix **iff** an always-on **floor** stays green AND that concern's frozen
**acceptance-check** goes from RED → GREEN AND the change stayed inside the editable surface.
So a whetstone-ready skill needs a *runnable, assertable surface* plus that eval scaffolding.

**Litmus test:** can you write a shell command that exits non-zero when the skill misbehaves and
zero when it's correct? A validator / generator / parser / asset-transform → yes. "The wording
feels nicer" → no — that concern is **human-only**, and whetstone correctly refuses to fake a check
for it.

## The five ingredients

| # | Ingredient | What it is | State on baseline |
|---|---|---|---|
| 1 | a **runnable surface** | a `scripts/*.cjs` / `assets/*.mjs` you can execute and assert on | — |
| 2 | a **floor** (`evals/run.mjs` + `evals/floor/*.test.mjs`) | the always-on correctness fence | **GREEN** |
| 3 | a **checks dir** (`evals/checks/`) | where per-concern acceptance-checks live | (each **RED**) |
| 4 | a **backlog** (`feedback/<skill>.jsonl`) | narrow, already-decided concerns, one per line | — |
| 5 | an **eval README** | records the exact floor command + conventions | — |

## Layout (all committed — `evals/` is the contract, NOT runtime state)

```
plugins/lirbox/skills/<skill>/
  SKILL.md
  scripts/  or  assets/        # the runnable surface
  evals/
    run.mjs                     # FLOOR RUNNER: runs floor/*.test.mjs, exit 0 iff all green
    floor/00-*.test.mjs         # characterization tests — GREEN on baseline (pin current behavior)
    checks/.gitkeep             # acceptance-checks land here (whetstone drafts them at setup)
    README.md                   # the floor command + the check convention
feedback/<skill>.jsonl          # the backlog
```

`evals/` ships with the skill. Only `.improve/`, `.worktrees/`, `implementation-notes/` are
gitignored runtime.

## Step by step

### 1. Build the floor first — it's the hard gate

Whetstone **DECLINEs** unless the floor exits 0 on the unmodified skill.

- Default floor = `python3 <skill-creator>/quick_validate.py <skillPath> && node <skillPath>/evals/run.mjs`.
- Write 1–3 characterization tests under `evals/floor/` that pin behaviour you never want to
  regress (e.g. "the validator flags X", "the generator's regression net passes"). They must pass
  **today**, and a kept fix must keep them passing.
- **`quick_validate` rejects some valid Claude Code frontmatter** (`argument-hint`,
  `disable-model-invocation`). If your skill uses those, drop `quick_validate` and use a **custom
  floor** = `node <skillPath>/evals/run.mjs` alone, with a lenient frontmatter test inside `floor/`
  standing in for it. (That's exactly what `conductor` does — see its `evals/README.md`.)

### 2. File the backlog (`feedback/<skill>.jsonl`)

One concern per line: `{ "id": "...", "type": "concern", "text": "..." }`. Rules:

- **Narrow** — one concern, one check.
- **Already-decided** — a settled nitpick, not a design question. (Design first via brainstorming;
  whetstone is for grinding, not deciding.)
- **Verifiably broken now** — sanity-check it actually fails before filing.
- Subjective/taste → leave it out (it becomes human-only).

### 3. Know the check shape (whetstone drafts these, but they're yours to review)

Each concern → `evals/checks/<id>.check.mjs`: a self-contained Node script that runs your surface,
asserts the *fixed* behaviour, and exits 0/1 — **RED on baseline** (proven by `check-baseline.cjs`
→ `DISCRIMINATING`). Checks live **separately** from `floor/`: the floor is green-on-baseline, the
checks are red-on-baseline, so they **cannot share `run.mjs`**.

### 4. Run it

```
/lirbox:whetstone <skill>
```

Setup reads the backlog → RED-drafts a check per concern → runs the discrimination gate → measures
the floor → asks you to confirm once → then loops: per item, a fixer edits the editable surface to
turn the check green; kept iff floor + check pass and the surface-lock holds, else reverted. Leaves
branch `improve/<skill>` + `.improve/reports/<skill>.md`. Never auto-merges.

## Gotcha checklist (each of these bit us building `conductor`)

1. **Floor green on baseline** or whetstone declines — build it before anything else.
2. **`argument-hint` frontmatter → custom floor** (skip `quick_validate`).
3. **The baseline ref must contain the floor.** If you haven't pushed, `origin/main` is stale —
   set `baseline: "refs/heads/main"` (the Setup resolver prepends `origin/` to a *bare* ref, so use
   the full ref to force the local branch).
4. **Lock the floor's own regression net too.** Add `scripts/<your-net>.cjs` to `locked` alongside
   `evals/**` + the backlog — otherwise a fixer can weaken the net to fake a green floor.
5. **Checks must be committed into the baseline commit** — the fixer can't create them (`evals/**`
   is locked), so they have to pre-exist where the loop branches from.
6. **`args.config` launch bug** — if the loop throws `Missing args.config`, the harness stringified
   the `args` object through `scriptPath`; bake the approved config into `.improve/<skill>.js` (the
   gitignored loop artifact) as the `: null` fallback and relaunch with no args.
7. **Determinism only (v1)** — no network, no flaky timing, no LLM-judge checks.

## Templates

`evals/run.mjs` — the floor runner, reuse verbatim:

```js
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const tests = readdirSync(join(HERE, 'floor')).filter((f) => f.endsWith('.test.mjs')).sort();
if (!tests.length) { console.error('floor runner: no floor tests'); process.exit(1); }
let failed = 0;
for (const t of tests) {
  try { execFileSync('node', [join(HERE, 'floor', t)], { stdio: 'inherit' }); }
  catch { console.error(`floor FAIL ${t}`); failed++; }
}
process.exit(failed ? 1 : 0);
```

`evals/floor/00-structure.test.mjs` — lenient frontmatter check (stands in for `quick_validate`
when you keep `argument-hint`):

```js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, '..', '..');
const fm = (readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8').match(/^---\n([\s\S]*?)\n---/) || [, ''])[1];
let bad = 0;
const ok = (c, m) => { if (!c) { console.error(`FAIL floor: ${m}`); bad++; } };
ok(/^name:\s*\S/m.test(fm), 'frontmatter has name');
ok(/^description:\s*\S/m.test(fm), 'frontmatter has description');
ok((fm.match(/^name:\s*"?([A-Za-z0-9_-]+)"?/m) || [])[1] === basename(SKILL_DIR), 'name === dir');
process.exit(bad ? 1 : 0);
```

`evals/checks/<id>.check.mjs` — acceptance-check skeleton (must be RED on baseline):

```js
import { execFileSync } from 'node:child_process';
// 1. run your skill's surface (the validator/generator/etc.)
// 2. assert the FIXED behaviour:
let ok = false; // ← replace with the real assertion
if (!ok) { console.error('FAIL: <concern> not resolved'); process.exit(1); }
console.log('PASS');
```

## When NOT to bother

If the skill has no deterministic surface (a pure HTML-artifact generator judged by taste, an
interactive tutor), every concern is human-only and whetstone has nothing to grind. Improve those
by hand. Whetstone earns its keep on skills with a validator/generator and a backlog of settled,
checkable nitpicks.
