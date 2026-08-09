# Graph spec

`graph.json` is the execution spec loom's generated conductor interprets. This document is
grounded in what the code actually reads — `scripts/graph-core.mjs` (validation and math),
`scripts/scaffold-loom.cjs` (what the emitted interpreter reads from a node/edge at runtime),
`scripts/graph-server.mjs` (what the editor's save endpoint owns), and `scripts/editor/editor.js`
(what the browser reads). Where a field is purely descriptive — read by nothing, enforced by
nothing — that is called out explicitly rather than implied.

## Sequential by default, concurrent where you say so

A `work` or `gate` node has **one** successor: `pickEdge()` returns the first out-edge whose
predicate matches, so two out-edges mean *branch — take one*, never *fork — do both*. That is
deliberate. Delivery work is git-serialized and serial application is usually what you want.

Concurrency is **declared, never inferred**. A `fork` node opens a **region** that closes at
the `join` it names:

```json
{ "id": "Fan", "kind": "fork", "join": "Integrate" }
```

**Inside a region, an edge means "depends on", not "go to next."** `X -> Y` says Y waits for
X. A node runs as soon as *every* one of its in-region predecessors has finished — so a
region is a real DAG, not a bundle of parallel lanes:

```
Plan ──▶ Fan ═╦═▶ ApiWork ══╗
              ║             ╠═▶ Contract ═╗
              ╠═▶ UiWork ═══╝              ╠═▶ Integrate ──▶ Review ──▶ Done
              ║        ╚═▶ UiPolish ══════╝
              ╚═▶ …
```

`Contract` waits for **both** `ApiWork` and `UiWork`. `UiPolish` waits for `UiWork` **only**
and is not held up by `ApiWork`. Expressing that is the whole point — a model that could only
say "these lanes run side by side" would either serialise `UiPolish` behind unrelated work or
start `Contract` too early.

Every node's carry is keyed by the predecessor it came from, at every join in the DAG:

```json
{ "from": { "ApiWork": { "note": "…" }, "UiWork": { "note": "…" } } }
```

Keyed, never flat-merged — two dependencies carrying the same field name would otherwise
overwrite each other silently and the node could not tell which one it was reading.

### The rules, and what each one buys

`validateGraph` rejects a graph that breaks any of these before a run can start. Note that
they are all **boundary** rules — they constrain how a region connects to the rest of the
graph, never what it looks like inside. That is what lets the inside be any DAG.

| Rule | Why it exists |
|---|---|
| A fork declares `join`, naming a real node that is not itself | A region needs a boundary to be a region |
| At least **2** out-edges | One entry is a plain edge; calling it a fork misleads the reader |
| Every region edge is **unconditional** | A dependency is not a choice. "Every region node runs" is the premise the gate reasoning rests on |
| The region is **acyclic** | A dependency cycle is a **deadlock**, not a retry loop: each node waits on the other and there is no verdict to break it with |
| **One exit**: `dominates(join, terminal, fork)` | A node that escaped would walk the rest of the graph concurrently with itself |
| Every region node reaches the join, and nothing leaves the region except through it | Same reason, from the inside |
| No `mustCross` gate **inside** a region | Not because it would go unexecuted — it *would* run. A gate exists to fail **backwards**, and in here that is either the cycle above or an escape from the join. A node that cannot route its own failure is not a gate |
| No **nested** fork inside a region | A region is already a DAG and expresses anything a nested fork could |
| A fork declares no `prompt` or `schema` | It spawns no worker. It opens a region |

Nodes in a region are **not** required to be disjoint — a node depending on two others is the
feature, not a violation.

### What the interpreter does

The region runs as **dataflow**, not as waves: every node is a memoised promise that first
awaits its own in-region predecessors, so maximum concurrency falls out of the dependency
structure and each node runs exactly once per region entry. Visit accounting is per-region and
seeded from the outer counts, so re-entering a region (a gate after the join fails and routes
back to the fork) counts the second pass rather than replaying the first from the resume cache.

Three things are refused inside a region rather than silently raced:

- **Graph patches.** A node reshaping the graph while its siblings are being scheduled against
  that same structure is a data race. Patch from the join or after it.
- **Checkpoints.** The run has one state file, so a region checkpoints at its boundaries only.
  A kill inside a region replays that region; `results` makes every completed node free.
- **A dead node.** `parallel()` resolves a failed thunk to `null` rather than rejecting, so the
  run aborts instead of crossing the join with a partial region and calling it done.

### Fanning out over N runtime items

When N is not knowable at authoring time, a fork may declare a **bound** and let its region be
instantiated once per item:

```json
{ "id": "Fan", "kind": "fork", "join": "Integrate",
  "fanOut": { "field": "targets", "max": 8 } }
```

`field` names an array in the carry arriving at the fork. The region becomes a **template**:
for a list of three, every node `X` in it runs as `X@0`, `X@1`, `X@2`, all concurrently, each
receiving its own element as `item` in its carry.

**What the human approves changes shape here, and that is the whole reason `max` is
mandatory.** Everywhere else in loom the approved graph *is* the executed graph — visit caps,
the trace and `lockedHash` all key on static node ids. A fanning region cannot promise that,
because N is discovered mid-run. So it promises the next strongest thing: *you approved this
template and this ceiling.* `max` is what makes that checkable.

Consequently the interpreter **refuses** rather than doing less than asked:

| situation | what happens |
|---|---|
| more items than `max` | the run **aborts**. Truncating would report success for work that never ran, and would look identical in the report to a run that did everything |
| the list is empty | aborts — a region that ran zero times cannot have produced what the join is about to be credited with |
| the field is missing or not an array | aborts |

`validateGraph` additionally requires the list to be **guaranteed**: every edge into a fanning
fork must `carry` the field, and the node it comes from must list it in `schema.required`. A
fan-out driven by a field a worker was free to omit instantiates nothing and reports success —
the same defect as a back-edge carrying an optional field.

Accounting is per **instance**: `X@0` and `X@1` each get the full visit cap authored on `X`,
rather than sharing one budget and starving the last of them. The join's carry is keyed by
instance (`{"from": {"Verify@0": …, "Verify@1": …}}`) and the trace records how many instances
ran, so the report describes the shape that actually executed.

A fanning fork needs only **one** entry node — its concurrency comes from N instances, not from
two lanes.

## Violations

`validateGraph` returns **objects**, not sentences:

```json
{ "code": "fork-region-edge-conditional",
  "message": "fork Fan region edge ApiWork -> Contract carries a predicate — …",
  "fork": "Fan", "edge": { "from": "ApiWork", "to": "Contract" },
  "fix": { "removeEdges": [{ "from": "ApiWork", "to": "Contract" }],
           "addEdges":    [{ "from": "ApiWork", "to": "Contract", "when": "always" }] } }
```

| Field | Meaning |
|---|---|
| `code` | stable kebab-case slug, unique per rule. **Branch on this, never on `message`** — the prose is free to be reworded |
| `message` | the human sentence, unchanged from before violations were structured |
| `node` / `edge` / `gate` / `fork` / `join` / `nodes` | whichever the rule names, exposed as fields instead of only inside the sentence |
| `fix` | present when a **mechanical** repair exists: an ordinary patch, in `applyPatchTo` shape |

`fix` is a **suggestion and is never applied automatically.** It goes back through
`applyPatchTo` + `validateGraph` like any other patch, so a wrong suggestion is rejected by the
same gate as a wrong worker. A conductor that silently repaired its own workers' patches would
be the gate-that-repairs failure in different clothes. Rules whose repair is a *design*
decision (a dead-end node's successor) carry no `fix` rather than a guess.

`messages(violations)` flattens to the array of strings every human surface prints. The
server's 422 carries both: `violations` (strings, unchanged) and `diagnostics` (the objects).

## Top level

| Field | Type | Meaning |
|---|---|---|
| `start` | node id | Where a fresh run begins (`node = graph.start` in the emitted interpreter). |
| `terminal` | node id | The interpreter's `while` loop stops the instant `node === graph.terminal`; the terminal node's own `prompt`/`schema` are never read. |
| `version` | integer | Owned by `graph-server.mjs`, never by a client. Every accepted `POST /graph` sets `next.version = prevVersion + 1`, and the scaffolded conductor bumps it again on every accepted runtime patch (`graph.version = (graph.version || 0) + 1`). A save must submit `baseVersion` matching the server's current `version` or it is rejected with `409` — this is the optimistic-concurrency guard, not a cosmetic counter. |
| `approved` | boolean | Set by the skill (not by any script) once step 3's freeze completes. Nothing in `graph-core.mjs`, `scaffold-loom.cjs`, or `graph-server.mjs` reads it — it is bookkeeping for the human/skill flow, the signal that `scaffold-loom.cjs` may now be run against this graph. |
| `nodes` | array | See below. |
| `edges` | array | See below. |
| `invariants` | object | See below. |
| `name`, `goal` | string | Set by the skill when it copies a seed to `.loom/<name>.graph.json` (step 2). `scaffold-loom.cjs` reads `graph.goal` twice: for the emitted `meta.description` (falling back to `name`, truncated to 160 chars), and at **runtime** for the run brief every worker prompt opens with — see *The run brief* below. `name` in `meta.description` is the `--name` CLI arg, not this field. |

## Node fields

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Unique per graph (`validateGraph` rejects duplicates). Referenced by every edge's `from`/`to`. |
| `kind` | `"work" \| "gate" \| "plan" \| "terminal" \| "fork"` | **`"fork"` is behavioural; every other value is descriptive.** A `fork` changes control flow: the interpreter takes *every* out-edge concurrently instead of calling `pickEdge`, `validateGraph` enforces the whole region contract above, and `scaffold-loom.cjs` emits no `meta.phases` entry for it (it spawns no worker). For the rest, control flow never branches on `kind` — it is read only for the `meta.phases` detail string (`'${kind} node'`, defaulting to `work`) and by `editor.js` to pick a CSS class (`node-gate` / `node-fork` / `node-work`; `plan` and `terminal` both render as `node-work`). Whether a node must dominate the terminal, and whether it is locked, still comes entirely from `locked` and `invariants.mustCross`. **Calling something `"gate"` does not make it one** — but calling something `"fork"` does. |
| `fanOut` | `{ field: string, max: integer }` | Optional, `fork` only. Turns the region into a template instantiated once per item in the carried array `field`, bounded by `max`. Both keys are required — `max` is the ceiling the human approves in place of a node count, and the run aborts rather than truncating past it. See the fan-out rules above. |
| `join` | string | **Required on, and only meaningful for, a `fork`.** Names the node where the concurrent region closes. Must exist, must not be the fork itself, and must be crossed by every path leaving the fork (`dominates(join, terminal, fork)`). Inside the region it opens, edges are dependencies rather than transitions — see the region rules above. |
| `prompt` | string | The node-specific instructions spliced into the worker prompt template (`node-lead.txt`) via `sub()`. Ignored for the terminal node, since the interpreter loop exits before reaching it. |
| `schema` | JSON Schema object | Passed straight through as `{ schema: n.schema }` in the `agent()` call options — the structured-output contract the worker's result must satisfy. |
| `model` | string | An explicit override that **outranks the model policy below** (e.g. `"haiku"` for cheap deterministic nodes like `Setup`). When absent the policy supplies one; under `--model-mode inherit` nothing is supplied and the worker inherits the session model. |
| `effort` | string | Reasoning budget for this node, same precedence as `model`. The policy sets `"high"` on strong-tier nodes; a node may override. Omitted entirely when neither applies. |
| `agentType` | string | Passed straight through as `{ agentType: n.agentType }` when present — which subagent type `Workflow`'s `agent()` should spawn for this node. Omitted if absent. |
| `locked` | boolean | Frozen at approval (step 3) for every `invariants.mustCross` node. Feeds `lockedFingerprint()`: a locked node's `id`/`prompt`/`schema`/etc. changing under a later patch changes the fingerprint, and `validateGraph` rejects any submission whose fingerprint no longer matches `invariants.lockedHash`. This is what makes a gate's own instructions non-negotiable once approved — see [`invariants.md`](invariants.md). |
| `pos` | `{ x: number, y: number }` | Editor-only canvas coordinates (`editor.js`: `n.pos \|\| { x: 60, y: 40 + i * 90 }` on load, written back to `n.pos` on drag). Never read by `graph-core.mjs` or the generated conductor. Purely a layout hint for the human reviewing the graph in the browser. |

## Critical path — what the graph costs in TIME

`nodeBudget` bounds how much work a run may do. It says nothing about how much of that work must
happen *one after another*, and that is what a run's wall-clock actually is.

`criticalPath(graph)` (in `graph-core.mjs`) returns the longest chain of **worker-spawning** nodes
from `start` to the terminal. A `fork` spawns no worker and the terminal is never executed, so
neither counts. Cycles — a gate's failing edge routing backwards — are traversed at most once, so
the number is the cost of one pass; retries multiply it rather than change the shape it measures.

Multiplied by the average node duration this predicts real elapsed time to within 1-3%, measured
against the emitted conductor across linear and forked graphs. Node count does not predict it at
all: eight nodes behind one fork finish in the time of the longest branch, while eight in a line
take eight node-times.

`parallelism(graph)` is `workers / criticalPath`. **1.00 means nothing overlaps** — the run is a
sequence wearing a graph's clothes. Both shipped seeds score 1.00.

| invariant | bounds | opt-in |
|---|---|---|
| `nodeBudget` | how many nodes exist | yes |
| `maxCriticalPath` | how many run in sequence | yes |

A graph exceeding `maxCriticalPath` is rejected with `critical-path-exceeded`. A graph exactly at
the bound is allowed — it is a maximum, not a target. A graph that sets no bound is never judged,
because plenty of work is genuinely sequential and refusing to run it would be wrong.

Report it before launch: `node scripts/graph-metrics.mjs .loom/<name>.graph.json`.

## The run brief

Every worker prompt opens with what the run is for and where to find what earlier nodes
recorded:

```
THIS RUN EXISTS TO: <graph.goal>

  .loom/state/<name>/results/<nodeId>#<visit>.json   what an earlier node returned
  .loom/<name>.dod.json                              this run's definition of done
  .loom/<name>.checks/                               the frozen DoD check files
```

`graph.goal` is read from the **live** graph at runtime, not baked in at generation time, so a
runtime `graphPatch` cannot leave the brief describing a graph that no longer exists.

It is an **index, never a payload** — paths the worker opens only if its own task needs them,
so its size does not grow with how much earlier nodes produced. The goal is truncated at 600
characters for the same reason. Both properties are load-bearing rather than tidiness: a brief
that inlined predecessors' results, or that re-sent an unbounded goal once per node, would
re-create on the worker side exactly the O(n²) prompt cost that moving `results` out of the
checkpoint removed. `evals/checks/worker-prompt-carries-the-run-brief.check.mjs` holds both
halves — that the brief is present, and that it stays bounded.

The brief tells a worker where the answers are. It does not excuse a vague node `prompt`: the
brief is identical for every node, so nothing in it says what *this* node must do.

## Which model each worker runs on

`scaffold-loom.cjs --model-mode auto` (**the default**) tags every worker with a `model:`. Two
tiers:

| tier | who gets it | default | also gets |
|---|---|---|---|
| strong | every node in `invariants.mustCross`, plus `kind: "plan"` | `opus` (`--model-think`) | `effort: 'high'` |
| work | everything else | `sonnet` (`--model-work`) | — |

A node's own `model`/`effort` always wins — that is a decision a human approved in the graph,
and the policy only fills the gaps. `--model-mode inherit` emits no policy at all (passing
`--model-think`/`--model-work` alongside it is an error, not a no-op), while still honouring
authored fields. The checkpoint agent is always cheap: its job is one file write.

**The strong tier is keyed on `mustCross`, deliberately not on `kind === "gate"`.** As the node
table says, `kind` is descriptive — calling a node `"gate"` does not make it one. Keying on the
label would be wrong in both directions simultaneously: a decorative node named `"gate"` would
draw the expensive model, while a genuinely enforced node labelled `"work"` would adjudicate
whether the run may terminate on the cheap tier. `kind: "plan"` *is* keyed on the label, because
being wrong there only wastes money — it cannot weaken a gate.

The policy is evaluated **at runtime against the live graph**, so nodes spliced in by a runtime
`graphPatch` are tagged too. A table computed when the script was generated could not contain
them.

## Edge fields

| Field | Type | Meaning |
|---|---|---|
| `from`, `to` | node id | Both must resolve to a node in the graph (`validateGraph` rejects an edge pointing at an unknown id in either direction). |
| `when` | predicate \| `"always"` | See predicates below. `pickEdge()` walks a node's out-edges **in declaration order** and returns the first one whose `when` matches the worker's result — declaration order *is* priority order. If none match, `pickEdge` returns `null` and the interpreter throws (`no edge matched at ...`) rather than silently falling through to the terminal. |
| `carry` | array of field names | Which fields of the result get lifted into `carry[edge.to]` for the next node's prompt (`carryFor()` in `graph-core.mjs`). Anything not named here is dropped — a back-edge carries exactly what it declares, nothing more, so a retry converges on the failing gate's findings instead of restarting blind. |
| `locked` | boolean | Frozen at approval, same mechanism as a locked node. **Convention enforced by the seeds and the `dominates` exemption, not by `validateGraph` itself:** only a `mustCross` gate's *passing* edge (`when.eq === true`) is ever locked; its failure edge stays unlocked so runtime patches can still reshape the retry path (splice a node in, reroute to an earlier stage, self-loop). A locked failure edge would let a spliced parallel edge validate and then never be selected, since `pickEdge` takes the first match — a silent no-op, which is worse than a rejection. |

## Predicates (`when`)

Evaluated by `matches(pred, result)` in `graph-core.mjs`. **Unknown shapes fail closed** — an
unrecognised operator, or any `when` value that is not `"always"`, not `null`/`undefined`, and
not a plain object with a known key, matches nothing:

| Form | Matches when |
|---|---|
| `"always"` (or `when` omitted / `null`) | Every result, including `null`. |
| `{ field, eq: v }` | `result[field] === v` (strict equality — `{passed: 1}` does **not** match `eq: true`). |
| `{ field, neq: v }` | `result[field] !== v`. |
| `{ field, gt: n }` | `typeof result[field] === 'number' && result[field] > n`. |
| `{ field, lt: n }` | `typeof result[field] === 'number' && result[field] < n`. |
| `{ field, exists: bool }` | `(result[field] !== undefined && result[field] !== null) === bool`. |
| anything else (unknown key, non-object, `result` shaped wrong) | Never matches. |

These are declarative data on purpose — never code strings. Predicates travel through JSON, are
edited in the browser, and are evaluated inside the restricted conductor layer, so `eval`/`new
Function` are not an option, and a hand-rolled expression language would just be `eval` with
extra steps.

## `invariants`

Read from **`prev`** during validation, never from the graph being validated (`next`) — see
[`invariants.md`](invariants.md) for why that specific choice is load-bearing. Pre-approval
(`prev === null`), a graph may still declare its own `invariants`, since there is nothing yet to
be frozen against.

| Field | Type | Meaning |
|---|---|---|
| `mustCross` | array of node ids | The gates every path from `start` to `terminal` must dominate — both structurally (from `start`) and from every one of the gate's own non-passing out-edges. This is the invariant `validateGraph` actually enforces; see `invariants.md`. |
| `lockedHash` | `"fnv1a:xxxxxxxx"` | The drift detector over every locked node and locked edge, computed by `lockedFingerprint()` (key-sorted `stableStringify`, then 32-bit FNV-1a). **Not a cryptographic guarantee** — it exists to catch a replanner quietly rewriting a locked gate, not an adversary hunting hash collisions. Contrast with DoD `checkSha`, which is real `sha256` computed by a full-tool worker (see `dod-freeze.mjs`). |
| `visitCaps` | `{ [nodeId]: number, "*"?: number }` | Read by `capFor()`: a per-node cap wins over the `"*"` wildcard, which wins over a hard-coded default of `3`. **This is the only place a visit cap may live** — never add a `visitCap` field to a node itself; nothing reads it there. Zero is honoured as a real cap, not treated as absent. |
| `nodeBudget` | integer | Total node-count ceiling. `validateGraph` rejects a patch that would push `nodes.length` over it — using `prev`'s budget, so a patch cannot raise its own ceiling in the same submission that busts it. |

## Worked example: `scripts/seeds/delivery.json`

```json
{
  "version": 0,
  "start": "Setup",
  "terminal": "Done",
  "nodes": [
    {
      "id": "Setup",
      "kind": "work",
      "prompt": "Create or reuse the git worktree and branch for this run. Report the paths.",
      "model": "haiku",
      "schema": {
        "type": "object",
        "additionalProperties": false,
        "required": ["worktree", "branch"],
        "properties": {
          "worktree": { "type": "string" },
          "branch": { "type": "string" }
        }
      }
    },
    {
      "id": "DoDBaseline",
      "kind": "work",
      "prompt": "Run every checkable DoD criterion's check FILE against the worktree BEFORE any work. ...",
      "model": "haiku",
      "schema": {
        "type": "object",
        "additionalProperties": false,
        "required": ["baselines", "discriminates"],
        "properties": {
          "baselines": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["id", "status"],
              "properties": {
                "id": { "type": "string" },
                "status": { "type": "string", "enum": ["met", "unmet", "error"] }
              }
            }
          },
          "discriminates": { "type": "boolean" }
        }
      }
    },
    {
      "id": "Plan",
      "kind": "plan",
      "prompt": "Read the repository and decide this run's decomposition. Return a graphPatch that adds the work nodes you need between Plan and Review, with their dependency edges.",
      "schema": {
        "type": "object",
        "required": ["summary"],
        "properties": {
          "summary": { "type": "string" },
          "graphPatch": { "type": "object" }
        }
      }
    },
    {
      "id": "Implement",
      "kind": "work",
      "prompt": "Implement the goal in the worktree. Commit your work on the branch.",
      "schema": {
        "type": "object",
        "additionalProperties": false,
        "required": ["summary"],
        "properties": {
          "summary": { "type": "string" },
          "files": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    {
      "id": "Review",
      "kind": "gate",
      "locked": true,
      "prompt": "Review the diff on this branch for correctness, security and convention violations. Fix every Critical and High finding, keep the build green, and commit. Report passed=true only when nothing Critical or High is left UNRESOLVED, and only after actually running the build.",
      "schema": {
        "type": "object",
        "additionalProperties": false,
        "required": ["passed", "buildExit"],
        "properties": {
          "passed": { "type": "boolean" },
          "buildExit": { "type": "number" },
          "findings": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    {
      "id": "DoDGate",
      "kind": "gate",
      "locked": true,
      "prompt": "Adjudicate EVERY definition-of-done criterion against the work on this branch. MEASURE ONLY — do not fix. ...",
      "schema": {
        "type": "object",
        "additionalProperties": false,
        "required": ["passed", "criteria"],
        "properties": {
          "passed": { "type": "boolean" },
          "unmetCriteria": { "type": "array", "items": { "type": "string" } },
          "criteria": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["id", "verdict"],
              "properties": {
                "id": { "type": "string" },
                "verdict": { "type": "string", "enum": ["MET", "UNMET", "PARTIAL", "TAMPERED"] },
                "evidence": { "type": "string" }
              }
            }
          }
        }
      }
    },
    {
      "id": "PR",
      "kind": "work",
      "prompt": "Push the branch and open a pull request with the GitHub CLI. Never merge. If a PR already exists for this branch, return its URL.",
      "schema": {
        "type": "object",
        "additionalProperties": false,
        "required": ["prUrl"],
        "properties": { "prUrl": { "type": "string" } }
      }
    },
    { "id": "Done", "kind": "terminal" }
  ],
  "edges": [
    { "from": "Setup", "to": "DoDBaseline", "when": "always" },
    { "from": "DoDBaseline", "to": "Plan", "when": { "field": "discriminates", "eq": true } },
    { "from": "Plan", "to": "Implement", "when": "always" },
    { "from": "Implement", "to": "Review", "when": "always" },
    { "from": "Review", "to": "Implement", "when": { "field": "passed", "eq": false }, "carry": ["findings"] },
    { "from": "Review", "to": "DoDGate", "when": { "field": "passed", "eq": true }, "locked": true },
    { "from": "DoDGate", "to": "Implement", "when": { "field": "passed", "eq": false }, "carry": ["unmetCriteria"] },
    { "from": "DoDGate", "to": "PR", "when": { "field": "passed", "eq": true }, "locked": true },
    { "from": "PR", "to": "Done", "when": "always" }
  ],
  "invariants": {
    "mustCross": ["Review", "DoDGate"],
    "visitCaps": { "*": 3, "Implement": 4 },
    "nodeBudget": 40,
    "lockedHash": "fnv1a:51d7641c"
  }
}
```

Note the shape this exercises: `DoDBaseline`'s only outgoing edge requires `discriminates: true` —
reporting `false` matches no edge, and the interpreter hard-fails rather than silently proceeding
(the "no edge matched" rule doubles as this node's enforcement). `Review` and `DoDGate` are both
`mustCross` gates: each is `locked`, each has exactly one *locked passing* edge (`eq: true`) and
one *unlocked failing* edge (`eq: false`) back into `Implement`, and `Implement`'s own visit cap
(`4`) is raised above the wildcard (`3`) because it is the node both gates retry into. `lite.json`
(`scripts/seeds/lite.json`) is the smaller shape: `Setup, Plan, Implement, Review, Done` — no
`DoDBaseline`, `DoDGate`, or `PR`. `Review` alone is `mustCross`, going straight to `Done` on
pass.
