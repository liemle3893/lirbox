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
| 9 | `--name` / `<name>` / `--task` / `--skill` | 11 report, list and grading entry points | a path that is read or written | one name guard at every one of them (below) |
| 10 | `--name` | `arena/scripts/scaffold-arena.cjs` | **JS source** in the generated conductor | kebab-slug check, as its three siblings already had |
| 11 | `--phases` titles | `conductor/scripts/scaffold-workflow.cjs` | **JS source** (single-quoted strings) | title charset check; `escTpl()` already covered the template-literal sites |
| 12 | `dod.json` `criteria[].id` / `.checkFile` | `loom/scripts/dod-freeze.mjs` | the name of a file written **0755** | identifier check + containment against `--checks-dir` |
| 13 | An HTTP request | `loom/scripts/graph-server.mjs` | writes the plan-**approval** file | Host + Origin + `content-type` (below) |
| 14 | A PR number / `--repo` | `pr-writeup/scripts/fetch_pr.sh` | an output path and `gh` argv | digits-only / `owner/name` |
| 15 | A PR diff's paths | `pr-writeup/scripts/fetch_pr.sh` | what lands in the write-up | dot-component filter, now matching at any depth |
| 16 | A check command | `whetstone/scripts/check-baseline.cjs` | `execSync` **through a shell** | none — it is an operator argument, by design (see below) |
| 17 | `evals/**` and `scripts/test-*.cjs` | `scripts/evals-all.mjs` | `node <file>` | none — running the repo's own test code is the point (see below) |
| 18 | Arena fixture bundles + graders | `arena/scripts/swe-run.mjs` | cloned repos, `npm`, graders | fixed binaries with array args (no shell); fixtures are in-repo and sha-pinned |

Checked and found clean, so nothing was changed: every other child process in the
repo goes through `execFileSync`/`spawnSync` with a fixed binary and an array of
arguments — `check-baseline.cjs` (row 16) is the only `execSync` anywhere, and
there is no `shell: true`, no `eval`, and no dynamic `import()`/`require()` of a
path built from external data. `list-workflows`, `list-runs`, `list-arena`,
`list-optimizations` and `list-improvements` read a fixed directory and take no
name at all. The diagram validators (`flowchart`, `sequence-diagram`,
`component-diagram`, `plan-check`, `plan-deck` — `assets/validate.mjs`) parse an
HTML file and report; they never execute what they read. `arena-report.cjs`
escapes into HTML through `esc()`; the other report generators emit Markdown.

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

## 9 — the same name, in fifteen places

Four scaffolds validated `--name` as a kebab slug before writing
`.workflows/<name>.js`. Eleven other entry points took a name from the same kind
of command line, joined it onto a path, and read or wrote there with nothing
checking it: every report generator, `harvest-feedback`, `check-val-contamination`,
`swe-grade`, `swe-score`, `arena-report`, `graph-server`, `scaffold-arena`.

Which is the point about coverage. The traversal was identical in all fifteen;
only whether anyone had written the check differed — and the four that had it
were the four that happened to be forked from one file. `arena-report.cjs
../../../../etc/x` exited non-zero on the way in, which looks like a refusal and
is not one: it stopped at "no such state file", so it stopped nothing the moment
the traversal named a file that exists.

They all carry the same guard now — `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`, which
excludes `/` and `\` outright, so traversal is not a thing the name can express.
The suite asserts the refusal **names** the problem, so an incidental non-zero
exit cannot pass for a check.

## 10 and 11 — a name that becomes code

`scaffold-arena.cjs` emitted its `--name` into the conductor it generates as a
raw single-quoted string: `name: '<name>'`. Not escaped, not validated, and the
Workflow tool runs that file. `--name "x'; …; '"` closed the string and the rest
was code. The same name was also `path.join`'d into the output path, so
`--name ../../../../tmp/pwn` wrote the conductor outside `.arena/` — the baseline
run of the suite left a 14 KB `/tmp/pwn.js` behind to prove it.

`scaffold-workflow.cjs` was careful about this in one direction and not the
other. Prompt bodies go through `escTpl()` (backslash, backtick, `${`) because
they land in template literals. A `--phases` title lands in **single-quoted**
strings — `label: '<p>'`, `phase: '<p>'`, `log('<p>: …')`, a dozen sites — and
nothing escaped those. An apostrophe was enough.

Both now validate. The conductor's golden-snapshot net still passes byte-for-byte,
which is the evidence that the check changed nothing about ordinary generation.

## 12 — a JSON field that names an executable

`dod-freeze.mjs` writes one file per checkable criterion, `mode 0o755`, named
`${c.id}.sh` — where `c.id` comes out of a `dod.json` a worker agent wrote. An id
of `../../…` wrote an executable file wherever it pointed. `verifyChecks` had the
mirror of it: `checkFile` from the same JSON, resolved and read with no
containment. Both are checked now, and the loom net's `verifyChecks catches a
deleted check` still passes.

## 13 — loopback is not a boundary

`graph-server.mjs` binds 127.0.0.1 and says so in a comment: "no authentication
because it is never reachable off the loopback interface". That is true of the
network and false of the browser. Any page the user has open can POST to
127.0.0.1, and `POST /action` writes the file loom polls to **approve a plan**.
`editor.js` already carries a note about the in-page version of this
(`<img src=x onerror="fetch('/action', …)">`); no amount of escaping inside the
page reaches the cross-origin version.

Three checks, and each is load-bearing:

- **Host** must be `127.0.0.1:<port>` / `localhost:<port>`. This is what stops DNS
  rebinding, where the attacker's hostname resolves to 127.0.0.1 so the socket
  and the Origin both look local.
- **Origin**, when present, must be this server's own. A cross-origin `fetch`
  always sends one.
- **content-type** must be `application/json`, which is *not* a CORS "simple"
  content type — so a cross-origin POST has to preflight, and this server answers
  no preflight. Without this, `text/plain` sends the same JSON body with no
  preflight at all and an Origin check on its own is decoration.

The editor already sent `application/json`, so nothing on its side changed.

## 15 — a filter that only worked at the top level

`fetch_pr.sh` strips hidden-directory sections out of the diff it hands the
write-up. The test was `/[ab]\/\./` against the whole line, which matches
`a/.claude/x` and does **not** match `a/src/.env`. A dotfile one directory down
went into the write-up with its contents. Now each path has its `a/`/`b/` prefix
stripped and is checked for a dot-leading component at any depth.

## 16 and 17 — accepted, and why

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

- **`node scripts/test-hostile-input.mjs`** — 38 cases. A hostile
  `checks-manifest.json` (traversal, absolute path, `NODE_OPTIONS` as `env`,
  non-string fields, unknown keys); `harbor-prep.mjs --catalog` pointed at a
  directory full of work; a traversing name at all eleven entry points in row 9;
  a quote-carrying name and phase title at the two generators; a `..` criterion
  id at `dod-freeze`; and a live `graph-server` driven cross-origin, with a
  `text/plain` body, and with a rebound `Host`. Every one of these was RED on the
  commit before the fix. Runs in CI **before** the step that trusts the manifest.

  Two details in it are load-bearing, both learned the hard way. The child-process
  timeout: `graph-server.mjs` with an unchecked `--name` does not fail, it
  *starts*, so without a cap the suite hangs instead of reporting. And the `Host`
  case goes through `node:http` rather than `fetch`, because `Host` is a forbidden
  header name for fetch — it gets dropped silently, and the case then passes while
  testing nothing.
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
