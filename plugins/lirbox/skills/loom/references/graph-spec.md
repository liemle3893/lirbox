# Graph spec

`graph.json` is the execution spec loom's generated conductor interprets. This document is
grounded in what the code actually reads — `scripts/graph-core.mjs` (validation and math),
`scripts/scaffold-loom.cjs` (what the emitted interpreter reads from a node/edge at runtime),
`scripts/graph-server.mjs` (what the editor's save endpoint owns), and `scripts/editor/editor.js`
(what the browser reads). Where a field is purely descriptive — read by nothing, enforced by
nothing — that is called out explicitly rather than implied.

## What this graph is, and what it is not

**It is a single-cursor state machine, not a schedulable DAG.** Read this before choosing loom
over `conductor` on the strength of the word "graph".

One cursor walks the graph. `pickEdge()` returns **exactly one** edge, and out-edges are
conditional transitions evaluated against the previous node's result — so two out-edges mean
*branch: take one*, never *fork: do both*. The emitted interpreter's walk is
`while (node && node !== graph.terminal)` over awaited single `agent()` calls; there is no
`parallel()`, no `pipeline()`, no `Promise.all`. **An N-node run is N sequential agent
invocations, and there is no way to declare that two nodes are independent.**

What loom buys over `conductor` is therefore the **reshapeable failure path** — a gate that
fails routes control backwards, carrying its findings, and the shape itself is human-approved
and frozen — not concurrency. If your work is a DAG because it has independent branches you
want overlapped, this model does not schedule them and `conductor` is cheaper.

The workaround that exists today: fan out *inside* a work node, so its worker spawns parallel
subagents and applies their results serially. For git-serialized delivery (one branch, a gate
before each commit) serial application is correct anyway. But that concurrency is invisible to
the graph, to `visitCaps` and to the report — the approved shape stops describing what ran, so
prefer it for read-only fan-out (surveying, searching) over concurrent mutation.

Making this a real fork/join is an open design question, tracked in
[#67](https://github.com/liemle3893/lirbox/issues/67). The constraint any scheduler has to
meet: `dominates()` must stay provable across concurrent branches — no path may reach the
terminal without crossing every `mustCross` gate — and visit accounting has to become
per-branch rather than global.

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
| `name`, `goal` | string | Set by the skill when it copies a seed to `.loom/<name>.graph.json` (step 2). `scaffold-loom.cjs` reads `graph.goal` for the emitted `meta.description` (falling back to `name`, truncated to 160 chars); `name` there is the `--name` CLI arg, not this field. |

## Node fields

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Unique per graph (`validateGraph` rejects duplicates). Referenced by every edge's `from`/`to`. |
| `kind` | `"work" \| "gate" \| "plan" \| "terminal"` | **Descriptive only.** The interpreter's control flow never branches on `kind` — it is read solely by `scaffold-loom.cjs` for the `meta.phases` detail string (`'${kind} node'`, defaulting to `work`) and by `editor.js` to pick a CSS class (`node-gate` vs `node-work`; `plan` and `terminal` both render as `node-work`). A node's actual behavior — whether it must dominate the terminal, whether it is locked — comes entirely from `locked` and `invariants.mustCross`, not from `kind`. Calling something `"gate"` does not make it one. |
| `prompt` | string | The node-specific instructions spliced into the worker prompt template (`node-lead.txt`) via `sub()`. Ignored for the terminal node, since the interpreter loop exits before reaching it. |
| `schema` | JSON Schema object | Passed straight through as `{ schema: n.schema }` in the `agent()` call options — the structured-output contract the worker's result must satisfy. |
| `model` | string | Passed straight through as `{ model: n.model }` when present (e.g. `"haiku"` for cheap deterministic nodes like `Setup`). Omitted entirely from the `agent()` call if absent, not defaulted to anything by loom itself. |
| `agentType` | string | Passed straight through as `{ agentType: n.agentType }` when present — which subagent type `Workflow`'s `agent()` should spawn for this node. Omitted if absent. |
| `locked` | boolean | Frozen at approval (step 3) for every `invariants.mustCross` node. Feeds `lockedFingerprint()`: a locked node's `id`/`prompt`/`schema`/etc. changing under a later patch changes the fingerprint, and `validateGraph` rejects any submission whose fingerprint no longer matches `invariants.lockedHash`. This is what makes a gate's own instructions non-negotiable once approved — see [`invariants.md`](invariants.md). |
| `pos` | `{ x: number, y: number }` | Editor-only canvas coordinates (`editor.js`: `n.pos \|\| { x: 60, y: 40 + i * 90 }` on load, written back to `n.pos` on drag). Never read by `graph-core.mjs` or the generated conductor. Purely a layout hint for the human reviewing the graph in the browser. |

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
