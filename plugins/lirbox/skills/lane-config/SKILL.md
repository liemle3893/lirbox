---
name: lane-config
description: Set up or change the per-project orchestration config that decides which harness and model each lane runs on, plus lane caps, timeouts and the setup commands every lane brief carries. Use when a herdr orchestration run is refused for having no config, when the user says "configure lanes", "set up the orchestrator for this repo", "change the lane model/harness", "reconfigure lanes", or when a profile needs adding, retiring or repointing. Also use before the first run in a repo that has never been orchestrated.
---

<purpose>
One conversation replaces a decision per lane. Which harness a class of work deserves is a
judgement: made once with the user, then read — never re-derived mid-wave.
</purpose>

<hard-rules>
- **Never invent a profile, model, or baseline.** Measure what is measurable, ask the rest, and
  say which is which. `detect` reports a lockfile, not an intention.
- **Never hand-edit the JSON.** The subcommands validate as they write.
- A config that fails `validate` is not finished, however reasonable it reads.
</hard-rules>

<scripts>
```
CFG=${CLAUDE_PLUGIN_ROOT}/skills/lane-config/scripts/orch-config.sh

$CFG detect  [repo]      what is measurable here (package manager, cpus, discovered profiles)
$CFG show    [repo]      current config, or absent
$CFG init    [repo]      a WORKING config from detect: the three lirbox roles on whichever
                         harness is installed, base_branch, baseline, gate_profile. Every
                         value is a default it announces, not a decision it hides.
$CFG validate [repo]     exit 1 listing exactly what is unusable
$CFG set-profile <name> --kind claude|opencode|omp|jcode --model <m> [--effort <e>]
                         [--agent <id>] [--flags "--auto"] [repo]
$CFG set-lanes  [--max N] [--timeout MS] [--context N] [--base B] [--gate-profile P]
                         [--max-restarts N] [repo]   # --timeout = herdr readiness wait, 3001..300000
$CFG set-setup  [--install C] [--build C] [--test C] [--baseline S] [repo]
```
</scripts>

<flow>
1. `show` — a config already there means this is a *reconfigure*; skip to 5.
2. `detect` — package manager, cpus, discoverable profiles. All measurement, no decisions.
3. `init` — a config that already validates, if a known harness is installed. It prints an
   ASSUMED block naming every value it guessed; those are what step 4 confirms or replaces.
4. Ask the questions below, once. Apply each answer as it is given, so a long
   conversation cannot lose one.
5. `validate`, fix what it names, `show` the result back — saying which values were
   measured and which the user chose.
</flow>

<questions>
Ask these together, not one per turn. Offer the recommendation; take the answer.

- **Which profiles, and which are cheap vs capable?** `init` starts you with `planner`,
  `verifier` and `builder` on the lirbox agents of the same name. For each: harness
  (`claude` / `opencode` / `omp` / `jcode`) and exact model. Recommend capable for verifiers,
  criteria authoring and adjudication; cheap otherwise — spend capability where a wrong answer
  is unrecoverable or invisible, not where it is expensive.
- **Which agent each profile loads** (`--agent <id>`, default: the profile name). A repo with
  its own agents points profiles at those. `claude`/`opencode` take the id as a NAME; `omp`
  takes a PATH to the agent markdown (`--append-system-prompt`), so `set-profile` refuses an
  omp profile whose markdown does not exist — a lane that starts without it has no invariants
  and says nothing about it. `claude`/`opencode` NAMEs are checked against that harness's own
  `--agent`/`agent list` registry (built-ins included); a registry that cannot be determined
  (binary missing) is accepted, never refused.
- **Effort per profile — only where the harness has a flag** (`claude` `--effort`, `omp`
  `--thinking`). The opencode and jcode entries herdr starts have none and ignore unknown flags
  silently, so `set-profile` refuses that combination rather than store what cannot take effect.
- **jcode is declarable but not startable**: `herdr agent start --kind jcode` answers
  "unsupported interactive agent kind". lirbox knows its flags and will use them the day herdr
  adds it; until then `orch-lane.sh start` refuses and names herdr as the blocker.
- **Default profile** for a lane that names none.
- **Lane cap** — `detect` suggests cpus/2, and `init` writes it. Confirm or override.
- **Gate profile** — which profile reviews AND fixes before work leaves. `init` defaults it to
  `verifier`. It is not optional: `gate-guard.sh` refuses every push, PR and merge-onto-base
  for a lane with no `code_gate`, so `validate` refuses a config without one.
- **Suite baseline** — exact pass/fail/skip counts a green run gives on the base branch. `detect`
  cannot supply it and a lane most needs it: without it a lane cannot tell its own red from an
  inherited one. If the user does not know, say the config is incomplete and offer to measure it.
</questions>

<reconfigure>
- repoint a profile → `set-profile <name>` again; it overwrites
- retire one → every lane naming it is refused until briefs are updated. Intended, not a problem
  to route around. Say so.
- caps or setup → `set-lanes` / `set-setup`
- always finish with `validate` then `show`

**Config is read at spawn time.** Running lanes keep the harness they started with — say that, so
nobody expects one to change underneath them.
</reconfigure>

<failure-modes>
- **Validating is not being right.** `validate` checks shape; a profile pointed at the wrong model
  passes. Read the result back to the user.
- **No package manager found is information, not an error.** Ask; never guess a build.
- **`profiles_discovered: []`** usually means the binary was not found, not that there are none.
  `detect` tries PATH then `~/.opencode/bin` and reports which as `opencode_bin`; `null` there is
  a broken probe, not evidence. Set `OPENCODE_BIN` if it lives elsewhere. An empty list is never
  absence.
- **Discovered names are not assignments.** `build`, `plan`, `explore` say nothing about which
  deserve the capable harness. Ask.
</failure-modes>
