---
name: lanes
description: "Use when work runs across external agent processes that outlive your session — several herdr panes or worktrees in flight, a gate that must not be bypassed under time pressure, a lane that has gone quiet, or an orchestrator picking up a run it did not start. Not for subagents inside one session: that is conductor (fixed pipeline) or loom (reshapeable graph)."
---

# lanes

<purpose>
`conductor` and `loom` drive the **Workflow** tool: a generated pure-JS conductor walks a graph and
spawns **subagents inside one session**. `lanes` is a different execution model.

| | conductor / loom | lanes |
|---|---|---|
| who transitions | generated JS, from a boolean | a **live orchestrator agent**, using judgment, recording why |
| what a worker is | subagent inside the session, dies with it | a **whole process** — own pane, worktree, context, any harness |
| the loop | the JS program; needs a live session | the orchestrator, which can be replaced mid-run |
| on death | re-run the phase | **re-attach** to a still-running pane, redispatch, or retry-whole |

Re-attachability is the point. Everything else here exists to make it safe.
</purpose>

<honesty>
**loom's gates are structural. Ours are procedural. This is weaker and you must not pretend otherwise.**

loom's conductor is pure JS with no `fs` — it *cannot* write state, so its gates cannot be walked
around. Our orchestrator is an agent with Bash. It can append a row to `transitions.jsonl` by hand.

So the guarantee splits in two:

- **`transition.mjs` PREVENTS** illegal moves for anyone using the door.
- **`reconcile.mjs` DETECTS** anyone who didn't. It recomputes every lane's state from the evidence
  artifacts alone and diffs against the recorded state. Hand-edits surface as drift.

Prevention plus detection is not the same as impossibility. Run `reconcile.mjs` before you believe
the board — especially before anything reaches a remote.
</honesty>

<core-model>
Three things, and confusing them is where the bugs are:

- **Lane** — one unit of work owned by one external agent process. It writes JSON files. Nothing else.
- **Store** — append-only JSON artifacts under `<run>/`, read through DuckDB views. Embedded, no
  daemon, no ingestion step: `read_json_auto` is a *view over the files*, so the store cannot drift
  from the artifacts and lanes stay harness-neutral.
- **Orchestrator** — you. You decide transitions, you record why, and you are the only caller of
  `transition.mjs`. **Lanes never touch the store.** The `lirbox-herdr-orchestrator` agent is this
  role written down; it carries the store contract and calls these scripts. Dispatch it, or be it.

```
<run>/
  dispatch/*.json      one record per lane: how to find it again
  evidence/*.json      one record per artifact: report | verification | commit | publish
  decisions/*.json     {fork, options[], chosen, reason, would_overturn}
  transitions.jsonl    append-only, written ONLY by transition.mjs
```

A file may hold one record or an array of them — a live lane appends its own file; a seeded run
ships one array. Both read identically.
</core-model>

<states>
```
proposed → planned → dispatched → reported → verified → durable → published
blocked-on-user | blocked-on-task | blocked-on-agent | wedged | dead
```

`durable` is **committed**. It is reachable from `reported` *without* passing through `verified`,
because that is what actually happens: `9610e31` in this repo was committed with 5 failing tests. A
board that shows `Done` for both is how a red commit reached a remote.

**Two transitions are refused, not discouraged:**

1. **`reported → verified` requires a verification artifact whose `produced_by` differs from the
   lane's dispatched `agent_name`.** A self-report can never become verified. Machine-checkable from
   the dispatch records alone.
2. **`→ published` requires `verified` in the lane's history.** `durable` is not `verified`.

**Verify before you commit.** Only `durable → published` publishes, and there is no
`verified → published` edge — publishing something uncommitted is not a thing. So committing first
is legal but costs a re-entry: `reported → durable → verified → durable → published`.

`wedged` is a real state, distinct from `dead` and from `working`. Both opencode lanes in this repo
held tokens and cost flat for ~10 minutes while `agent_status` still read
`working`. Recovery differs and that is why the states differ: **`ctrl+c` via `pane send-keys` frees
a wedge; a dead lane needs replacing.** So `wedged → dispatched` is legal and `dead → dispatched`
means a *new* process under the same name.
</states>

<procedure>

### 1. Dispatch — record how to find the lane again

A herdr agent's **session id changes when its pane is cleared; its name does not.** Re-attach
matches on **name**. Write one `dispatch/<lane>.json` per lane before the agent starts:

```json
{ "lane": "fix", "agent_name": "lane-fix", "role": "implementor", "harness": "claude",
  "tier": "strong", "pane_id": "wV:pF", "workspace_id": "wV",
  "worktree": "/abs/path/to/worktree", "branch": "merge-msn-20260812",
  "sha_at_dispatch": "9610e31", "task": "...", "contract": "/abs/path/to/CRITERIA.md" }
```

`tier` is the only model knob. There is no routing layer and there will not be one.

Then `transition.mjs --to planned`, `--to dispatched`. **Two agents editing one file collide
regardless of branch** — concurrent lanes need disjoint files or a worktree each.

### 2. Move state — only through the door

```
node ${CLAUDE_PLUGIN_ROOT}/skills/lanes/scripts/transition.mjs --root <run> --lane <id> --to <state> --reason "..."
```

Exit 0 appends the row; exit 1 prints why and writes nothing. **Never append to
`transitions.jsonl` yourself.** If the door refuses you, the refusal is the finding — do not route
around it.

### 3. Record the fork, not the choice

