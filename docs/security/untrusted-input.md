# Untrusted input in lirbox's scripts

A checked-out repository is not a trusted party. Neither is a pull request, a
config file in `$HOME`, or a task manifest — each is a string that some script
here eventually turns into a path, an argv token, or a child process, and each
can be written by somebody who is not the person running the command.

This is the map of those places: what reads project-controlled input, where that
input can become code, and what stops it. It is meant to be **read before adding
a feature that reads a file**, and updated when one lands.

Four practices drive it:

1. Validate a config file the way you would an HTTP request body — check the
   structure, reject anything off-schema.
2. Map every place a string becomes code or a command, and know for each one
   whether project input can reach it.
3. Make the trust gate cover **every** path to that place, not the first one.
4. Test against a hostile repository, and automate the test.

---

## The map

| # | Input | Read by | Becomes | Gate |
|---|-------|---------|---------|------|
| 1 | Orchestrator config `profiles[p].flags` | `orch-config.sh`, `orch-lane.sh`, `model-policy.sh` | argv of the spawned harness | `scripts/lane-flag-policy.zsh`, enforced at all three |
| 2 | Orchestrator config `profiles[p].kind/model/effort` | same three | argv | shape guards + `model-policy.sh` comparison |
| 3 | Orchestrator config `lanes.*` | `orch-config.sh`, `orch-lane.sh` | jq `--argjson`, a concurrency cap | integer + range check before jq sees it |
| 4 | Orchestrator config `setup.*` | `orch-lane.sh` | a command a lane is told to run | single-line + length; content is the user's decision |
| 5 | Whole orchestrator config file | `orch-config.sh validate` | — | schema: unknown keys, types, then every write-time rule re-derived |
| 6 | `evals/checks-manifest.json` `mutations[]` | `scripts/prove-checks.mjs` | a file write and a child process env | path containment, `env` name allowlist + loader denylist, per-key type check |
| 7 | `--catalog <dir>` | `scripts/harbor-prep.mjs` | a recursive delete | refuses `/`, `$HOME`, anything containing or inside the repo, and any non-empty directory without its own marker |
| 8 | Repo lockfiles | `orch-config.sh detect` | a setup command | the repo picks *which* preset; it never supplies the string |
| 9 | A check command | `whetstone/scripts/check-baseline.cjs` | `execSync` **through a shell** | none — it is an operator argument, by design (see below) |
| 10 | `evals/**` and `scripts/test-*.cjs` | `scripts/evals-all.mjs` | `node <file>` | none — running the repo's own test code is the point (see below) |
| 11 | Arena fixture bundles + graders | `arena/scripts/swe-*.mjs` | cloned repos, `npm`, graders | fixed binaries with array args (no shell); fixtures are in-repo and sha-pinned |

Diagram artifact validators (`flowchart`, `sequence-diagram`, `component-diagram`,
`plan-check`, `plan-deck` — `assets/validate.mjs`) read an HTML file, parse it and
report. They never execute what they read, and nothing on that path constructs a
command.

---

## 1 — the one that was real

A profile's `flags` array is spliced into

```
herdr agent start <lane> --kind <k> --pane <p> --timeout <t> -- --agent <profile> <flags…>
```

Nothing looked at it. `orch-config.sh set-profile` stored whatever string it was
handed, `orch-lane.sh` word-split it into argv, and `model-policy.sh` — the
PreToolUse hook whose entire job is to stop a lane spawning on an unapproved
harness — compared `--kind`, `--model` and `--effort` and nothing else. So:

```
orch-config.sh set-profile impl --kind claude --model claude-sonnet-5 \
  --flags '--dangerously-skip-permissions --mcp-config /tmp/evil.json'
```

made **every later lane in that repo** spawn with permissions off and an attacker's
MCP servers loaded. Permanently — the config outlives the session — and silently,
because no path on the way printed a word about it.

The config lives in `$HOME`, keyed by the repo's git common dir, so a hostile
checkout cannot write it. It does not have to: it only has to get the agent to
run that one command, which a README, an issue body, a CI log or a code comment
can ask for. An agent that complies has made the change stick.

**The gate is `plugins/lirbox/scripts/lane-flag-policy.zsh`, and all three
consumers derive their answer from it:**

- **write time** — `set-profile` refuses to store it.
- **spawn time** — `orch-lane.sh` re-checks before splicing, because the config is
  a file, and `validate` passing an hour ago is not a property of the file now.
- **command time** — `model-policy.sh` refuses a spawn command the model wrote
  with the flag on it directly, which neither of the other two can see.

Two rules, deliberately different in kind:

- **Shape is an allowlist.** A flag token may contain only
  `A-Za-z0-9 . _ / : @ , = + -`. That excludes whitespace, quotes, `$`, backtick,
  backslash, `;`, `&`, `|`, `<`, `>`, parentheses and every control character in
  one test. This is the half that holds against a consumer nobody has written
  yet: a token that survives it is inert however it is spliced.