```json
{ "fork": "...", "options": ["...", "..."], "chosen": "...", "reason": "...",
  "would_overturn": "..." }
```

**`would_overturn` is the field that makes resume work, not `chosen`.** A replacement orchestrator
can act on *"overturned if any of the 33 covers behaviour that survives P-1"*. It cannot act on
*"chose option 1"*.

### 4. Read the board

```
duckdb -c "SET VARIABLE r='<run>'" -c ".read ${CLAUDE_PLUGIN_ROOT}/skills/lanes/scripts/views.sql" \
       -c "SELECT * FROM board"
```

`board.verified_by` is NULL unless some agent **other than** the implementor produced a verification
artifact. That is the column a Done column cannot fake. Views: `dispatch`, `evidence`, `decisions`,
`transitions`, `board`.

### 5. Reconcile before you believe it

```
node ${CLAUDE_PLUGIN_ROOT}/skills/lanes/scripts/reconcile.mjs --root <run>
```

Exit 0 clean, exit 1 drift. It also flags an evidence record whose file no longer exists. The stuck
states leave no artifact, so they report `UNVERIFIABLE` rather than clean — stated, not hidden.

Run it before every publish and after every orchestrator handover.

### 6. Recover a lane

| symptom | state | move |
|---|---|---|
| pane alive, context and cost still climbing | working | leave it |
| tokens and cost both flat across two reads ~30s apart | `wedged` | `ctrl+c` via `pane send-keys`, then `wedged → dispatched` |
| no `agent_status` at all | `dead` | new process, same `agent_name`, then `dead → dispatched` |
| orchestrator died, panes alive | — | reload the store, match on `agent_name`, keep going |

`agent_status: working` is not liveness — it reads `working` throughout a wedge.

**Sample the pane twice, ~30s apart. The discriminating pair is tokens and cost.**

| signal | alive | wedged |
|---|---|---|
| `↓ Nk tokens` | advancing | flat |
| `$N.NN` | advancing | flat |
| `(Nm Ns` elapsed | advancing | **also advancing — not a liveness signal** |

Measured: a healthy lane moved `21.4k → 23.3k` tokens and `$2.11 → $2.26` in 25 seconds; both
opencode wedges in this repo held both flat for ~10 minutes.

**Rejected: "no subprocess".** It reads well and cannot be run — there is no mapping from a herdr
pane id to a PID, so `pgrep` has nothing to take. It was in this skill's own contract and survived
into the first draft. Do not put it back.

**Confirm both counters are flat before `ctrl+c`.** A lane mid-suite is indistinguishable on elapsed
alone, and killing it there destroys the run.

### 6b. Recover a DEAD lane — three options, only one is always safe

| strategy | safe when | how you check |
|---|---|---|
| re-attach | pane alive, lane unchanged | `herdr agent get` + the `dispatch/` record |
| redispatch | idempotent, no durable side effect yet | **has the branch HEAD moved since `sha_at_dispatch`?** |
| retry-whole | no **external** side effect yet | see below |

The redispatch trap: a lane that died *after* committing looks identical to one that died before
starting — unless you compare HEAD against `sha_at_dispatch`. That field exists for this.

**Retry-whole discards the worktree, which undoes nothing outside it.** A lane that pushed, opened a
PR or deployed is not recoverable by throwing away a checkout. Record that moment as an
`externalized` evidence record; after it, every recovery is manual and no script will tell you so.

### 7. DoD, if the run needs one

Borrow loom's — do not rewrite it. `dod-freeze.mjs` and `graph-core.mjs` are standalone and depend
on no Claude-only tool:

```
node ${CLAUDE_PLUGIN_ROOT}/skills/loom/scripts/dod-freeze.mjs \
  --dod <run>/dod.json --checks-dir <run>/checks
```
</procedure>

<gotchas>
- **A green check that cannot fail is the dominant defect class here.** Before a lane's evidence
  counts, its red arm must have gone red on a *value*. A criterion whose check passes at baseline
  discriminates nothing.
- A test with no timeout that awaits an event does not fail — it **hangs**, and the lane looks busy.
- `transition.mjs` refusing is not a bug to work around. It is the only part of this that holds.
- `reconcile.mjs` cannot see intent. It answers "do the artifacts support this state", nothing more.
- **Never auto-merge, never auto-push.** That is the human's call, always.
</gotchas>

<not-built>
Deliberately absent: a browser graph editor (loom has one), model routing beyond `tier`, and
anything that merges or pushes on its own. Also out of this cut: deriving parallel-safe fork regions
from graphify touch-sets — the right next step, but the skeleton has to survive the death test first.
</not-built>

<resources>
- `scripts/transition.mjs` — the only sanctioned writer. Exports `TABLE`, `check`, `loadRun`,
  `stateOf`, `ctxFor` for reuse.
- `scripts/reconcile.mjs` — recompute from artifacts, diff against the store.
- `scripts/views.sql` — DuckDB views, including `board`.
- `scripts/test-transitions.mjs` — `node --test`; every illegal pair in the matrix is *shown*
  refused, not asserted.
- `assets/example-run/` — a worked run seeded from real history: the msn/dev merge, the post-merge
  fix lane and its independent verifier, the xlsx C2 flake, the B-13 typecheck fix, and the three
  debate lanes, with their actual panes, worktrees, branches and evidence paths — the machine paths
  scrubbed to `/repo/…`, so `reconcile.mjs` on it reports `0 drift, 14 missing artifact(s)`. That is
  the expected output: the transitions are real and reconcile, the artifacts are not shipped.
</resources>