- **Names are a denylist**, and a denylist is never complete. It names flags that
  grant capability, load code or config, rewrite the system prompt, or re-pick
  the model (`--fallback-model` is on it precisely because the hook compares
  `--model` and has no idea a fallback exists), plus anything whose own name
  starts with `dangerously`. An allowlist of acceptable harness flags would break
  the moment `claude`, `opencode` or `herdr` grew one. **When you add a harness,
  read its `--help` and extend the list.**

A second, smaller list — `LANE_FLAG_PROFILE_DECIDED` — is refused inside a stored
profile but allowed on a command line: `--model`, `--kind`, `--agent`, `--effort`
are the hook's own subject matter there, and a second answer hidden in `flags` is
one the gate never compares.

`POLICY-OVERRIDE` in the command still passes. The point was never to veto
judgement; it was to make the decision be said out loud once, instead of stored
where nobody reads it again.

---

## 3 and 5 — a refused write must change nothing

`set-lanes --max oops` handed `oops` to `jq --argjson`. jq failed, the shell
variable holding the new content became empty, and `write()` wrote that empty
string over a working config — **exiting 0**. The first sign of it was the next
spawn being denied for a config that "did not parse".

Two independent guards now, because either alone leaves a hole:

- arguments are validated as integers in range **before** jq sees them;
- `write()` refuses content that is not valid JSON, and writes through a temp
  file and `mv` so a failure part-way cannot leave a truncated config.

`validate` re-derives every write-time rule from the file itself. "Never
hand-edit the JSON" is a rule; this is the mechanism.

---

## 6 — a manifest is a pull request

`scripts/prove-checks.mjs` reads every skill's `evals/checks-manifest.json`, and
`.github/workflows/evals.yml` runs it over all of them on every PR. So the
manifest is input from whoever opened the PR, and it drives a file write and a
child process.

`mutation.file` was joined onto a path with nothing checking it:

```json
{ "why": "…", "env": "ORCH_CONFIG_OVERRIDE",
  "file": "../../../../../somewhere/else", "find": "kind", "replace": "PWNED" }
```

wrote straight through the scratch copy into the runner — and the run printed
`OK — every declared mutation produced a RED.`

Now: every key is type-checked, `file` must be relative, `..`-free and resolve
inside the root it claims, `env` must be an `UPPER_SNAKE` name and is refused if
it names a loader variable (`NODE_OPTIONS`, `LD_PRELOAD`, `PATH`, `GIT_SSH_COMMAND`
and the rest), `root` must be `repo` or `skill`, and `--skill` must be a plain
slug. An off-shape manifest is a hard **exit 2**, not a skipped entry — a mutation
that quietly does not run reads exactly like one that passed.

---

## 9 and 10 — accepted, and why

**`check-baseline.cjs <command>` runs its argument through a shell.** That is the
tool: it takes an acceptance-check command and reports whether it fails on the
baseline. The argument comes from the operator's own command line, not from a
file in the tree. Do not "fix" this by adding validation — fix it by never
building that argument out of file content.

**`evals-all.mjs` executes `evals/checks/*.check.mjs` and `scripts/test-*.cjs`
from the tree.** Running the repo's own test code is the entire point, and any
gate there would gate the wrong thing. The consequence to know: **a fork's pull
request executes its own code in CI.** `evals.yml` is `permissions: contents:
read` on `pull_request`, so that code gets a read-only token and no secrets —
that, not input validation, is what bounds it. Keep it that way; do not add
secrets to this workflow, and do not switch it to `pull_request_target`.

---

## 4 — testing against a hostile repository

Two automated suites, both required to be RED before the fix and GREEN after:

- **`node scripts/test-hostile-input.mjs`** — builds a hostile
  `checks-manifest.json` (traversal, absolute path, `NODE_OPTIONS` as `env`,
  non-string fields, unknown keys) in a throwaway tree and requires the refusal;
  points `harbor-prep.mjs --catalog` at a directory full of work and requires it
  to survive. Runs in CI **before** the step that trusts the manifest.
- **`plugins/lirbox/skills/lane-config/evals/checks/hostile-config-refused.check.mjs`**
  — drives the hostile flag end to end and requires a refusal at write time, at
  read time (`validate`), at spawn time and at command time. Frozen, registered
  in `checks-manifest.json` with seven mutations, and run repo-wide by
  `scripts/evals-all.mjs`.

Both end by exercising the **legitimate** path — an ordinary profile with
ordinary flags, a well-formed manifest, a fresh catalog directory. A gate that
refuses everything is not a gate, and that is the half that would otherwise go
unnoticed until somebody's real config stopped working.

---

## Adding a feature that reads project input

1. Add the row to the map above before you write the code.
2. If it is a config file, validate its **structure** and reject what is
   off-schema — do not read one field and hope.
3. If a string can become a path, resolve it and prove containment. If it can
   become argv, put it through a character allowlist. If it can become a shell
   command, ask why.
4. If there is already a gate for that kind of value, **source the existing
   one** — a second copy is a second thing to forget.
5. Add the hostile case to `scripts/test-hostile-input.mjs` or to the skill's
   frozen checks, prove it RED on the baseline first
   (`whetstone/scripts/check-baseline.cjs`), and register its mutations so
   `scripts/prove-checks.mjs` keeps it measuring.
